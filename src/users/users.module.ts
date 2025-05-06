import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Users } from './entities/user.entity';
import { AuthModule } from 'src/auth/auth.module';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { FileUploadService } from 'src/utils/cloudinary';
import { KYC } from './entities/kyc.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Users, PasswordResetToken, PropertyTenant, KYC]),
    AuthModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, FileUploadService],
  exports: [UsersService],
})
export class UsersModule {}
