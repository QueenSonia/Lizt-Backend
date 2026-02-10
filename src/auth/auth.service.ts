import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IReqUser } from 'src/base.entity';
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

  async generateRefreshToken(
    accountId: string,
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
