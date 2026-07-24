import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Not, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';
import { LandlordOnboardingLink } from './entities/landlord-onboarding-link.entity';
import {
  LandlordOnboardingSubmission,
  LandlordOnboardingStatus,
} from './entities/landlord-onboarding-submission.entity';
import {
  LandlordOnboardingProperty,
  OnboardingOccupancyStatus,
} from './entities/landlord-onboarding-property.entity';
import { LandlordOnboardingOtp } from './entities/landlord-onboarding-otp.entity';
import { Account, LandlordType } from '../users/entities/account.entity';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto';
import { UtilService } from '../utils/utility-service';
import { FileUploadService } from '../utils/cloudinary';
import { WhatsAppNotificationLogService } from '../whatsapp-bot/whatsapp-notification-log.service';
import { isValidPhone } from '../utils/phone-number.transformer';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnboardingSubmittedEvent } from '../notifications/events/onboarding-submitted.event';

export interface OnboardingLinkResponse {
  token: string;
  link: string;
}

@Injectable()
export class LandlordOnboardingService {
  constructor(
    @InjectRepository(LandlordOnboardingLink)
    private readonly linkRepo: Repository<LandlordOnboardingLink>,
    @InjectRepository(LandlordOnboardingSubmission)
    private readonly submissionRepo: Repository<LandlordOnboardingSubmission>,
    @InjectRepository(LandlordOnboardingOtp)
    private readonly otpRepo: Repository<LandlordOnboardingOtp>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly utilService: UtilService,
    private readonly fileUploadService: FileUploadService,
    @Inject(forwardRef(() => WhatsAppNotificationLogService))
    private readonly whatsappNotificationLogService: WhatsAppNotificationLogService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * One stable, reusable link per admin — reuse the existing active row rather
   * than minting a new token (mirrors `generateKYCLink`).
   */
  async generateLink(adminId: string): Promise<OnboardingLinkResponse> {
    const baseUrl = this.configService.get<string>('FRONTEND_URL');
    if (!baseUrl) {
      throw new BadRequestException('FRONTEND_URL is not configured');
    }

    let link = await this.linkRepo.findOne({
      where: { admin_id: adminId, is_active: true },
    });

    if (!link) {
      link = await this.linkRepo.save(
        this.linkRepo.create({ token: uuidv4(), admin_id: adminId }),
      );
    }

    return {
      token: link.token,
      link: `${baseUrl}/landlord-onboarding/${link.token}`,
    };
  }

  /**
   * Public: resolve a link token to its managing admin's display name so the
   * wizard can greet the landlord ("Welcome to <business>").
   */
  async validateToken(
    token: string,
  ): Promise<{ valid: boolean; businessName?: string }> {
    const link = await this.resolveActiveLink(token);
    if (!link) {
      return { valid: false };
    }

    const admin = await this.accountRepo.findOne({
      where: { id: link.admin_id },
    });

    return {
      valid: true,
      businessName: admin?.profile_name ?? undefined,
    };
  }

  uploadSignature() {
    return this.fileUploadService.generateUploadSignature('landlord-onboarding');
  }

  // ---- OTP + draft ("save & continue later") ----

  async sendOtp(
    token: string,
    phone: string,
  ): Promise<{ success: boolean; message: string; expiresAt?: Date }> {
    const link = await this.resolveActiveLink(token);
    if (!link) {
      throw new BadRequestException('Invalid or expired onboarding link');
    }

    if (!isValidPhone(phone)) {
      throw new BadRequestException('Invalid phone number');
    }
    const normalizedPhone = this.utilService.normalizePhoneNumber(phone);

    const recentOtp = await this.otpRepo.findOne({
      where: { phone_number: normalizedPhone, token },
      order: { created_at: 'DESC' },
    });
    if (
      recentOtp &&
      Date.now() - new Date(recentOtp.created_at!).getTime() < 60000
    ) {
      throw new BadRequestException(
        'OTP already sent recently. Please wait before requesting again.',
      );
    }

    await this.otpRepo.update(
      { phone_number: normalizedPhone, token, is_active: true },
      { is_active: false },
    );

    const otpCode = this.utilService.generateOTP(6);
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    const otp = await this.otpRepo.save(
      this.otpRepo.create({
        phone_number: normalizedPhone,
        otp_code: otpCode,
        token,
        expires_at: expiresAt,
        is_active: true,
        is_verified: false,
      }),
    );

    // Reuse the existing OTP-delivery template (no new Meta registration).
    await this.whatsappNotificationLogService.queue(
      'sendKYCOTPVerification',
      { phone_number: normalizedPhone, otp_code: otpCode },
      otp.id,
    );

    return { success: true, message: 'OTP queued for delivery', expiresAt };
  }

  async verifyOtp(
    token: string,
    phone: string,
    otpCode: string,
  ): Promise<{
    success: boolean;
    message: string;
    verified: boolean;
    verificationToken?: string;
  }> {
    const link = await this.resolveActiveLink(token);
    if (!link) {
      throw new BadRequestException('Invalid or expired onboarding link');
    }

    if (!isValidPhone(phone)) {
      throw new BadRequestException('Invalid phone number');
    }
    const normalizedPhone = this.utilService.normalizePhoneNumber(phone);

    const otp = await this.otpRepo.findOne({
      where: {
        phone_number: normalizedPhone,
        token,
        otp_code: otpCode,
        is_active: true,
      },
    });
    if (!otp) {
      throw new BadRequestException('Invalid OTP code');
    }
    if (new Date() > new Date(otp.expires_at)) {
      await this.otpRepo.update(otp.id, { is_active: false });
      throw new BadRequestException('OTP has expired. Please request a new one.');
    }
    if (otp.is_verified) {
      throw new BadRequestException('OTP has already been used');
    }

    await this.otpRepo.update(otp.id, { is_verified: true, is_active: false });

    const verificationToken = await this.jwtService.signAsync(
      { phone: normalizedPhone, onboardingToken: token, type: 'onboarding-verification' },
      {
        secret: this.configService.get<string>('JWT_SECRET'),
        // Long enough to complete/edit the multi-step wizard without re-verifying.
        expiresIn: '90m',
        issuer: 'PANDA-HOMES',
      },
    );

    return {
      success: true,
      message: 'Phone number verified successfully',
      verified: true,
      verificationToken,
    };
  }

  /**
   * Save the in-progress wizard state ("save & continue later"). Drafts and
   * submissions are one row per (admin, phone): a brand-new row is created as a
   * `draft`; an existing row (draft OR already-submitted) just has its `data`
   * blob refreshed — status is left untouched so a submitted application stays
   * submitted until it is actually re-submitted.
   */
  async saveDraft(
    token: string,
    phone: string,
    data: Record<string, any>,
  ): Promise<{ success: boolean }> {
    const link = await this.resolveActiveLink(token);
    if (!link) {
      throw new BadRequestException('Invalid or expired onboarding link');
    }
    const normalizedPhone = this.utilService.normalizePhoneNumber(phone);

    const existing = await this.submissionRepo.findOne({
      where: { admin_id: link.admin_id, landlord_phone: normalizedPhone },
    });
    if (existing) {
      await this.submissionRepo.update(existing.id, { data });
    } else {
      await this.submissionRepo.save(
        this.submissionRepo.create({
          admin_id: link.admin_id,
          landlord_phone: normalizedPhone,
          status: LandlordOnboardingStatus.DRAFT,
          data,
        }),
      );
    }
    return { success: true };
  }

  /** Return the prefill blob for (admin, phone) — draft or submitted alike. */
  async getDraft(
    token: string,
    phone: string,
  ): Promise<{ data: Record<string, any> | null }> {
    const link = await this.resolveActiveLink(token);
    if (!link) {
      throw new BadRequestException('Invalid or expired onboarding link');
    }
    const normalizedPhone = this.utilService.normalizePhoneNumber(phone);

    const row = await this.submissionRepo.findOne({
      where: { admin_id: link.admin_id, landlord_phone: normalizedPhone },
    });
    return { data: row?.data ?? null };
  }

  // ---- Submit ----

  /**
   * Submit (or re-submit) the onboarding application. Identity comes from the
   * VERIFIED claim (onboardingToken + normalized phone), not the request body.
   * Upserts the single `(admin, phone)` row: an existing row is updated (its
   * property rows replaced), status is (re)set to `pending`. Editing an
   * already-submitted application therefore reuses the same record and
   * re-notifies the managing admin.
   */
  async submit(
    onboardingToken: string,
    verifiedPhone: string,
    dto: SubmitOnboardingDto,
  ): Promise<{ submissionId: string }> {
    const link = await this.resolveActiveLink(onboardingToken);
    if (!link) {
      throw new BadRequestException('Invalid or expired onboarding link');
    }
    const adminId = link.admin_id;
    const normalizedPhone = this.utilService.normalizePhoneNumber(verifiedPhone);
    const isCorporate = dto.landlord_type === LandlordType.CORPORATE;

    // Never trust client-supplied media URLs — only accept our own Cloudinary.
    const allDocs = [
      ...(dto.id_documents ?? []),
      ...(dto.corporate_documents ?? []),
      ...dto.properties.flatMap((p) => [
        ...(p.ownership_documents ?? []),
        ...(p.documents ?? []),
      ]),
    ];
    for (const doc of allDocs) {
      if (!this.fileUploadService.isOwnedCloudinaryUrl(doc.url)) {
        throw new BadRequestException('Invalid document URL');
      }
    }

    const { submissionId, isUpdate } = await this.dataSource.transaction(
      async (manager) => {
        const existing = await manager.findOne(LandlordOnboardingSubmission, {
          where: { admin_id: adminId, landlord_phone: normalizedPhone },
        });
        // "Update" = a previously-submitted application being edited (a bare
        // draft being submitted for the first time is NOT an update).
        const wasSubmitted =
          !!existing && existing.status !== LandlordOnboardingStatus.DRAFT;

        const fields = {
          admin_id: adminId,
          landlord_first_name: dto.first_name,
          landlord_last_name: dto.last_name,
          landlord_phone: normalizedPhone,
          country_code: dto.country_code ?? null,
          status: LandlordOnboardingStatus.PENDING,
          submitted_at: new Date(),
          landlord_type: dto.landlord_type,
          email: dto.email ?? null,
          date_of_birth: isCorporate ? null : (dto.date_of_birth ?? null),
          employment_status: isCorporate
            ? null
            : (dto.employment_status ?? null),
          address: dto.address,
          company_name: isCorporate ? (dto.company_name ?? null) : null,
          id_type: isCorporate ? null : (dto.id_type ?? null),
          id_documents: isCorporate ? [] : (dto.id_documents ?? []),
          corporate_documents: isCorporate
            ? (dto.corporate_documents ?? [])
            : [],
          scope_services: dto.scope_services ?? [],
          scope_other: dto.scope_other ?? null,
          data: dto.data ?? null,
        };

        let submission: LandlordOnboardingSubmission;
        if (existing) {
          await manager.update(
            LandlordOnboardingSubmission,
            existing.id,
            fields,
          );
          await manager.delete(LandlordOnboardingProperty, {
            submission_id: existing.id,
          });
          submission = { ...existing, ...fields } as LandlordOnboardingSubmission;
        } else {
          submission = await manager.save(
            manager.create(LandlordOnboardingSubmission, fields),
          );
        }

        const properties = dto.properties.map((p) => {
          const occupied =
            p.occupancy_status === OnboardingOccupancyStatus.OCCUPIED;
          return manager.create(LandlordOnboardingProperty, {
            submission_id: submission.id,
            description: p.description,
            address: p.address,
            occupancy_status: p.occupancy_status,
            ownership_documents: p.ownership_documents ?? [],
            rent: occupied ? String(p.rent) : null,
            service_charge:
              occupied && p.service_charge != null
                ? String(p.service_charge)
                : null,
            tenant_first_name: occupied ? p.tenant_first_name : null,
            tenant_last_name: occupied ? p.tenant_last_name : null,
            tenant_phone: occupied ? p.tenant_phone : null,
            tenant_email: occupied ? (p.tenant_email ?? null) : null,
            tenancy_type: occupied ? p.tenancy_type : null,
            custom_duration: occupied ? (p.custom_duration ?? null) : null,
            tenancy_start_date: occupied ? p.tenancy_start_date : null,
            tenancy_end_date: occupied ? p.tenancy_end_date : null,
            documents: occupied ? p.documents : [],
          });
        });
        await manager.save(properties);

        return { submissionId: submission.id, isUpdate: wasSubmitted };
      },
    );

    const landlordName = this.utilService.sanitizeTemplateParam(
      `${dto.first_name} ${dto.last_name}`.trim(),
      60,
    );

    // Confirm receipt to the landlord on WhatsApp (queued → retried on failure).
    await this.whatsappNotificationLogService.queue(
      'sendLandlordOnboardingSubmitted',
      { phone_number: normalizedPhone, landlord_name: landlordName },
      submissionId,
    );

    // Notify the managing admin — WhatsApp + Live Feed — on first submit AND edit.
    await this.notifyAdminOfSubmission(
      adminId,
      submissionId,
      landlordName,
      isUpdate,
    );

    return { submissionId };
  }

  /** Managing-admin notification: WhatsApp to their phone + Live Feed row. */
  private async notifyAdminOfSubmission(
    adminId: string,
    submissionId: string,
    landlordName: string,
    isUpdate: boolean,
  ): Promise<void> {
    const admin = await this.accountRepo.findOne({
      where: { id: adminId },
      relations: ['user'],
    });
    const adminPhone = admin?.user?.phone_number;
    if (adminPhone) {
      await this.whatsappNotificationLogService.queue(
        'sendLandlordOnboardingSubmittedToAdmin',
        {
          phone_number: adminPhone,
          landlord_name: landlordName,
          is_update: isUpdate,
          submission_id: submissionId,
        },
        submissionId,
      );
    }

    this.eventEmitter.emit('onboarding.submitted', {
      admin_id: adminId,
      submission_id: submissionId,
      landlord_name: landlordName,
      is_update: isUpdate,
      date: new Date().toISOString(),
    } as OnboardingSubmittedEvent);
  }

  // ---- Admin reads (scoped to the admin's own link/submissions) ----

  async listSubmissions(
    adminId: string,
    search?: string,
  ): Promise<LandlordOnboardingSubmission[]> {
    // Only surface applications that have actually been submitted — never the
    // in-progress draft rows that now share this table.
    const notDraft = Not(LandlordOnboardingStatus.DRAFT);
    const where = search?.trim()
      ? [
          {
            admin_id: adminId,
            status: notDraft,
            landlord_first_name: ILike(`%${search.trim()}%`),
          },
          {
            admin_id: adminId,
            status: notDraft,
            landlord_last_name: ILike(`%${search.trim()}%`),
          },
          {
            admin_id: adminId,
            status: notDraft,
            landlord_phone: ILike(`%${search.trim()}%`),
          },
        ]
      : { admin_id: adminId, status: notDraft };

    return this.submissionRepo.find({
      where,
      relations: ['properties'],
      order: { submitted_at: 'DESC' },
    });
  }

  async getSubmission(
    id: string,
    adminId: string,
  ): Promise<LandlordOnboardingSubmission> {
    const submission = await this.submissionRepo.findOne({
      where: {
        id,
        admin_id: adminId,
        status: Not(LandlordOnboardingStatus.DRAFT),
      },
      relations: ['properties'],
    });
    if (!submission) {
      throw new NotFoundException('Onboarding submission not found');
    }
    return submission;
  }

  private async resolveActiveLink(
    token: string,
  ): Promise<LandlordOnboardingLink | null> {
    if (!token || typeof token !== 'string') {
      return null;
    }
    return this.linkRepo.findOne({
      where: { token: token.trim(), is_active: true },
    });
  }
}
