import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { OfferLettersController } from './offer-letters.controller';
import { OfferLettersService } from './offer-letters.service';
import { PDFGeneratorService } from './pdf-generator.service';
import { OTPService } from './otp.service';
import { OfferLetter } from './entities/offer-letter.entity';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';
import { Property } from '../properties/entities/property.entity';
import { Account } from '../users/entities/account.entity';
import { WhatsappBotModule } from '../whatsapp-bot/whatsapp-bot.module';
import { EventsModule } from '../events/events.module';
import { PaymentsModule } from '../payments/payments.module';

/**
 * OfferLettersModule
 * Provides offer letter functionality for tenant onboarding
 * Requirements: 10.1-10.9
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OfferLetter, KYCApplication, Property, Account]),
    ConfigModule,
    forwardRef(() => WhatsappBotModule),
    forwardRef(() => EventsModule),
    forwardRef(() => PaymentsModule),
  ],
  controllers: [OfferLettersController],
  providers: [OfferLettersService, PDFGeneratorService, OTPService],
  exports: [OfferLettersService, PDFGeneratorService, OTPService],
})
export class OfferLettersModule {}
