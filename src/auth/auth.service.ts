import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IReqUser } from 'src/base.entity';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async generateToken(user: IReqUser): Promise<string> {
    const payload = { ...user, sub: user.id };
    const account_token = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      issuer: 'PANDA-HOMES',
      expiresIn: '365d', // 1 year
    });
    return account_token;
  }
}
