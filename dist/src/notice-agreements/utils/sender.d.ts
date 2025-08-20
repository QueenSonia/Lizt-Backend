import { SendVia } from '../entities/notice-agreement.entity';
export declare const sendViaWhatsappOrEmail: (filePath: string, sendVia: SendVia[], recipientEmail?: string, phoneNumber?: string) => Promise<void>;
export declare const sendEmailWithAttachment: (fileUrl: string, recipient: string) => Promise<void>;
export declare const sendEmailWithMultipleAttachments: (fileUrls: string[], recipient: string) => Promise<void>;
