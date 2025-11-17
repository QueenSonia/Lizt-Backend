import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private store: RateLimitStore = {};
  private readonly maxAttempts = 5;
  private readonly windowMs = 15 * 60 * 1000; // 15 minutes

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const identifier = request.body?.identifier || request.ip;

    if (!identifier) {
      return true;
    }

    const now = Date.now();
    const key = `login:${identifier}`;

    // Clean up expired entries
    if (this.store[key] && this.store[key].resetTime < now) {
      delete this.store[key];
    }

    // Initialize or get current attempt data
    if (!this.store[key]) {
      this.store[key] = {
        count: 1,
        resetTime: now + this.windowMs,
      };
      return true;
    }

    // Increment attempt count
    this.store[key].count++;

    // Check if limit exceeded
    if (this.store[key].count > this.maxAttempts) {
      const remainingTime = Math.ceil(
        (this.store[key].resetTime - now) / 1000 / 60,
      );
      throw new HttpException(
        `Too many login attempts. Please try again in ${remainingTime} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  // Method to clear rate limit for successful login
  clearLimit(identifier: string): void {
    const key = `login:${identifier}`;
    delete this.store[key];
  }
}
