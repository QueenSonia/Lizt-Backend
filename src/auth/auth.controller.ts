import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SkipAuth } from './auth.decorator';
import { IReqUser } from 'src/base.entity';
import { Request, Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from 'src/users/entities/account.entity';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @InjectRepository(Account)
    private accountRepository: Repository<Account>,
  ) {}

  @SkipAuth()
  @Post('refresh')
  async refreshToken(@Req() req: Request, @Res() res: Response) {
    const refreshToken = req.cookies['refresh_token'];

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not found');
    }

    const tokenData = await this.authService.validateRefreshToken(refreshToken);

    if (!tokenData) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Get account details
    const account = await this.accountRepository.findOne({
      where: { id: tokenData.account_id },
      relations: ['user'],
    });

    if (!account) {
      throw new UnauthorizedException('Account not found');
    }

    // Generate new access token. Prefer the role the user picked at sign-in
    // (persisted on the refresh-token row). Fall back to roles[0] for legacy
    // rows that predate the active_role backfill.
    const tokenPayload: IReqUser = {
      id: account.id,
      first_name: account.user.first_name,
      last_name: account.user.last_name,
      email: account.email,
      phone_number: account.user.phone_number,
      role: tokenData.active_role ?? account.roles?.[0] ?? '',
    };

    const newAccessToken =
      await this.authService.generateAccessToken(tokenPayload);

    const isProduction = process.env.NODE_ENV === 'production';

    // Set new access token cookie
    res.cookie('access_token', newAccessToken, {
      httpOnly: true,
      secure: isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: isProduction ? 'none' : 'lax',
      path: '/', // Available to all paths
    });

    return res.json({ message: 'Token refreshed successfully' });
  }

  @Post('revoke')
  async revokeToken(@Req() req: Request, @Res() res: Response) {
    const refreshToken = req.cookies['refresh_token'];

    if (refreshToken) {
      await this.authService.revokeRefreshToken(refreshToken);
    }

    const isProduction = process.env.NODE_ENV === 'production';

    res.clearCookie('access_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });
    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });

    return res.json({ message: 'Token revoked successfully' });
  }

  /**
   * Mint a short-lived (60s) ticket the frontend uses to authenticate the
   * chat websocket handshake. Authenticated by the global JwtAuthGuard via
   * the access_token cookie, so the caller's identity comes from req.user.
   * The ticket carries `purpose: 'ws'` — chat.gateway.ts only accepts
   * tickets, never raw access tokens, so a leaked ticket can't be replayed
   * against the REST API.
   */
  @Get('ws-ticket')
  async wsTicket(@Req() req: Request) {
    const user = (req as Request & { user?: IReqUser }).user;
    if (!user?.id) {
      throw new UnauthorizedException();
    }
    const ticket = await this.authService.generateWsTicket({
      id: user.id,
      role: user.role,
    });
    return { ticket, expires_in: 60 };
  }
}
