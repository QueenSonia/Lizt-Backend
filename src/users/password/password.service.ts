import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
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
  ) {}

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
   * Initiates the forgot password flow by generating an OTP
   * and sending it to the user's email.
   * @param email The user's email address
   * @returns Object containing success message and token
   */
  async forgotPassword(email: string): Promise<ForgotPasswordResult> {
    try {
      const user = await this.accountRepository.findOne({ where: { email } });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      const otp = this.utilService.generateOTP(6);
      const token = uuidv4();
      const expires_at = new Date(Date.now() + 1000 * 60 * 5); // 5 minutes

      await this.passwordResetRepository.save({
        user_id: user.id,
        token,
        otp,
        expires_at,
      });

      const emailContent = clientForgotPasswordTemplate(otp);

      await this.utilService.sendEmail(
        email,
        EmailSubject.WELCOME_EMAIL,
        emailContent,
      );

      return {
        message: 'OTP sent to email',
        token,
      };
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

    await this.passwordResetRepository.save({
      user_id: user.id,
      token: newToken,
      otp: newOtp,
      expires_at,
    });

    const emailContent = clientForgotPasswordTemplate(newOtp);
    await this.utilService.sendEmail(
      user.email,
      EmailSubject.RESEND_OTP,
      emailContent,
    );

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
      this.eventEmitter.emit('user.signup', {
        user_id: user.id,
        profile_name: user.profile_name,
        property_id: user.property_tenants[0]?.property_id,
        role: RolesEnum.TENANT,
      });
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
