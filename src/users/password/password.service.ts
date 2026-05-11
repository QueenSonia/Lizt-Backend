import {
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Response } from 'express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Account } from '../entities/account.entity';
import { PasswordResetToken } from '../entities/password-reset-token.entity';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { UtilService } from 'src/utils/utility-service';
import {
  clientForgotPasswordTemplate,
  EmailSubject,
} from 'src/utils/email-template';
import { RolesEnum } from 'src/base.entity';
import { TemplateSenderService } from 'src/whatsapp-bot/template-sender';

/**
 * Result type for forgot password operation
 */
export interface ForgotPasswordResult {
  message: string;
  token: string;
}

/**
 * Result type for OTP validation
 */
export interface ValidateOtpResult {
  message: string;
  token: string;
}

/**
 * Result type for resend OTP operation
 */
export interface ResendOtpResult {
  message: string;
  token: string;
}

/**
 * PasswordService handles all password-related operations including
 * forgot password, reset password, OTP validation, and token generation.
 * Extracted from UsersService to follow Single Responsibility Principle.
 */
@Injectable()
export class PasswordService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetRepository: Repository<PasswordResetToken>,
    private readonly dataSource: DataSource,
    private readonly utilService: UtilService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => TemplateSenderService))
    private readonly templateSenderService: TemplateSenderService,
  ) {}

  /**
   * Classify a forgot-password identifier as email or phone.
   * Mirrors the detection logic used by /users/login so users can use the
   * same string they sign in with.
   */
  private classifyIdentifier(
    identifier: string,
  ): { kind: 'email'; value: string } | { kind: 'phone'; value: string } {
    const trimmed = identifier.trim();
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
    const isPhone = /^[+]?[\d\s\-()]{10,}$/.test(trimmed.replace(/\s/g, ''));

    if (isEmail) {
      return { kind: 'email', value: trimmed.toLowerCase() };
    }
    if (isPhone) {
      return { kind: 'phone', value: trimmed.replace(/[\s\-()+]/g, '') };
    }
    throw new HttpException(
      'Invalid email or phone number format',
      HttpStatus.BAD_REQUEST,
    );
  }

  /**
   * Validates a password reset token.
   * @param token The token to validate
   * @returns The PasswordResetToken entity if valid
   * @throws HttpException if token is invalid or expired
   */
  private async validateResetToken(token: string): Promise<PasswordResetToken> {
    const resetEntry = await this.passwordResetRepository.findOne({
      where: { token },
    });

    if (!resetEntry) {
      throw new HttpException('Invalid token', HttpStatus.BAD_REQUEST);
    }

    if (resetEntry.expires_at < new Date()) {
      await this.passwordResetRepository.delete({ id: resetEntry.id });
      throw new HttpException('Token has expired', HttpStatus.BAD_REQUEST);
    }

    return resetEntry;
  }

  /**
   * Generates a password reset token for a user.
   * Used during user creation to allow setting initial password.
   * @param userId The user's account ID
   * @param queryRunner The query runner for transaction support
   * @returns The generated token string
   */
  async generatePasswordResetToken(
    userId: string,
    queryRunner: QueryRunner,
  ): Promise<string> {
    const token = uuidv4();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // Token valid for 24 hours

    const passwordReset = queryRunner.manager.create(PasswordResetToken, {
      id: uuidv4(),
      user_id: userId,
      token,
      expires_at: expiresAt,
    });

    await queryRunner.manager.save(PasswordResetToken, passwordReset);

    return token;
  }

  /**
   * Initiates the forgot-password flow. Accepts either an email or a phone
   * number; delivers the OTP on whichever channel matches the identifier
   * format. Email identifier → SendGrid email, phone identifier → WhatsApp
   * authentication template (`offer_letter_otp`, reused).
   *
   * The channel used is persisted on the password_reset_token row so a later
   * resendOtp can re-send via the same channel without re-prompting the user.
   *
   * @param identifier The user's email or phone number
   * @returns Object containing success message and token
   */
  async forgotPassword(identifier: string): Promise<ForgotPasswordResult> {
    try {
      const classified = this.classifyIdentifier(identifier);

      const user =
        classified.kind === 'email'
          ? await this.accountRepository.findOne({
              where: { email: classified.value },
            })
          : await this.accountRepository.findOne({
              where: { user: { phone_number: classified.value } },
              relations: ['user'],
            });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      const otp = this.utilService.generateOTP(6);
      const token = uuidv4();
      const expires_at = new Date(Date.now() + 1000 * 60 * 5); // 5 minutes
      const channel: 'email' | 'whatsapp' =
        classified.kind === 'email' ? 'email' : 'whatsapp';

      await this.passwordResetRepository.save({
        user_id: user.id,
        token,
        otp,
        expires_at,
        channel,
      });

      if (channel === 'email') {
        const emailContent = clientForgotPasswordTemplate(otp);
        await this.utilService.sendEmail(
          user.email,
          EmailSubject.LIZT_OTP,
          emailContent,
        );
        return { message: 'OTP sent to email', token };
      }

      // WhatsApp path. The phone may live on the joined user row even when
      // the account was looked up by email, so always re-load relations to
      // be safe.
      const phone =
        user.user?.phone_number ??
        (
          await this.accountRepository.findOne({
            where: { id: user.id },
            relations: ['user'],
          })
        )?.user?.phone_number;

      if (!phone) {
        throw new HttpException(
          'Account has no phone number on file; cannot send WhatsApp OTP',
          HttpStatus.BAD_REQUEST,
        );
      }

      await this.templateSenderService.sendOTPAuthentication({
        phone_number: phone,
        otp_code: otp,
      });

      return { message: 'OTP sent to WhatsApp', token };
    } catch (error) {
      console.error('[ForgotPassword Error]', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to process forgot password request',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Validates an OTP entered by the user.
   * @param otp The OTP to validate
   * @returns Object containing success message and token
   */
  async validateOtp(otp: string): Promise<ValidateOtpResult> {
    const entry = await this.passwordResetRepository.findOne({
      where: { otp },
    });

    if (!entry || entry.expires_at < new Date()) {
      throw new HttpException('Invalid or expired OTP', HttpStatus.BAD_REQUEST);
    }

    return {
      message: 'OTP validated successfully',
      token: entry.token,
    };
  }

  /**
   * Resends an OTP to the user's email.
   * Implements rate limiting to prevent abuse.
   * @param oldToken The previous token to invalidate
   * @returns Object containing success message and new token
   */
  async resendOtp(oldToken: string): Promise<ResendOtpResult> {
    const resetEntry = await this.passwordResetRepository.findOne({
      where: { token: oldToken },
    });

    if (!resetEntry) {
      throw new HttpException('Invalid token', HttpStatus.BAD_REQUEST);
    }

    const user = await this.accountRepository.findOne({
      where: { id: resetEntry.user_id },
    });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    // Prevent resending if recently sent (within last minute)
    const now = new Date();
    const timeDiff = (resetEntry.expires_at.getTime() - now.getTime()) / 1000;
    if (timeDiff > 840) {
      throw new HttpException(
        'OTP already sent recently. Please wait a moment before requesting again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Invalidate old token
    await this.passwordResetRepository.delete({ id: resetEntry.id });

    // Generate new OTP and token
    const newOtp = this.utilService.generateOTP(6);
    const newToken = uuidv4();
    const expires_at = new Date(Date.now() + 1000 * 60 * 5); // 5 minutes
    const channel = resetEntry.channel ?? 'email';

    await this.passwordResetRepository.save({
      user_id: user.id,
      token: newToken,
      otp: newOtp,
      expires_at,
      channel,
    });

    if (channel === 'whatsapp') {
      const accountWithUser = await this.accountRepository.findOne({
        where: { id: user.id },
        relations: ['user'],
      });
      const phone = accountWithUser?.user?.phone_number;
      if (!phone) {
        throw new HttpException(
          'Account has no phone number on file; cannot resend WhatsApp OTP',
          HttpStatus.BAD_REQUEST,
        );
      }
      await this.templateSenderService.sendOTPAuthentication({
        phone_number: phone,
        otp_code: newOtp,
      });
    } else {
      const emailContent = clientForgotPasswordTemplate(newOtp);
      await this.utilService.sendEmail(
        user.email,
        EmailSubject.LIZT_OTP,
        emailContent,
      );
    }

    return {
      message: 'OTP resent successfully',
      token: newToken,
    };
  }

  /**
   * Resets the user's password using a valid token.
   * Also marks the user as verified if not already.
   * @param payload The reset password DTO containing token and new password
   * @param res The Express response object
   * @returns JSON response with success message
   */
  async resetPassword(
    payload: ResetPasswordDto,
    res: Response,
  ): Promise<Response> {
    const { token, newPassword } = payload;

    const resetEntry = await this.validateResetToken(token);

    const user = await this.accountRepository.findOne({
      where: { id: resetEntry.user_id },
      relations: ['property_tenants'],
    });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    // Hash and update the password
    user.password = await this.utilService.hashPassword(newPassword);

    if (!user.is_verified) {
      user.is_verified = true;

      // Only fire the tenant-flavored signup notification for accounts that
      // are actually tenants. This used to fire unconditionally, which sent
      // a "now have access to the tenant dashboard" notification to FMs and
      // landlords completing first-time password setup — wrong audience.
      const isTenant =
        user.roles?.includes(RolesEnum.TENANT) || user.role === RolesEnum.TENANT;
      if (isTenant) {
        this.eventEmitter.emit('user.signup', {
          user_id: user.id,
          profile_name: user.profile_name,
          property_id: user.property_tenants[0]?.property_id,
          role: RolesEnum.TENANT,
        });
      }
    }

    await this.accountRepository.save(user);

    // Delete token after successful password reset
    await this.passwordResetRepository.delete({ id: resetEntry.id });

    return res.status(HttpStatus.OK).json({
      message: 'Password reset successful',
      user_id: user.id,
    });
  }
}
