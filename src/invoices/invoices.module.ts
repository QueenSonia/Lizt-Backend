import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLineItem } from './entities/invoice-line-item.entity';
import { InvoicePayment } from './entities/invoice-payment.entity';
import { OfferLetter } from '../offer-letters/entities/offer-letter.entity';
import { Property } from '../properties/entities/property.entity';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';
import { Users } from '../users/entities/user.entity';
import { WhatsappBotModule } from '../whatsapp-bot/whatsapp-bot.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Invoice,
      InvoiceLineItem,
      InvoicePayment,
      OfferLetter,
      Property,
      KYCApplication,
      Users,
    ]),
    forwardRef(() => WhatsappBotModule),
    AuthModule,
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
