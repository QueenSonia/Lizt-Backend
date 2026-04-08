import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class SecurityGuard implements CanActivate {
  private readonly logger = new Logger(SecurityGuard.name);

  // Suspicious paths that should be blocked immediately
  private readonly suspiciousPaths = [
    '/vendor/phpunit',
    '/phpunit',
    '/lib/phpunit',
    '/wp-content',
    '/sites/all',
    '/sites/default',
    '/modules/',
    '/laravel',
    '/yii/',
    '/zend/',
    '/concrete/',
    '/simplesaml/',
    '/auth/saml',
    'eval-stdin.php',
    '.php',
  ];

  // Suspicious user agents
  private readonly suspiciousUserAgents = [
    'python-requests',
    'curl/',
    'wget/',
    'scanner',
    'bot',
    'crawler',
    'spider',
  ];

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const path = request.path.toLowerCase();
    const userAgent = request.get('User-Agent')?.toLowerCase() || '';

    // Block requests to suspicious paths
    if (
      this.suspiciousPaths.some((suspiciousPath) =>
        path.includes(suspiciousPath),
      )
    ) {
      this.logger.warn(
        `Blocked suspicious path: ${request.path} from IP: ${request.ip}`,
      );
      throw new HttpException('Not Found', HttpStatus.NOT_FOUND);
    }

    // Block requests with suspicious user agents (optional - be careful with this)
    if (this.suspiciousUserAgents.some((agent) => userAgent.includes(agent))) {
      this.logger.warn(
        `Blocked suspicious user agent: ${userAgent} from IP: ${request.ip}`,
      );
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    return true;
  }
}
