import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RenewalLettersController } from './renewal-letters.controller';
import { RenewalLettersService } from './renewal-letters.service';
import { RenewalLetterOtpService } from './renewal-letter-otp.service';
import { RenewalInvoice } from '../tenancies/entities/renewal-invoice.entity';
import { PropertyTenant } from '../properties/entities/property-tenants.entity';
import { Property } from '../properties/entities/property.entity';
import { Rent } from '../rents/entities/rent.entity';
import { PropertyHistory } from '../property-history/entities/property-history.entity';
import { WhatsappBotModule } from '../whatsapp-bot/whatsapp-bot.module';
import { UtilsModule } from '../utils/utils.module';
import { AppCacheModule } from '../lib/cache';
import { PdfModule } from '../pdf/pdf.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RenewalInvoice,
      PropertyTenant,
      Property,
      Rent,
      PropertyHistory,
    ]),
    forwardRef(() => WhatsappBotModule),
    UtilsModule,
    AppCacheModule,
    PdfModule,
  ],
  controllers: [RenewalLettersController],
  providers: [RenewalLettersService, RenewalLetterOtpService],
  exports: [RenewalLettersService],
})
export class RenewalLettersModule {}
