import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

export interface KycVerifiedClaims {
  phone: string;
  kycToken: string;
  type: string;
}

@Injectable()
export class KycVerifiedGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException(
        'KYC verification token is required',
      );
    }

    try {
      const payload = await this.jwtService.verifyAsync<KycVerifiedClaims>(
        token,
        {
          secret: this.configService.get<string>('JWT_SECRET'),
          issuer: 'PANDA-HOMES',
        },
      );

      if (payload.type !== 'kyc-verification') {
        throw new UnauthorizedException('Invalid token type');
      }

      if (!payload.phone || !payload.kycToken) {
        throw new UnauthorizedException(
          'Invalid KYC verification token claims',
        );
      }

      (request as any).kycClaims = payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException(
        'KYC verification token is invalid or expired',
      );
    }

    return true;
  }

  private extractToken(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (authHeader) {
      const [scheme, token] = authHeader.split(' ');
      if (scheme === 'Bearer' && token) {
        return token;
      }
    }
    return undefined;
  }
}
