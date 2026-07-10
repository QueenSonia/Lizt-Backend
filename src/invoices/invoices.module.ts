import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoicePDFService } from './invoice-pdf.service';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLineItem } from './entities/invoice-line-item.entity';
import { InvoicePayment } from './entities/invoice-payment.entity';
import { OfferLetter } from '../offer-letters/entities/offer-letter.entity';
import { Property } from '../properties/entities/property.entity';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';
import { Account } from '../users/entities/account.entity';
import { WhatsappBotModule } from '../whatsapp-bot/whatsapp-bot.module';
import { AuthModule } from '../auth/auth.module';
import { PropertyHistoryModule } from '../property-history/property-history.module';
import { NotificationModule } from '../notifications/notification.module';
import { ScopeModule } from 'src/common/scope/scope.module';
import { UtilsModule } from '../utils/utils.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Invoice,
      InvoiceLineItem,
      InvoicePayment,
      OfferLetter,
      Property,
      KYCApplication,
      Account,
    ]),
    forwardRef(() => WhatsappBotModule),
    AuthModule,
    PropertyHistoryModule,
    NotificationModule,
    ScopeModule,
    UtilsModule,
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoicePDFService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
