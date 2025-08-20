import { Global, Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Users } from './entities/user.entity';
import { AuthModule } from 'src/auth/auth.module';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { FileUploadService } from 'src/utils/cloudinary';
import { KYC } from './entities/kyc.entity';
import { Account } from './entities/account.entity';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { Rent } from 'src/rents/entities/rent.entity';
import { RentsModule } from 'src/rents/rents.module';
import { Team } from './entities/team.entity';
import { TeamMember } from './entities/team-member.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Account,
      Users,
      PasswordResetToken,
      PropertyTenant,
      KYC,
      Rent,
      Team,
      TeamMember
    ]),
    AuthModule,
    WhatsappModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, FileUploadService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
