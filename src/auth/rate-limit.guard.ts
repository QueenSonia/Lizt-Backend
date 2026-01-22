import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CacheService } from 'src/lib/cache';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly maxAttempts = 5;
  private readonly windowSeconds = 15 * 60; // 15 minutes

  constructor(
    private reflector: Reflector,
    private cacheService: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const identifier = request.body?.identifier || request.ip;

    if (!identifier) {
      return true;
    }

    const key = `rate_limit:login:${identifier}`;

    try {
      const attemptsStr = await this.cacheService.get<string>(key);
      const attempts = attemptsStr ? parseInt(attemptsStr, 10) : 0;

      // Check if limit exceeded
      if (attempts >= this.maxAttempts) {
        const ttl = await this.cacheService.ttl(key);
        const remainingMinutes = Math.max(1, Math.ceil(ttl / 60));
        throw new HttpException(
          `Too many login attempts. Please try again in ${remainingMinutes} minutes.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Increment attempt count using setWithTtlSeconds to avoid millisecond conversion
      await this.cacheService.setWithTtlSeconds(
        key,
        (attempts + 1).toString(),
        this.windowSeconds,
      );

      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // If cache fails, allow the request but log the error
      this.logger.warn(`Rate limit check failed: ${error.message}`);
      return true;
    }
  }

  // Method to clear rate limit for successful login
  async clearLimit(identifier: string): Promise<void> {
    const key = `rate_limit:login:${identifier}`;
    try {
      await this.cacheService.delete(key);
    } catch (error) {
      this.logger.warn(`Failed to clear rate limit: ${error.message}`);
    }
  }
}
