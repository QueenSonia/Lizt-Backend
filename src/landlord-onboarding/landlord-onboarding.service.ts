import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';
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
import { LandlordOnboardingDraft } from './entities/landlord-onboarding-draft.entity';
import { LandlordOnboardingOtp } from './entities/landlord-onboarding-otp.entity';
import { Account } from '../users/entities/account.entity';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto';
import { UtilService } from '../utils/utility-service';
import { FileUploadService } from '../utils/cloudinary';
import { WhatsAppNotificationLogService } from '../whatsapp-bot/whatsapp-notification-log.service';
import { isValidPhone } from '../utils/phone-number.transformer';

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
    @InjectRepository(LandlordOnboardingDraft)
    private readonly draftRepo: Repository<LandlordOnboardingDraft>,
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
        expiresIn: '15m',
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

  /** Upsert the draft for (admin, phone). Admin resolved from the link token. */
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

    const existing = await this.draftRepo.findOne({
      where: { admin_id: link.admin_id, phone_number: normalizedPhone },
    });
    if (existing) {
      await this.draftRepo.update(existing.id, { data });
    } else {
      await this.draftRepo.save(
        this.draftRepo.create({
          admin_id: link.admin_id,
          phone_number: normalizedPhone,
          data,
        }),
      );
    }
    return { success: true };
  }

  async getDraft(
    token: string,
    phone: string,
  ): Promise<{ data: Record<string, any> | null }> {
    const link = await this.resolveActiveLink(token);
    if (!link) {
      throw new BadRequestException('Invalid or expired onboarding link');
    }
    const normalizedPhone = this.utilService.normalizePhoneNumber(phone);

    const draft = await this.draftRepo.findOne({
      where: { admin_id: link.admin_id, phone_number: normalizedPhone },
    });
    return { data: draft?.data ?? null };
  }

  // ---- Submit ----

  async submit(dto: SubmitOnboardingDto): Promise<{ submissionId: string }> {
    const link = await this.resolveActiveLink(dto.token);
    if (!link) {
      throw new BadRequestException('Invalid or expired onboarding link');
    }
    const adminId = link.admin_id;
    const normalizedPhone = this.utilService.normalizePhoneNumber(dto.phone);

    // Never trust client-supplied media URLs — only accept our own Cloudinary.
    for (const property of dto.properties) {
      for (const doc of property.documents ?? []) {
        if (!this.fileUploadService.isOwnedCloudinaryUrl(doc.url)) {
          throw new BadRequestException('Invalid document URL');
        }
      }
    }

    const submissionId = await this.dataSource.transaction(async (manager) => {
      const submission = await manager.save(
        manager.create(LandlordOnboardingSubmission, {
          admin_id: adminId,
          landlord_first_name: dto.first_name,
          landlord_last_name: dto.last_name,
          landlord_phone: normalizedPhone,
          country_code: dto.country_code ?? null,
          status: LandlordOnboardingStatus.PENDING,
          submitted_at: new Date(),
        }),
      );

      const properties = dto.properties.map((p) => {
        const occupied =
          p.occupancy_status === OnboardingOccupancyStatus.OCCUPIED;
        return manager.create(LandlordOnboardingProperty, {
          submission_id: submission.id,
          description: p.description,
          address: p.address,
          occupancy_status: p.occupancy_status,
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

      // The submission is complete — drop any saved draft for this landlord.
      await manager.delete(LandlordOnboardingDraft, {
        admin_id: adminId,
        phone_number: normalizedPhone,
      });

      return submission.id;
    });

    return { submissionId };
  }

  // ---- Admin reads (scoped to the admin's own link/submissions) ----

  async listSubmissions(
    adminId: string,
    search?: string,
  ): Promise<LandlordOnboardingSubmission[]> {
    const where = search?.trim()
      ? [
          { admin_id: adminId, landlord_first_name: ILike(`%${search.trim()}%`) },
          { admin_id: adminId, landlord_last_name: ILike(`%${search.trim()}%`) },
          { admin_id: adminId, landlord_phone: ILike(`%${search.trim()}%`) },
        ]
      : { admin_id: adminId };

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
      where: { id, admin_id: adminId },
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
