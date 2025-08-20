"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UtilService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const uuid_1 = require("uuid");
const dotenv_1 = __importDefault(require("dotenv"));
const mail_1 = __importDefault(require("@sendgrid/mail"));
dotenv_1.default.config();
mail_1.default.setApiKey(process.env.SENDGRID_API_KEY);
class UtilityService {
    sendEmail = async (email, subject, htmlContent) => {
        try {
            const msg = {
                to: email,
                from: 'hello@getpanda.co',
                subject: subject,
                html: htmlContent,
            };
            const response = await mail_1.default.send(msg);
            return response;
        }
        catch (error) {
            console.error('Error sending email via SendGrid API:', error.response?.body || error.message);
            throw error;
        }
    };
    hashPassword = async (password) => {
        const saltRounds = 10;
        const salt = await bcryptjs_1.default.genSalt(saltRounds);
        const hash = await bcryptjs_1.default.hash(password, salt);
        return hash;
    };
    validatePassword = (password, hashedPassword) => {
        return bcryptjs_1.default.compare(password, hashedPassword);
    };
    getUUID() {
        return (0, uuid_1.v4)();
    }
    generateServiceRequestId() {
        const timestamp = Date.now().toString().slice(-6);
        const random = Math.random().toString(36).substring(2, 5).toUpperCase();
        return `#SR${timestamp}${random}`;
    }
    generateOTP(length = 6) {
        const digits = '0123456789';
        let otp = '';
        for (let i = 0; i < length; i++) {
            otp += digits[Math.floor(Math.random() * 10)];
        }
        return otp;
    }
    toSentenceCase(text) {
        if (!text)
            return '';
        return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    }
}
exports.UtilService = new UtilityService();
//# sourceMappingURL=utility-service.js.map