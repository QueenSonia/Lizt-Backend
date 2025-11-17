import {
  Body,
  Controller,
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

    // Generate new access token
    const tokenPayload: IReqUser = {
      id: account.id,
      first_name: account.user.first_name,
      last_name: account.user.last_name,
      email: account.email,
      phone_number: account.user.phone_number,
      role: account.role,
    };

    const newAccessToken =
      await this.authService.generateAccessToken(tokenPayload);

    const isProduction = process.env.NODE_ENV === 'production';

    // Set new access token cookie
    res.cookie('access_token', newAccessToken, {
      httpOnly: true,
      secure: isProduction,
      maxAge: 15 * 60 * 1000, // 15 minutes
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
}
