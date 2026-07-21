import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { LandlordOnboardingController } from './landlord-onboarding.controller';
import { LandlordOnboardingService } from './landlord-onboarding.service';
import { OnboardingVerifiedGuard } from './guards/onboarding-verified.guard';
import { LandlordOnboardingLink } from './entities/landlord-onboarding-link.entity';
import { LandlordOnboardingSubmission } from './entities/landlord-onboarding-submission.entity';
import { LandlordOnboardingProperty } from './entities/landlord-onboarding-property.entity';
import { LandlordOnboardingDraft } from './entities/landlord-onboarding-draft.entity';
import { LandlordOnboardingOtp } from './entities/landlord-onboarding-otp.entity';
import { Account } from '../users/entities/account.entity';
import { FileUploadService } from '../utils/cloudinary';
import { UtilsModule } from '../utils/utils.module';
import { WhatsappBotModule } from '../whatsapp-bot/whatsapp-bot.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LandlordOnboardingLink,
      LandlordOnboardingSubmission,
      LandlordOnboardingProperty,
      LandlordOnboardingDraft,
      LandlordOnboardingOtp,
      Account,
    ]),
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
    UtilsModule,
    forwardRef(() => WhatsappBotModule),
  ],
  controllers: [LandlordOnboardingController],
  providers: [
    LandlordOnboardingService,
    FileUploadService,
    OnboardingVerifiedGuard,
  ],
  exports: [LandlordOnboardingService],
})
export class LandlordOnboardingModule {}
