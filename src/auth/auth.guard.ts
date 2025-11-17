import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from './auth.decorator';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromCookie(request);

    console.log(
      '[AuthGuard] Token extracted:',
      token ? `${token.substring(0, 50)}...` : 'NO TOKEN',
    );

    if (!token) {
      console.log('[AuthGuard] No token found, rejecting request');
      throw new UnauthorizedException();
    }
    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get('JWT_SECRET'),
      });

      console.log(
        '[AuthGuard] Token verified successfully for user:',
        payload.id,
      );
      request['user'] = payload;
    } catch (error) {
      console.log('[AuthGuard] Token verification failed:', error.message);
      throw new UnauthorizedException();
    }
    return true;
  }

  private extractTokenFromCookie(request: Request): string | null {
    // First try to get token from cookies
    const cookies = request.cookies;
    console.log('[AuthGuard] Checking cookies:', cookies ? 'present' : 'none');
    if (cookies && cookies['access_token']) {
      console.log('[AuthGuard] Token found in cookies');
      return cookies['access_token'];
    }

    // Fallback to Authorization header for API proxy requests
    const authHeader = request.headers['authorization'];
    console.log(
      '[AuthGuard] Checking Authorization header:',
      authHeader ? 'present' : 'none',
    );
    if (authHeader && authHeader.startsWith('Bearer ')) {
      console.log('[AuthGuard] Token found in Authorization header');
      return authHeader.substring(7);
    }

    console.log(
      '[AuthGuard] No token found in cookies or Authorization header',
    );
    return null;
  }
}
