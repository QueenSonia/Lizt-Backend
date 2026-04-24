import {
  Injectable,
  Logger,
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { CacheService } from '../lib/cache';
import { TemplateSenderService } from '../whatsapp-bot/template-sender';

/**
 * OTP service for renewal-letter acceptance.
 *
 * Parallel to offer-letters/otp.service.ts — same semantics, different
 * cache key namespace so a tenant accepting a renewal doesn't collide
 * with an unrelated offer-letter OTP challenge on the same token.
 *
 * Live challenge lives in Redis only (10-min TTL, 3-attempt lock, 60s
 * resend cooldown). The verified OTP is persisted to
 * renewal_invoices.acceptance_otp by the caller for the audit stamp.
 */
interface OTPCacheEntry {
  otp: string;
  expiresAt: number;
  attempts: number;
}

@Injectable()
export class RenewalLetterOtpService {
  private readonly logger = new Logger(RenewalLetterOtpService.name);

  private readonly OTP_TTL_SECONDS = 600;
  private readonly MAX_ATTEMPTS = 3;
  private readonly COOLDOWN_SECONDS = 60;

  constructor(
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => TemplateSenderService))
    private readonly templateSenderService: TemplateSenderService,
  ) {}

  generateOTP(): string {
    return randomInt(100000, 1000000).toString();
  }

  private getCacheKey(token: string): string {
    return `renewal_letter_otp_${token}`;
  }

  private getCooldownKey(token: string): string {
    return `renewal_letter_otp_cooldown_${token}`;
  }

  async storeOTP(token: string, otp: string): Promise<void> {
    const entry: OTPCacheEntry = {
      otp,
      expiresAt: Date.now() + this.OTP_TTL_SECONDS * 1000,
      attempts: 0,
    };
    await this.cacheService.setWithTtlSeconds(
      this.getCacheKey(token),
      entry,
      this.OTP_TTL_SECONDS,
    );
  }

  async isInCooldown(token: string): Promise<boolean> {
    return this.cacheService.exists(this.getCooldownKey(token));
  }

  async setCooldown(token: string): Promise<void> {
    await this.cacheService.setWithTtlSeconds(
      this.getCooldownKey(token),
      true,
      this.COOLDOWN_SECONDS,
    );
  }

  /**
   * Verify + consume the OTP. Returns the verified code on success so the
   * caller can persist it to renewal_invoices.acceptance_otp for the stamp.
   */
  async verifyOTP(token: string, providedOtp: string): Promise<string> {
    const cacheKey = this.getCacheKey(token);
    const entry = await this.cacheService.get<OTPCacheEntry>(cacheKey);

    if (!entry) {
      throw new BadRequestException(
        'Verification code expired. Please request a new one.',
      );
    }

    if (entry.attempts >= this.MAX_ATTEMPTS) {
      await this.cacheService.delete(cacheKey);
      throw new HttpException(
        'Too many attempts. Please request a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (Date.now() > entry.expiresAt) {
      await this.cacheService.delete(cacheKey);
      throw new BadRequestException(
        'Verification code expired. Please request a new one.',
      );
    }

    if (entry.otp !== providedOtp) {
      entry.attempts += 1;
      const remainingTtl = Math.ceil((entry.expiresAt - Date.now()) / 1000);
      if (remainingTtl > 0) {
        await this.cacheService.setWithTtlSeconds(
          cacheKey,
          entry,
          remainingTtl,
        );
      }
      const remaining = this.MAX_ATTEMPTS - entry.attempts;
      if (remaining > 0) {
        throw new BadRequestException(
          `Invalid verification code. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining.`,
        );
      }
      await this.cacheService.delete(cacheKey);
      throw new HttpException(
        'Too many attempts. Please request a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.cacheService.delete(cacheKey);
    return entry.otp;
  }

  async sendOTPViaWhatsApp(phoneNumber: string, otp: string): Promise<void> {
    try {
      await this.templateSenderService.sendOTPAuthentication({
        phone_number: phoneNumber,
        otp_code: otp,
      });
      this.logger.log(`Renewal OTP sent to ****${phoneNumber.slice(-4)}`);
    } catch (error) {
      this.logger.error(
        `Failed to send renewal OTP: ${error.message}`,
        error.stack,
      );
      throw new Error('Failed to send verification code. Please try again.');
    }
  }

  async initiateOTPVerification(
    token: string,
    phoneNumber: string,
  ): Promise<void> {
    if (await this.isInCooldown(token)) {
      throw new HttpException(
        'Please wait before requesting a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const otp = this.generateOTP();
    await this.storeOTP(token, otp);
    await this.setCooldown(token);
    await this.sendOTPViaWhatsApp(phoneNumber, otp);
  }
}
