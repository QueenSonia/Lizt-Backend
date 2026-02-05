import { forwardRef, Global, Module } from '@nestjs/common';
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
import { Rent } from 'src/rents/entities/rent.entity';
import { RentsModule } from 'src/rents/rents.module';
import { Team } from './entities/team.entity';
import { TeamMember } from './entities/team-member.entity';
import { WhatsappBotModule } from 'src/whatsapp-bot/whatsapp-bot.module';
import { Waitlist } from './entities/waitlist.entity';
import { TenantKyc } from '../tenant-kyc/entities/tenant-kyc.entity';
import { SyncTenantDataService } from './sync-tenant-data.service';
import { UtilsModule } from 'src/utils/utils.module';
import { KYCApplication } from 'src/kyc-links/entities/kyc-application.entity';
import { OfferLetter } from 'src/offer-letters/entities/offer-letter.entity';
import { Payment } from 'src/payments/entities/payment.entity';
import { TenantManagementService } from './tenant-management';
import { TeamService } from './team';
import { PasswordService } from './password';

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
      TeamMember,
      Waitlist,
      TenantKyc,
      KYCApplication,
      OfferLetter,
      Payment,
    ]),
    AuthModule,
    forwardRef(() => WhatsappBotModule),
    UtilsModule,
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    FileUploadService,
    SyncTenantDataService,
    TenantManagementService,
    TeamService,
    PasswordService,
  ],
  exports: [
    UsersService,
    FileUploadService,
    SyncTenantDataService,
    TenantManagementService,
    TeamService,
    PasswordService,
  ],
})
export class UsersModule {}
