// utils/sender.ts
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import { SendVia } from '../entities/notice-agreement.entity';

export const sendViaWhatsappOrEmail = async (
  filePath: string,
  sendVia: SendVia[],
  recipientEmail?: string,
  phoneNumber?: string
) => {
  if (sendVia.includes(SendVia.EMAIL) && recipientEmail) {
    await sendEmailWithAttachment(filePath, recipientEmail);
  }

  if (sendVia.includes(SendVia.WHATSAPP) && phoneNumber) {
    await sendViaWhatsapp(filePath, phoneNumber);
  }
};

const sendEmailWithAttachment = async (filePath: string, recipient: string) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER, // e.g., 'you@gmail.com'
      pass: process.env.EMAIL_PASS, // your app password
    },
  });

  await transporter.sendMail({
    from: `"Property Admin" <${process.env.EMAIL_USER}>`,
    to: recipient,
    subject: 'Notice Agreement',
    text: 'Please find the attached notice agreement.',
    attachments: [
      {
        filename: 'notice-agreement.pdf',
        path: filePath,
      },
    ],
  });
};

const sendViaWhatsapp = async (filePath: string, phoneNumber: string) => {
  // Placeholder: Integrate with Twilio or WhatsApp Business API
  console.log(`Sending ${filePath} to WhatsApp number ${phoneNumber}...`);
  // Actual implementation needed
};
