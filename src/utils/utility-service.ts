import { Injectable } from '@nestjs/common';
import { transporter } from './nodemailer-config';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import sgMail from '@sendgrid/mail';
import { randomBytes, randomInt } from 'crypto';
import { normalizePhoneNumber } from './phone-number.transformer';
import { MEMORABLE_PASSWORD_WORDLIST } from './memorable-password.wordlist';

dotenv.config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

@Injectable()
export class UtilService {
  //  sendEmail = async (email: string, subject: string, htmlContent: string) => {
  //   console.log(process.env.SENDGRID_API_KEY)
  //   try {
  //     const response = await transporter.sendMail({
  //       from: "Panda Admin <hello@getpanda.co>", // must be valid
  //       to: email,
  //       subject,
  //       html: htmlContent,
  //     });
  //     return response;
  //   } catch (err) {
  //     console.error('Error sending email:', err);
  //     throw err;
  //   }
  // };

  /**
   * Normalize phone number to consistent format: 234XXXXXXXXXX (no + prefix)
   * Delegates to the canonical implementation in phone-number.transformer.ts
   */
  normalizePhoneNumber = (phone_number: string): string => {
    return normalizePhoneNumber(phone_number);
  };

  sendEmail = async (email: string, subject: string, htmlContent: string) => {
    try {
      const msg = {
        to: email,
        from: 'hello@getpanda.co', // Must be verified in SendGrid
        subject: subject,
        html: htmlContent,
      };
      const response = await sgMail.send(msg);
      return response;
    } catch (error) {
      console.error(
        'Error sending email via SendGrid API:',
        error.response?.body || error.message,
      );
      throw error;
    }
  };

  /**
   * Generate a memorable temporary password (e.g. "panda-river-glass-42")
   * along with its bcrypt hash.
   *
   * Returns BOTH the plain string (for delivery via WhatsApp / email) and the
   * hashed value (for storage). Callers must keep the plain value out of any
   * persistent state — it should be sent and forgotten.
   */
  generatePassword = async (): Promise<{ plain: string; hash: string }> => {
    const plain = this.generateMemorablePassword();
    const hash = await this.hashPassword(plain);
    return { plain, hash };
  };

  private generateMemorablePassword(): string {
    const list = MEMORABLE_PASSWORD_WORDLIST;
    const word = (): string => list[randomInt(0, list.length)];
    const digits = String(randomInt(10, 100)); // 10..99 inclusive
    return `${word()}-${word()}-${word()}-${digits}`;
  }

  hashPassword = async (password: string) => {
    const saltRounds = 10;
    const salt = await bcrypt.genSalt(saltRounds);
    const hash = await bcrypt.hash(password, salt);
    return hash;
  };

  validatePassword = (password: string, hashedPassword: string) => {
    return bcrypt.compare(password, hashedPassword);
  };

  getUUID() {
    return uuidv4();
  }

  generateServiceRequestId(): string {
    const timestamp = Date.now().toString().slice(-6); // Last 6 digits of timestamp
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `#SR${timestamp}${random}`; // e.g., #SR893124X9K
  }

  generateOTP(length = 6): string {
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += randomInt(0, 10).toString();
    }
    return otp;
  }

  toSentenceCase(text: string): string {
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }
}
