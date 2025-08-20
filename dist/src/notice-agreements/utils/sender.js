"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmailWithMultipleAttachments = exports.sendEmailWithAttachment = exports.sendViaWhatsappOrEmail = void 0;
const axios_1 = __importDefault(require("axios"));
const mail_1 = __importDefault(require("@sendgrid/mail"));
const notice_agreement_entity_1 = require("../entities/notice-agreement.entity");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
mail_1.default.setApiKey(process.env.SENDGRID_API_KEY);
const sendViaWhatsappOrEmail = async (filePath, sendVia, recipientEmail, phoneNumber) => {
    if (sendVia.includes(notice_agreement_entity_1.SendVia.EMAIL) && recipientEmail) {
        await (0, exports.sendEmailWithAttachment)(filePath, recipientEmail);
    }
    if (sendVia.includes(notice_agreement_entity_1.SendVia.WHATSAPP) && phoneNumber) {
        await sendViaWhatsapp(filePath, phoneNumber);
    }
};
exports.sendViaWhatsappOrEmail = sendViaWhatsappOrEmail;
const sendEmailWithAttachment = async (fileUrl, recipient) => {
    try {
        const response = await axios_1.default.get(fileUrl, { responseType: 'arraybuffer' });
        const filename = fileUrl.split('/').pop() || 'attachment.pdf';
        const content = Buffer.from(response.data).toString('base64');
        const msg = {
            to: recipient,
            from: 'hello@getpanda.co',
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
        await mail_1.default.send(msg);
        console.log(`✅ Email sent to ${recipient}`);
    }
    catch (error) {
        console.error('❌ Failed to send email with attachment:', error.response?.body || error.message);
        throw error;
    }
};
exports.sendEmailWithAttachment = sendEmailWithAttachment;
const sendEmailWithMultipleAttachments = async (fileUrls, recipient) => {
    try {
        const attachments = await Promise.all(fileUrls.map(async (url) => {
            const response = await axios_1.default.get(url, { responseType: 'arraybuffer' });
            const filename = url.split('/').pop() || 'attachment.pdf';
            return {
                content: Buffer.from(response.data).toString('base64'),
                filename,
                type: 'application/pdf',
                disposition: 'attachment',
            };
        }));
        const msg = {
            to: recipient,
            from: 'hello@getpanda.co',
            subject: 'Notice Agreement Documents',
            text: 'Please find the attached notice agreement documents.',
            attachments,
        };
        await mail_1.default.send(msg);
        console.log(`✅ Email sent to ${recipient} with ${attachments.length} attachment(s)`);
    }
    catch (error) {
        console.error('❌ Failed to send email with attachments:', error.response?.body || error.message);
        throw error;
    }
};
exports.sendEmailWithMultipleAttachments = sendEmailWithMultipleAttachments;
const sendViaWhatsapp = async (filePath, phoneNumber) => {
    console.log(`Sending ${filePath} to WhatsApp number ${phoneNumber}...`);
};
//# sourceMappingURL=sender.js.map