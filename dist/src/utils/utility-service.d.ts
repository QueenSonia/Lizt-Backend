import sgMail from '@sendgrid/mail';
declare class UtilityService {
    sendEmail: (email: string, subject: string, htmlContent: string) => Promise<[sgMail.ClientResponse, {}]>;
    hashPassword: (password: string) => Promise<string>;
    validatePassword: (password: string, hashedPassword: string) => Promise<boolean>;
    getUUID(): string;
    generateServiceRequestId(): string;
    generateOTP(length?: number): string;
    toSentenceCase(text: string): string;
}
export declare const UtilService: UtilityService;
export {};
