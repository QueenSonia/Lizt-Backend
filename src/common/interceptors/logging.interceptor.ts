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

  constructor(
    @InjectRepository(ApiLog)
    private readonly apiLogRepository: Repository<ApiLog>,
  ) {}

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

          // Save to database (fire and forget)
          this.saveLog({
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

          this.saveLog({
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

  private saveLog(data: Partial<ApiLog>): void {
    this.apiLogRepository.save(data).catch((err) => {
      this.logger.error(`Failed to save API log: ${err.message}`);
    });
  }
}
