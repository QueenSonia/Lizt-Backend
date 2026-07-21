import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

export interface OnboardingVerifiedClaims {
  phone: string;
  onboardingToken: string;
  type: string;
}

/**
 * Authorizes onboarding draft save/load. Verifies the short-lived
 * `onboarding-verification` JWT minted by verifyOtp, attaching the claims
 * (verified phone + link token) to the request. Clone of `KycVerifiedGuard`.
 */
@Injectable()
export class OnboardingVerifiedGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException(
        'Onboarding verification token is required',
      );
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<OnboardingVerifiedClaims>(token, {
          secret: this.configService.get<string>('JWT_SECRET'),
          issuer: 'PANDA-HOMES',
        });

      if (payload.type !== 'onboarding-verification') {
        throw new UnauthorizedException('Invalid token type');
      }

      if (!payload.phone || !payload.onboardingToken) {
        throw new UnauthorizedException(
          'Invalid onboarding verification token claims',
        );
      }

      (request as any).onboardingClaims = payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException(
        'Onboarding verification token is invalid or expired',
      );
    }

    return true;
  }

  /**
   * The public onboarding page has no auth cookie, and the Next.js proxy only
   * forwards `Authorization` from the `access_token` cookie (dropping any
   * client-set Bearer header). So we also accept the verification JWT from the
   * request body (`verificationToken`) or query string, which the proxy DOES
   * forward.
   */
  private extractToken(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (authHeader) {
      const [scheme, token] = authHeader.split(' ');
      if (scheme === 'Bearer' && token) {
        return token;
      }
    }

    const bodyToken = (request.body as { verificationToken?: string })
      ?.verificationToken;
    if (bodyToken) {
      return bodyToken;
    }

    const queryToken = request.query?.verificationToken;
    if (typeof queryToken === 'string' && queryToken) {
      return queryToken;
    }

    return undefined;
  }
}
