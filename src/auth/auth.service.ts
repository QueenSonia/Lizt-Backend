import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IReqUser, RolesEnum } from 'src/base.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectRepository(RefreshToken)
    private refreshTokenRepository: Repository<RefreshToken>,
  ) {}

  async generateToken(user: IReqUser): Promise<string> {
    const payload = { ...user, sub: user.id };
    const account_token = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      issuer: 'PANDA-HOMES',
      expiresIn: '7d', // 7 days
    });
    return account_token;
  }

  async generateAccessToken(user: IReqUser): Promise<string> {
    const payload = { ...user, sub: user.id, type: 'access' };
    return await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      issuer: 'PANDA-HOMES',
      expiresIn: '7d', // 7 days for access token
    });
  }

  /**
   * Sign a short-lived (5 min) JWT used during multi-role login. The token
   * carries the candidate accountId + the roles the user is allowed to pick
   * from. It is NOT a session token — `purpose: 'role-selection'` distinguishes
   * it from access/refresh tokens so it cannot be misused as one.
   */
  async generateRoleSelectionTicket(payload: {
    accountId: string;
    userId: string;
    availableRoles: string[];
  }): Promise<string> {
    return await this.jwtService.signAsync(
      { ...payload, purpose: 'role-selection' },
      {
        secret: this.configService.get<string>('JWT_SECRET'),
        issuer: 'PANDA-HOMES',
        expiresIn: '5m',
      },
    );
  }

  async verifyRoleSelectionTicket(
    token: string,
  ): Promise<{ accountId: string; userId: string; availableRoles: string[] }> {
    const payload = await this.jwtService.verifyAsync(token, {
      secret: this.configService.get<string>('JWT_SECRET'),
      issuer: 'PANDA-HOMES',
    });
    if (payload?.purpose !== 'role-selection') {
      throw new Error('Token is not a role-selection ticket');
    }
    return {
      accountId: payload.accountId,
      userId: payload.userId,
      availableRoles: payload.availableRoles,
    };
  }

  /**
   * Sign a short-lived (60s) JWT used to authenticate a websocket handshake.
   * The chat gateway will not accept the long-lived access_token directly —
   * only tickets minted here. This keeps the HTTP-only access_token from ever
   * needing to be readable by JS (the frontend's `/api/auth/ws-ticket` route
   * exchanges the cookie for a ticket server-side, the browser only sees the
   * ticket, and the ticket dies in a minute even if it leaks).
   *
   * `purpose: 'ws'` is what makes this distinct from an access token — see
   * `verifyWsTicket` and chat.gateway.ts:afterInit for the enforcement.
   */
  async generateWsTicket(payload: {
    id: string;
    role?: string;
  }): Promise<string> {
    return await this.jwtService.signAsync(
      { ...payload, purpose: 'ws' },
      {
        secret: this.configService.get<string>('JWT_SECRET'),
        issuer: 'PANDA-HOMES',
        expiresIn: '60s',
      },
    );
  }

  async verifyWsTicket(
    token: string,
  ): Promise<{ id: string; role?: string }> {
    const payload = await this.jwtService.verifyAsync(token, {
      secret: this.configService.get<string>('JWT_SECRET'),
      issuer: 'PANDA-HOMES',
    });
    if (payload?.purpose !== 'ws') {
      throw new Error('Token is not a ws ticket');
    }
    return { id: payload.id, role: payload.role };
  }

  async generateRefreshToken(
    accountId: string,
    activeRole: RolesEnum,
    userAgent?: string,
    ipAddress?: string,
  ): Promise<string> {
    const token = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    await this.refreshTokenRepository.save({
      account_id: accountId,
      token,
      expires_at: expiresAt,
      user_agent: userAgent,
      ip_address: ipAddress,
      active_role: activeRole,
    });

    return token;
  }

  async validateRefreshToken(token: string): Promise<RefreshToken | null> {
    const refreshToken = await this.refreshTokenRepository.findOne({
      where: { token, is_revoked: false },
    });

    if (!refreshToken) {
      return null;
    }

    if (refreshToken.expires_at < new Date()) {
      await this.revokeRefreshToken(token);
      return null;
    }

    return refreshToken;
  }

  async revokeRefreshToken(token: string): Promise<void> {
    await this.refreshTokenRepository.update({ token }, { is_revoked: true });
  }

  async revokeAllUserTokens(accountId: string): Promise<void> {
    await this.refreshTokenRepository.update(
      { account_id: accountId, is_revoked: false },
      { is_revoked: true },
    );
  }

  async cleanupExpiredTokens(): Promise<void> {
    await this.refreshTokenRepository
      .createQueryBuilder()
      .delete()
      .where('expires_at < :now', { now: new Date() })
      .execute();
  }
}
