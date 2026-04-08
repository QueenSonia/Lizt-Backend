import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AutoBanService } from '../services/auto-ban.service';

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SecurityMiddleware.name);

  constructor(private autoBanService: AutoBanService) {}

  // Paths that should be blocked immediately
  private readonly blockedPaths = [
    '/vendor/phpunit',
    '/phpunit',
    '/lib/phpunit',
    '/wp-content',
    '/wp-admin',
    '/wp-includes',
    '/sites/all',
    '/sites/default',
    '/modules/',
    '/laravel',
    '/yii/',
    '/zend/',
    '/concrete/',
    '/simplesaml/',
    '/auth/saml',
    '/.env',
    '/.git',
    '/config/',
    '/admin/',
    '/phpmyadmin',
    '/mysql',
    '/database',
  ];

  // File extensions that should be blocked
  private readonly blockedExtensions = [
    '.php',
    '.asp',
    '.aspx',
    '.jsp',
    '.cgi',
    '.pl',
    '.py',
    '.rb',
    '.sh',
    '.bat',
    '.cmd',
  ];

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const path = req.path.toLowerCase();
      const method = req.method;
      const ip = this.getClientIp(req);

      // Check if IP is banned
      if (ip && (await this.autoBanService.isIPBanned(ip))) {
        this.logger.warn(`🚫 Blocked request from banned IP: ${ip}`);
        res.status(403).json({ message: 'Forbidden' });
        return;
      }

      // Check for suspicious activity
      const isSuspicious = this.isSuspiciousRequest(path, req);

      if (isSuspicious) {
        // Record suspicious activity
        if (ip) {
          await this.autoBanService.recordSuspiciousActivity({
            ip,
            path: req.path,
            timestamp: new Date(),
            userAgent: req.get('User-Agent'),
          });
        }

        this.logger.warn(
          `🚫 Blocked suspicious request: ${req.path} from IP: ${ip} (${method})`,
        );
        res.status(404).json({ message: 'Not Found' });
        return;
      }

      next();
    } catch (error) {
      this.logger.error(`Security middleware error: ${error.message}`);
      next();
    }
  }

  private isSuspiciousRequest(path: string, req: Request): boolean {
    // Block suspicious paths
    if (this.blockedPaths.some((blockedPath) => path.includes(blockedPath))) {
      return true;
    }

    // Block suspicious file extensions (except for legitimate API endpoints)
    if (this.blockedExtensions.some((ext) => path.endsWith(ext))) {
      return true;
    }

    // Block requests with suspicious query parameters
    const queryString = req.url.toLowerCase();
    if (
      queryString.includes('eval') ||
      queryString.includes('exec') ||
      queryString.includes('system')
    ) {
      return true;
    }

    return false;
  }

  private getClientIp(req: Request): string | undefined {
    return (
      req.get('CF-Connecting-IP') || // Cloudflare
      req.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
      req.get('X-Real-IP') ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      req.ip
    );
  }
}
