import { Injectable } from '@nestjs/common';
import { transporter } from './nodemailer-config';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import sgMail from '@sendgrid/mail';
import { randomBytes } from 'crypto';

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

  normalizePhoneNumber = (phone_number: string): string => {
    console.log(`Original phone number: ${phone_number}`);
    if (!phone_number) return '';

    // Remove all non-digit characters
    const cleaned = phone_number.replace(/\D/g, '');

    // Handle different formats
    if (cleaned.startsWith('234')) {
      // Already in international format without +
      const result = `+${cleaned}`;
      console.log(`Normalized phone number: ${result}`);
      return result;
    } else if (cleaned.startsWith('0')) {
      // Nigerian local format (0234...)
      const result = `+234${cleaned.substring(1)}`;
      console.log(`Normalized phone number: ${result}`);
      return result;
    } else if (cleaned.length === 10) {
      // 10 digits without country code
      const result = `+234${cleaned}`;
      console.log(`Normalized phone number: ${result}`);
      return result;
    }

    // Default: assume it needs +234 prefix
    const result = `+234${cleaned}`;
    console.log(`Normalized phone number: ${result}`);
    return result;
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

  generatePassword = async () => {
    const plainPassword = randomBytes(8).toString('hex'); // e.g., 16 chars random password
    const hashedPassword = await this.hashPassword(plainPassword);
    return hashedPassword;
  };

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
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * 10)];
    }
    return otp;
  }

  toSentenceCase(text: string): string {
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }
}
