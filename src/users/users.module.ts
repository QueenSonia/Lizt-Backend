import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Users } from './entities/user.entity';
import { AuthModule } from 'src/auth/auth.module';
import { PasswordResetToken } from './entities/password-reset-token.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Users, PasswordResetToken]), AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
