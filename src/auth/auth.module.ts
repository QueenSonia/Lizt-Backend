import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RoleGuard } from './role.guard';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from 'src/users/entities/account.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { AccountCacheService } from './account-cache.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Account, RefreshToken]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        // signOptions: { expiresIn: '7d' }, // Access token: 7 days
        signOptions: { expiresIn: configService.get('JWT_ACCESS_EXPIRY') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    AccountCacheService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RoleGuard,
    },
  ],
  exports: [AuthService, JwtModule, TypeOrmModule, AccountCacheService],
})
export class AuthModule {}
