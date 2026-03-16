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
 * OTP cache entry structure
 * Stores OTP code, expiration time, and attempt count
 */
interface OTPCacheEntry {
  otp: string;
  expiresAt: number;
  attempts: number;
}

/**
 * OTP Service for renewal invoice verification
 * Handles OTP generation, storage, verification, and WhatsApp delivery
 * Requirements: 3.1-3.7
 */
@Injectable()
export class RenewalOTPService {
  private readonly logger = new Logger(RenewalOTPService.name);

  // OTP configuration
  private readonly OTP_LENGTH = 6;
  private readonly OTP_TTL_SECONDS = 600; // 10 minutes
  private readonly MAX_ATTEMPTS = 3;
  private readonly COOLDOWN_SECONDS = 60; // 60 seconds between resend requests

  constructor(
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => TemplateSenderService))
    private readonly templateSenderService: TemplateSenderService,
  ) {}

  /**
   * Generate a cryptographically secure 6-digit numeric OTP code
   * Uses crypto.randomInt for secure random number generation
   * Requirements: 3.2
   */
  generateOTP(): string {
    // Generate a cryptographically secure random 6-digit number (100000-999999)
    const otp = randomInt(100000, 1000000).toString();
    return otp;
  }

  /**
   * Get the cache key for a renewal invoice token
   */
  private getCacheKey(token: string): string {
    return `renewal_otp_${token}`;
  }

  /**
   * Get the cooldown cache key for rate limiting resend requests
   */
  private getCooldownKey(token: string): string {
    return `renewal_otp_cooldown_${token}`;
  }

  /**
   * Store OTP in cache with TTL and attempt tracking
   * Requirements: 3.2
   */
  async storeOTP(token: string, otp: string): Promise<void> {
    const cacheKey = this.getCacheKey(token);
    const entry: OTPCacheEntry = {
      otp,
      expiresAt: Date.now() + this.OTP_TTL_SECONDS * 1000,
      attempts: 0,
    };

    await this.cacheService.setWithTtlSeconds(
      cacheKey,
      entry,
      this.OTP_TTL_SECONDS,
    );

    this.logger.log(`OTP stored for renewal token ${token.substring(0, 8)}...`);
  }

  /**
   * Check if a resend request is within cooldown period
   * Requirements: 3.7
   */
  async isInCooldown(token: string): Promise<boolean> {
    const cooldownKey = this.getCooldownKey(token);
    return await this.cacheService.exists(cooldownKey);
  }

  /**
   * Set cooldown for resend requests
   */
  async setCooldown(token: string): Promise<void> {
    const cooldownKey = this.getCooldownKey(token);
    await this.cacheService.setWithTtlSeconds(
      cooldownKey,
      true,
      this.COOLDOWN_SECONDS,
    );
  }

  /**
   * Verify OTP with attempt tracking
   * Returns true if OTP is valid, throws error otherwise
   * Requirements: 3.5, 3.6
   */
  async verifyOTP(token: string, providedOtp: string): Promise<boolean> {
    const cacheKey = this.getCacheKey(token);
    const entry = await this.cacheService.get<OTPCacheEntry>(cacheKey);

    // Check if OTP exists
    if (!entry) {
      throw new BadRequestException(
        'Verification code expired. Please request a new one.',
      );
    }

    // Check if max attempts exceeded
    if (entry.attempts >= this.MAX_ATTEMPTS) {
      // Delete the OTP entry
      await this.cacheService.delete(cacheKey);
      throw new HttpException(
        'Too many attempts. Please request a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Check if OTP has expired
    if (Date.now() > entry.expiresAt) {
      await this.cacheService.delete(cacheKey);
      throw new BadRequestException(
        'Verification code expired. Please request a new one.',
      );
    }

    // Verify OTP
    if (entry.otp !== providedOtp) {
      // Increment attempt count
      entry.attempts += 1;
      const remainingTtl = Math.ceil((entry.expiresAt - Date.now()) / 1000);

      if (remainingTtl > 0) {
        await this.cacheService.setWithTtlSeconds(
          cacheKey,
          entry,
          remainingTtl,
        );
      }

      const remainingAttempts = this.MAX_ATTEMPTS - entry.attempts;
      if (remainingAttempts > 0) {
        throw new BadRequestException(
          `Invalid verification code. ${remainingAttempts} attempt${remainingAttempts > 1 ? 's' : ''} remaining.`,
        );
      } else {
        await this.cacheService.delete(cacheKey);
        throw new HttpException(
          'Too many attempts. Please request a new code.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // OTP is valid - delete it from cache
    await this.cacheService.delete(cacheKey);
    this.logger.log(
      `OTP verified successfully for renewal token ${token.substring(0, 8)}...`,
    );

    return true;
  }

  /**
   * Send OTP via WhatsApp using authentication template
   * Requirements: 3.2
   */
  async sendOTPViaWhatsApp(phoneNumber: string, otp: string): Promise<void> {
    try {
      // Send OTP using WhatsApp authentication template
      await this.templateSenderService.sendOTPAuthentication({
        phone_number: phoneNumber,
        otp_code: otp,
      });

      this.logger.log(`OTP sent via WhatsApp to ****${phoneNumber.slice(-4)}`);
    } catch (error) {
      this.logger.error(
        `Failed to send OTP via WhatsApp: ${error.message}`,
        error.stack,
      );
      throw new Error('Failed to send verification code. Please try again.');
    }
  }

  /**
   * Generate, store, and send OTP for renewal invoice verification
   * Combines all OTP operations into a single method
   * Requirements: 3.2, 3.7
   */
  async initiateOTPVerification(
    token: string,
    phoneNumber: string,
  ): Promise<void> {
    // Check cooldown for resend requests
    const isInCooldown = await this.isInCooldown(token);
    if (isInCooldown) {
      throw new HttpException(
        'Please wait before requesting a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Generate OTP
    const otp = this.generateOTP();

    // Store OTP in cache
    await this.storeOTP(token, otp);

    // Set cooldown for resend requests
    await this.setCooldown(token);

    // Send OTP via WhatsApp authentication template
    await this.sendOTPViaWhatsApp(phoneNumber, otp);
  }
}
