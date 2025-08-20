import axios from 'axios';
import sgMail from '@sendgrid/mail';
import { SendVia } from '../entities/notice-agreement.entity';
import dotenv from 'dotenv';

dotenv.config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

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
  try {
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const filename = fileUrl.split('/').pop() || 'attachment.pdf';
    const content = Buffer.from(response.data).toString('base64');

    const msg: sgMail.MailDataRequired = {
      to: recipient,
      from: 'hello@getpanda.co', // must be verified in SendGrid
      subject: 'Notice Agreement',
      text: 'Please find the attached notice agreement.',
      attachments: [
        {
          content,
          filename,
          type: 'application/pdf',
          disposition: 'attachment',
        },
      ],
    };

    await sgMail.send(msg);
    console.log(`✅ Email sent to ${recipient}`);
  } catch (error: any) {
    console.error('❌ Failed to send email with attachment:', error.response?.body || error.message);
    throw error;
  }
};

export const sendEmailWithMultipleAttachments = async (
  fileUrls: string[],
  recipient: string,
) => {
  try {
    const attachments = await Promise.all(
      fileUrls.map(async (url) => {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const filename = url.split('/').pop() || 'attachment.pdf';

        return {
          content: Buffer.from(response.data).toString('base64'),
          filename,
          type: 'application/pdf',
          disposition: 'attachment',
        };
      }),
    );

    const msg: sgMail.MailDataRequired = {
      to: recipient,
      from: 'hello@getpanda.co',
      subject: 'Notice Agreement Documents',
      text: 'Please find the attached notice agreement documents.',
      attachments,
    };

    await sgMail.send(msg);
    console.log(`✅ Email sent to ${recipient} with ${attachments.length} attachment(s)`);
  } catch (error: any) {
    console.error('❌ Failed to send email with attachments:', error.response?.body || error.message);
    throw error;
  }
};

const sendViaWhatsapp = async (filePath: string, phoneNumber: string) => {
  console.log(`Sending ${filePath} to WhatsApp number ${phoneNumber}...`);
  // Placeholder: Implement with Twilio or WhatsApp Business API
};
