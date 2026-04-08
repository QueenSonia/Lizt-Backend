import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { CacheService } from 'src/lib/cache';

@Injectable()
export class IpRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(IpRateLimitGuard.name);
  private readonly maxRequests = 100; // Max requests per window
  private readonly windowSeconds = 60; // 1 minute window
  private readonly blockDurationSeconds = 300; // 5 minutes block

  constructor(private cacheService: CacheService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const clientIp = this.getClientIp(request);

    if (!clientIp) {
      return true;
    }

    const blockKey = `ip_blocked:${clientIp}`;
    const rateLimitKey = `ip_rate_limit:${clientIp}`;

    try {
      // Check if IP is currently blocked
      const isBlocked = await this.cacheService.get(blockKey);
      if (isBlocked) {
        this.logger.warn(`Blocked request from banned IP: ${clientIp}`);
        throw new HttpException(
          'Too Many Requests',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Get current request count
      const requestCountStr = await this.cacheService.get<string>(rateLimitKey);
      const requestCount = requestCountStr ? parseInt(requestCountStr, 10) : 0;

      // Check if limit exceeded
      if (requestCount >= this.maxRequests) {
        // Block the IP for the block duration
        await this.cacheService.setWithTtlSeconds(
          blockKey,
          'blocked',
          this.blockDurationSeconds,
        );

        this.logger.warn(
          `IP ${clientIp} exceeded rate limit (${requestCount} requests). Blocked for ${this.blockDurationSeconds} seconds.`,
        );

        throw new HttpException(
          'Too Many Requests',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Increment request count
      await this.cacheService.setWithTtlSeconds(
        rateLimitKey,
        (requestCount + 1).toString(),
        this.windowSeconds,
      );

      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // If cache fails, allow the request but log the error
      this.logger.warn(
        `Rate limit check failed for IP ${clientIp}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return true;
    }
  }

  private getClientIp(request: Request): string | undefined {
    // Get real IP considering proxies
    return (
      request.get('CF-Connecting-IP') || // Cloudflare
      request.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
      request.get('X-Real-IP') ||
      request.socket.remoteAddress ||
      request.ip
    );
  }
}
