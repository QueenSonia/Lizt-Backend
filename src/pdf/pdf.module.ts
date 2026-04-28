import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RenewalInvoice } from '../tenancies/entities/renewal-invoice.entity';
import { Property } from '../properties/entities/property.entity';
import { PropertyTenant } from '../properties/entities/property-tenants.entity';
import { RenewalPDFService } from './renewal-pdf.service';
import { RenewalLetterPdfService } from './renewal-letter-pdf.service';
import { FileUploadService } from '../utils/cloudinary';

@Module({
  imports: [
    TypeOrmModule.forFeature([RenewalInvoice, Property, PropertyTenant]),
  ],
  providers: [RenewalPDFService, RenewalLetterPdfService, FileUploadService],
  exports: [RenewalPDFService, RenewalLetterPdfService],
})
export class PdfModule {}
