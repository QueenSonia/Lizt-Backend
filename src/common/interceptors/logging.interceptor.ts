import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { ApiLog } from './api-log.entity';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  private logBuffer: Partial<ApiLog>[] = [];
  private flushInterval: NodeJS.Timeout;
  private readonly BUFFER_SIZE = 50;
  private readonly FLUSH_INTERVAL_MS = 5000;

  constructor(
    @InjectRepository(ApiLog)
    private readonly apiLogRepository: Repository<ApiLog>,
  ) {
    // Batch insert logs every 5 seconds
    this.flushInterval = setInterval(() => {
      this.flushLogs();
    }, this.FLUSH_INTERVAL_MS);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { method, originalUrl, ip } = request;
    const userAgent = request.get('user-agent') || '';
    const userId = (request as any).user?.id || null;
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const { statusCode } = response;

          // Add to buffer instead of immediate save
          this.bufferLog({
            method,
            endpoint: originalUrl,
            status_code: statusCode,
            duration_ms: duration,
            ip,
            user_agent: userAgent,
            user_id: userId,
          });

          if (duration > 1000) {
            this.logger.warn(
              `SLOW REQUEST: ${method} ${originalUrl} took ${duration}ms`,
            );
          }
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          const statusCode = error.status || 500;

          this.bufferLog({
            method,
            endpoint: originalUrl,
            status_code: statusCode,
            duration_ms: duration,
            ip,
            user_agent: userAgent,
            user_id: userId,
            error_message: error.message,
          });
        },
      }),
    );
  }

  private bufferLog(data: Partial<ApiLog>): void {
    this.logBuffer.push(data);

    // Flush immediately if buffer is full
    if (this.logBuffer.length >= this.BUFFER_SIZE) {
      this.flushLogs();
    }
  }

  private async flushLogs(): Promise<void> {
    if (this.logBuffer.length === 0) return;

    const logsToSave = [...this.logBuffer];
    this.logBuffer = [];

    try {
      // Batch insert all logs at once
      await this.apiLogRepository.insert(logsToSave);
    } catch (err) {
      this.logger.error(
        `Failed to save ${logsToSave.length} API logs: ${err.message}`,
      );
    }
  }

  onModuleDestroy() {
    // Flush remaining logs on shutdown
    clearInterval(this.flushInterval);
    this.flushLogs();
  }
}
