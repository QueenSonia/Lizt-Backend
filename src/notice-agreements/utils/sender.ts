import * as nodemailer from 'nodemailer';
import axios from 'axios';
import { SendVia } from '../entities/notice-agreement.entity';
import dotenv from 'dotenv';

dotenv.config();

export const sendViaWhatsappOrEmail = async (
  filePath: string,
  sendVia: SendVia[],
  recipientEmail?: string,
  phoneNumber?: string,
) => {
  if (sendVia.includes(SendVia.EMAIL) && recipientEmail) {
    await sendEmailWithAttachment(filePath, recipientEmail);
  }

  if (sendVia.includes(SendVia.WHATSAPP) && phoneNumber) {
    await sendViaWhatsapp(filePath, phoneNumber);
  }
};

export const sendEmailWithAttachment = async (
  fileUrl: string,
  recipient: string,
) => {
  const transporter = nodemailer.createTransport({
    host: 'wghp11.wghservers.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  try {
    // ✅ Download file as a buffer
    const fileResponse = await axios.get(fileUrl, {
      responseType: 'arraybuffer',
    });

    // Extract filename from URL (optional)
    const filename = fileUrl.split('/').pop() || 'attachment.pdf';

    await transporter.sendMail({
      from: `"Property Admin" <${process.env.SMTP_USER}>`,
      to: recipient,
      subject: 'Notice Agreement',
      text: 'Please find the attached notice agreement.',
      attachments: [
        {
          filename,
          content: Buffer.from(fileResponse.data),
          contentType: 'application/pdf',
        },
      ],
    });

    console.log(`✅ Email sent to ${recipient}`);
  } catch (error) {
    console.error('❌ Failed to send email with attachment:', error.message);
    throw error;
  }
};

const sendViaWhatsapp = async (filePath: string, phoneNumber: string) => {
  // Placeholder: Integrate with Twilio or WhatsApp Business API
  console.log(`Sending ${filePath} to WhatsApp number ${phoneNumber}...`);
  // Actual implementation needed
};
