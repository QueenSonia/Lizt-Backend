import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RenewalInvoice } from '../tenancies/entities/renewal-invoice.entity';
import { RenewalPDFService } from './renewal-pdf.service';

@Module({
  imports: [TypeOrmModule.forFeature([RenewalInvoice])],
  providers: [RenewalPDFService],
  exports: [RenewalPDFService],
})
export class PdfModule {}
