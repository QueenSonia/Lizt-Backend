import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { pdf, DocumentProps } from '@react-pdf/renderer';
import * as React from 'react';

import { KYCApplication } from './entities/kyc-application.entity';
import { KYCDocumentPDF, IKycApplication } from './pdf/kyc-document-pdf';
import { TemplateSenderService } from '../whatsapp-bot/template-sender';
import { UtilService } from '../utils/utility-service';

/**
 * Generates the landlord-facing KYC application PDF and ships it via
 * WhatsApp as the second message in the two-template Download KYC flow.
 *
 * Trigger: landlord taps the Download KYC quick-reply on the
 * `tenant_application_notification` template. The landlord-flow webhook
 * handler emits `whatsapp.button.kyc_application_download` with the
 * application id (parsed from the payload) and the landlord's phone
 * (from the webhook `from`). We respond by sending the
 * `kyc_application_attachment_landlord` template with the PDF.
 *
 * Mirrors PaymentHistoryPdfService.onPaymentReceiptDownloadButtonTap.
 */
@Injectable()
export class KycPdfService {
  private readonly logger = new Logger(KycPdfService.name);

  constructor(
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
    private readonly templateSenderService: TemplateSenderService,
    private readonly configService: ConfigService,
    private readonly utilService: UtilService,
  ) {}

