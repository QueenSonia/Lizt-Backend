import { transporter } from './nodemailer-config';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

class UtilityService {
  sendEmail = async (email: string, subject: string, htmlContent: string) => {
    try {
      const response = await transporter.sendMail({
        from: process.env.GMAIL_USER,
        to: email,
        subject,
        html: htmlContent,
      });
      return response;
    } catch (err) {
      console.error('Error sending email:', err);
    }
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

  generateServiceRequestId(previousId?: string): string {
    if (!previousId) {
      return '#SR001';
    }
    const number = parseInt(previousId.replace('#SR', '')) + 1;
    return `#SR${number.toString().padStart(3, '0')}`;
  }
}

export const UtilService = new UtilityService();
