import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Receipt } from './entities/receipt.entity';
import { ReceiptGeneratorService } from './receipt-generator.service';
import { ReceiptsService } from './receipts.service';
import { ReceiptsController } from './receipts.controller';
import { OfferLetter } from '../offer-letters/entities/offer-letter.entity';
import { KYCApplication } from '../kyc-links/entities/kyc-application.entity';
import { Property } from '../properties/entities/property.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceLineItem } from '../invoices/entities/invoice-line-item.entity';
import { FileUploadService } from '../utils/cloudinary';
import { InvoicesModule } from '../invoices/invoices.module';
import { AuthModule } from '../auth/auth.module';
import { PropertyHistoryModule } from '../property-history/property-history.module';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Receipt,
      OfferLetter,
      KYCApplication,
      Property,
      Invoice,
      InvoiceLineItem,
    ]),
    ConfigModule,
    forwardRef(() => InvoicesModule),
    AuthModule,
    PropertyHistoryModule,
    NotificationModule,
  ],
  controllers: [ReceiptsController],
  providers: [ReceiptGeneratorService, ReceiptsService, FileUploadService],
  exports: [ReceiptGeneratorService, ReceiptsService],
})
export class ReceiptsModule {}
