"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rentReminderEmailTemplate = exports.clientForgotPasswordTemplate = exports.clientSignUpWhatsappTemplate = exports.clientSignUpEmailTemplate = exports.EmailSubject = void 0;
var EmailSubject;
(function (EmailSubject) {
    EmailSubject["WELCOME_EMAIL"] = "Welcome to Panda Homes!";
    EmailSubject["COMPLETE_PROFILE"] = "Kindly Complete Your Profile";
    EmailSubject["SEND_RENT_REMINDER"] = "Rent Payment Reminder";
    EmailSubject["RESEND_OTP"] = "OTP Request";
})(EmailSubject || (exports.EmailSubject = EmailSubject = {}));
const clientSignUpEmailTemplate = (tenant, link) => `
  <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #ffffff;">
    <!-- Header with logo and social icons -->
    <div style="padding: 40px 40px 20px 40px; background-color: #ffffff;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px;">
        <div style="color: #785DBA; font-size: 28px; font-weight: bold;">panda</div>
        <div style="display: flex; gap: 15px;">
          <div style="width: 24px; height: 24px; background-color: #9CA3AF; border-radius: 50%;"></div>
          <div style="width: 24px; height: 24px; background-color: #9CA3AF; border-radius: 50%;"></div>
          <div style="width: 24px; height: 24px; background-color: #9CA3AF; border-radius: 50%;"></div>
        </div>
      </div>
      
      <!-- Main heading -->
      <h1 style="font-size: 32px; font-weight: 600; color: #374151; margin: 0 0 30px 0; line-height: 1.2;">Welcome to Panda</h1>
      
      <!-- Greeting -->
      <p style="font-size: 16px; color: #6B7280; margin: 0 0 30px 0;">Hi ${tenant},</p>
      
      <!-- Main content -->
      <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 25px 0;">
        Welcome to the Panda app, your new home for managing everything about your tenancy in one place. With Panda, you can:
      </p>
      
      <!-- Feature list -->
      <ul style="margin: 0 0 30px 0; padding-left: 20px;">
        <li style="font-size: 16px; color: #374151; line-height: 1.6; margin-bottom: 8px;">View your rent, lease terms, and payment history</li>
        <li style="font-size: 16px; color: #374151; line-height: 1.6; margin-bottom: 8px;">Receive notices and updates from your property manager</li>
        <li style="font-size: 16px; color: #374151; line-height: 1.6; margin-bottom: 8px;">Track and submit maintenance/service requests</li>
        <li style="font-size: 16px; color: #374151; line-height: 1.6; margin-bottom: 8px;">Access all your documents anytime, anywhere</li>
      </ul>
      
      <!-- Call to action text -->
      <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 25px 0;">
        Click the button below to get started
      </p>
      
      <!-- Security note -->
      <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 25px 0;">
        This link is unique to you and will allow you to securely access your account.
      </p>
      
      <!-- Support text -->
      <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 30px 0;">
        If you have any questions or didn't expect this email, feel free to reply or contact your property manager directly.
      </p>
      
      <!-- Closing -->
      <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 5px 0;">Welcome again,</p>
      <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 40px 0;">— The Panda Team</p>
    </div>
    
    <!-- CTA Button -->
    <div style="padding: 0 40px 40px 40px;">
      <a href="${link}" style="display: inline-block; background-color: #785DBA; color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-size: 16px; font-weight: 600; text-align: center; min-width: 160px;" target="_blank">
        Let's Get Started
      </a>
    </div>
  </div>
`;
exports.clientSignUpEmailTemplate = clientSignUpEmailTemplate;
const clientSignUpWhatsappTemplate = (tenant, link) => `
  Welcome to Panda!

  Hi ${tenant},

  Your new home for managing your tenancy is here.

  ✅ View rent, lease, and history
  ✅ Get property updates
  ✅ Submit maintenance requests
  ✅ Access documents easily

  Click below to get started:
  ${link}

  - The Panda Team
`;
exports.clientSignUpWhatsappTemplate = clientSignUpWhatsappTemplate;
const clientForgotPasswordTemplate = (otp) => `
  <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #ffffff;">
    <!-- Header with logo and social icons -->
    <div style="padding: 40px 40px 20px 40px; background-color: #ffffff;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px;">
        <div style="color: #785DBA; font-size: 28px; font-weight: bold;">panda</div>
        <div style="display: flex; gap: 15px;">
          <div style="width: 24px; height: 24px; background-color: #9CA3AF; border-radius: 50%;"></div>
          <div style="width: 24px; height: 24px; background-color: #9CA3AF; border-radius: 50%;"></div>
          <div style="width: 24px; height: 24px; background-color: #9CA3AF; border-radius: 50%;"></div>
        </div>
      </div>
      
      <!-- Main heading -->
      <h1 style="font-size: 32px; font-weight: 600; color: #374151; margin: 0 0 30px 0; line-height: 1.2;">Password Reset Request</h1>
      
      <!-- Main content -->
      <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 30px 0;">
        You recently requested to reset your password. Use the OTP below to proceed:
      </p>
      
      <!-- OTP Display -->
      <div style="background-color: #F3F4F6; border: 2px solid #E5E7EB; border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0;">
        <div style="font-size: 48px; color: #785DBA; font-weight: bold; letter-spacing: 8px; font-family: monospace;">${otp}</div>
      </div>
      
      <!-- Validity notice -->
      <p style="font-size: 16px; color: #6B7280; line-height: 1.6; margin: 0 0 25px 0;">
        This OTP is valid for the next 10 minutes. If you did not request a password reset, please ignore this email.
      </p>
      
      <!-- Closing -->
      <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 30px 0 0 0;">
        — The Panda Team
      </p>
    </div>
  </div>
`;
exports.clientForgotPasswordTemplate = clientForgotPasswordTemplate;
const rentReminderEmailTemplate = (tenantName, amount, dueDate) => `
  <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #ffffff;">
    <!-- Header with logo and social icons -->
    <div style="padding: 40px 40px 20px 40px; background-color: #ffffff;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px;">
        <div style="color: #785DBA; font-size: 28px; font-weight: bold;">panda</div>
        <div style="display: flex; gap: 15px;">
          <div style="width: 24px; height: 24px; background-color: #9CA3AF; border-radius: 50%;"></div>
          <div style="width: 24px; height: 24px; background-color: #9CA3AF; border-radius: 50%;"></div>
          <div style="width: 24px; height: 24px; background-color: #9CA3AF; border-radius: 50%;"></div>
        </div>
      </div>
      
      <!-- Main heading -->
      <h1 style="font-size: 32px; font-weight: 600; color: #374151; margin: 0 0 30px 0; line-height: 1.2;">Rent Payment Reminder</h1>
      
      <!-- Greeting -->
      <p style="font-size: 16px; color: #6B7280; margin: 0 0 30px 0;">Dear ${tenantName},</p>
      
      <!-- Main content -->
      <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 25px 0;">
        This is a friendly reminder that your rent payment of ₦${amount} is due on ${dueDate}.
      </p>
      
      <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 25px 0;">
        To ensure timely payment and avoid any late fees, please process your payment using the approved payment methods.
      </p>
      
      <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 25px 0;">
        If you have already made the payment, please disregard this reminder.
      </p>

      <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 30px 0;">
        Thank you for your prompt attention to this matter.
      </p>
      
      <!-- Closing -->
      <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 5px 0;">
        Best regards,
      </p>
      <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 40px 0;">
        Your Property Management Team
      </p>
    </div>
    
    <!-- CTA Button -->
    <div style="padding: 0 40px 40px 40px;">
      <a href="#" style="display: inline-block; background-color: #785DBA; color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-size: 16px; font-weight: 600; text-align: center; min-width: 160px;">
        Pay Rent Now
      </a>
    </div>
    
    <!-- Footer -->
    <div style="background-color: #F9FAFB; padding: 20px 40px; text-align: center;">
      <p style="font-size: 14px; color: #6B7280; margin: 0; line-height: 1.5;">
        This is an automated message, please do not reply directly to this email.
      </p>
    </div>
  </div>
`;
exports.rentReminderEmailTemplate = rentReminderEmailTemplate;
//# sourceMappingURL=email-template.js.map