  @OnEvent('whatsapp.button.kyc_application_download')
  async onDownloadKycButtonTap(event: {
    applicationId: string;
    phone: string;
  }): Promise<void> {
    try {
      await this.sendKycPdfViaWhatsApp(event.applicationId, event.phone);
    } catch (err) {
      this.logger.error(
        `Failed to deliver KYC PDF for application ${event.applicationId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  async sendKycPdfViaWhatsApp(
    applicationId: string,
    landlordPhone: string,
  ): Promise<void> {
    const application = await this.loadApplication(applicationId);
    const propertyName = application.property?.name || 'Property';
    const tenantName = this.buildTenantName(application);

    const pdfBuffer = await this.generatePdfBuffer(application, propertyName);
    const pdfFilename = this.buildFilename(tenantName);
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';

    await this.templateSenderService.sendKYCApplicationAttachmentLandlord({
      phone_number: landlordPhone,
      tenant_name: tenantName,
      property_name: propertyName,
      application_id: applicationId,
      pdf_buffer: pdfBuffer,
      pdf_filename: pdfFilename,
      frontend_url: frontendUrl,
    });
  }

  /**
   * HTTP-download path. Used by the landlord-chat-history doc card and any
   * direct download link (e.g. tapping the simulator's attachment card).
   * Authorization is verified by the controller before calling — we trust
   * the caller passed a valid landlordId.
   */
  async generatePdfForLandlord(
    applicationId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const application = await this.loadApplication(applicationId);
    const propertyName = application.property?.name || 'Property';
    const tenantName = this.buildTenantName(application);
    const buffer = await this.generatePdfBuffer(application, propertyName);
    return { buffer, filename: this.buildFilename(tenantName) };
  }

  private async loadApplication(
    applicationId: string,
  ): Promise<KYCApplication> {
    const application = await this.kycApplicationRepository.findOne({
      where: { id: applicationId },
      relations: ['property', 'property.owner', 'property.owner.user'],
    });
    if (!application) {
      throw new NotFoundException('KYC application not found');
    }
    return application;
  }

  private buildTenantName(application: KYCApplication): string {
    return (
      this.utilService.formatPersonName(
        application.first_name,
        application.last_name,
      ) || 'Applicant'
    );
  }

  private async generatePdfBuffer(
    application: KYCApplication,
    propertyName: string,
  ): Promise<Buffer> {
    const mapped = this.mapToIKycApplication(application);
    // pdf() is typed to require ReactElement<DocumentProps> (i.e. <Document>
    // directly). KYCDocumentPDF returns <Document> internally so the runtime
    // is correct, but TS can't prove that through the wrapper — cast the
    // element to the expected type at the boundary.
    const element = React.createElement(KYCDocumentPDF, {
      application: mapped,
      propertyName,
    }) as unknown as React.ReactElement<DocumentProps>;
    const instance = pdf(element);
    const stream = await instance.toBuffer();
    return streamToBuffer(stream);
  }

  /**
   * Maps the DB entity into the IKycApplication shape the
   * `KYCDocumentPDF` component expects. Mirrors the same transforms the
   * frontend `kyc-application-detail/[id]/page.tsx` route does when it
   * builds `formattedApplication` from the API response — so a
   * landlord-on-WhatsApp PDF matches the landlord-on-web Download PDF.
   */
  private mapToIKycApplication(app: KYCApplication): IKycApplication {
    const firstName = app.first_name || '';
    const lastName = app.last_name || '';
    const realUrl = (...candidates: Array<string | null | undefined>) => {
      for (const v of candidates) {
        if (typeof v === 'string' && v.length > 1 && v !== '-' && v !== '——') {
          return v;
        }
      }
      return undefined;
    };
    const passport = realUrl(app.passport_photo_url);
    const idDoc = realUrl(app.id_document_url);
    const empProof = realUrl(app.employment_proof_url);
    const bizProof = realUrl(app.business_proof_url);

    const documents: Array<{ name: string; url: string }> = [];
    if (passport)
      documents.push({ name: 'Passport Photograph', url: passport });
    if (idDoc) documents.push({ name: 'Means of Identification', url: idDoc });
    if (app.employment_status?.toLowerCase() === 'employed' && empProof) {
      documents.push({ name: 'Proof of Employment', url: empProof });
    }
    if (app.employment_status?.toLowerCase() === 'self-employed' && bizProof) {
      documents.push({ name: 'Proof of Business', url: bizProof });
    }

    const nextOfKin =
      app.next_of_kin_full_name || app.next_of_kin_phone_number
        ? {
            fullName: app.next_of_kin_full_name || '——',
            address: app.next_of_kin_address || '——',
            relationship: app.next_of_kin_relationship || '——',
            phone: app.next_of_kin_phone_number || '——',
            email: app.next_of_kin_email || '——',
          }
        : undefined;

    const proposedRentAmount = app.proposed_rent_amount
      ? typeof app.proposed_rent_amount === 'number'
        ? app.proposed_rent_amount
        : parseFloat(String(app.proposed_rent_amount))
      : 0;

    const tenantOffer = {
      proposedRentAmount,
      rentPaymentFrequency: (app.rent_payment_frequency || 'Monthly') as
        | 'Monthly'
        | 'Quarterly'
        | 'Bi-annually'
        | 'Annually',
      intendedUse: app.intended_use_of_property || undefined,
      isFirstTimeTenant: app.is_first_time_tenant || undefined,
      numberOfPreviousResidences: app.number_of_previous_residences || undefined,
      numberOfOccupants: app.number_of_occupants || undefined,
      numberOfCarsOwned: app.parking_needs || undefined,
      additionalNotes: app.additional_notes || undefined,
    };

    const referralAgent =
      app.referral_agent_full_name || app.referral_agent_phone_number
        ? {
            fullName: app.referral_agent_full_name || '——',
            phoneNumber: app.referral_agent_phone_number || '——',
          }
        : undefined;

    const dob = app.date_of_birth
      ? app.date_of_birth instanceof Date
        ? app.date_of_birth.toISOString().split('T')[0]
        : new Date(app.date_of_birth).toISOString().split('T')[0]
      : undefined;

    return {
      id: app.id,
      propertyId: app.property_id || '0',
      tenantId: app.tenant_id || undefined,
      name: `${firstName} ${lastName}`.trim() || 'Applicant',
      email: app.email || '——',
      phone: app.phone_number || '——',
      occupation: app.occupation || '——',
      idType: 'National ID',
      submittedDate:
        app.created_at instanceof Date
          ? app.created_at.toISOString()
          : app.created_at || new Date().toISOString(),

      surname: lastName || undefined,
      otherNames: firstName || undefined,
      contactAddress: app.contact_address || undefined,
      nationality: app.nationality || undefined,
      stateOfOrigin: app.state_of_origin || undefined,
      sex: app.gender || undefined,
      dateOfBirth: dob,
      passportPhoto: passport,
      religion: app.religion || undefined,

      profession: app.occupation || undefined,
      jobTitle: app.job_title || undefined,
      placeOfWork: app.employer_name || undefined,
      maritalStatus: app.marital_status || undefined,

      employmentStatus: app.employment_status || undefined,
      employerName: app.employer_name || undefined,
      workPhone: app.work_phone_number || undefined,
      monthlyIncome: app.monthly_net_income || undefined,
      officeAddress: app.work_address || undefined,
      yearsAtEmployer:
        app.length_of_employment || app.business_duration || undefined,

      natureOfBusiness: app.nature_of_business || undefined,
      businessName: app.business_name || undefined,
      businessAddress: app.business_address || undefined,
      businessDuration: app.business_duration || undefined,

      nextOfKin,
      tenantOffer,
      referralAgent,
      documents,
    };
  }

  private buildFilename(tenantName: string): string {
    const slug = tenantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const dateStr = new Date().toISOString().split('T')[0];
    return `kyc-application-${slug || 'tenant'}-${dateStr}.pdf`;
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}
