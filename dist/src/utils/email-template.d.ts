export declare enum EmailSubject {
    WELCOME_EMAIL = "Welcome to Panda Homes!",
    COMPLETE_PROFILE = "Kindly Complete Your Profile",
    SEND_RENT_REMINDER = "Rent Payment Reminder",
    RESEND_OTP = "OTP Request"
}
export declare const clientSignUpEmailTemplate: (tenant: string, link: string) => string;
export declare const clientSignUpWhatsappTemplate: (tenant: string, link: string) => string;
export declare const clientForgotPasswordTemplate: (otp: string) => string;
export declare const rentReminderEmailTemplate: (tenantName: string, amount: number, dueDate: string) => string;
