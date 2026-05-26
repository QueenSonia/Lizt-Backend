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
    const rawIdentifier = request.body?.identifier || request.ip;

    if (!rawIdentifier) {
      return true;
    }

    // Match UsersService.loginUser normalization so "+234…" / "0…" / mixed
    // case emails all collapse to the same counter. Without this, a user can
    // accidentally lock themselves out under one format while another format
    // (same person, same account) still has a fresh counter.
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawIdentifier);
    const identifier = isEmail
      ? rawIdentifier.toLowerCase().trim()
      : String(rawIdentifier).replace(/[\s\-()+]/g, '');

    const key = `rate_limit:login:${identifier}`;

    try {
      // Pre-check before increment so a locked-out caller doesn't keep
      // pushing the counter higher (cosmetic — also keeps the "remaining
      // minutes" message stable across retries while locked).
      const attemptsStr = await this.cacheService.get<string>(key);
      const attempts = attemptsStr ? parseInt(attemptsStr, 10) : 0;

      if (attempts >= this.maxAttempts) {
        const ttl = await this.cacheService.ttl(key);
        const remainingMinutes = Math.max(1, Math.ceil(ttl / 60));
        throw new HttpException(
          `Too many login attempts. Please try again in ${remainingMinutes} minutes.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // incrementWithTtlNx — TTL fixed to the first attempt so retries don't
      // extend the window. Caller should invoke clearLimit() on successful
      // auth to release the counter immediately.
      await this.cacheService.incrementWithTtlNx(key, this.windowSeconds);

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

  // Method to clear rate limit for successful login. Apply same normalization
  // as canActivate so the right key is targeted.
  async clearLimit(rawIdentifier: string): Promise<void> {
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawIdentifier);
    const identifier = isEmail
      ? rawIdentifier.toLowerCase().trim()
      : String(rawIdentifier).replace(/[\s\-()+]/g, '');
    const key = `rate_limit:login:${identifier}`;
    try {
      await this.cacheService.delete(key);
    } catch (error) {
      this.logger.warn(`Failed to clear rate limit: ${error.message}`);
    }
  }
}
