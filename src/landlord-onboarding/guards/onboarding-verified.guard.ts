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
   * The onboarding verification JWT travels in the request BODY
   * (`verificationToken`) or query string — never a client-set Bearer header
   * (the Next.js proxy drops those). We must read those FIRST: the proxy injects
   * an `Authorization: Bearer <access_token>` header from any login cookie the
   * viewer happens to have (e.g. a PM testing while signed into the dashboard),
   * and that login token is a valid JWT with the wrong `type` — letting it win
   * would reject every draft/submit call with "Invalid token type". The
   * Authorization header is only a last-resort fallback.
   */
  private extractToken(request: Request): string | undefined {
    const bodyToken = (request.body as { verificationToken?: string })
      ?.verificationToken;
    if (bodyToken) {
      return bodyToken;
    }

    const queryToken = request.query?.verificationToken;
    if (typeof queryToken === 'string' && queryToken) {
      return queryToken;
    }

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
