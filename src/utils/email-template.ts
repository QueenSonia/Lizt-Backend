export enum EmailSubject {
  WELCOME_EMAIL = 'Welcome to Panda Homes!',
  COMPLETE_PROFILE = 'Kindly Complete Your Profile',
  SEND_RENT_REMINDER = 'Rent Payment Reminder',
}

export const clientSignUpEmailTemplate = (link: string) => `
  <div style="width: 60%; margin: 0 auto; text-align: center; padding: 20px; border-radius: 10px; border: 2px solid #ff8c00; background-color: #fffaf0; font-family: Arial, sans-serif;">
    <h3 style="font-size: 24px; color: #d2691e; margin-bottom: 10px;">Welcome to Panda Homes!</h3>
    <p style="font-size: 18px; color: #8b4513; margin: 10px 0;">
      We're excited to have you on board! To get started, please complete your profile.
    </p>
    <a href="${link}" style="display: inline-block; padding: 12px 20px; margin: 20px 0; font-size: 18px; color: #fff; background-color: #ff4500; text-decoration: none; border-radius: 5px;" target="_blank">
      Complete Your Profile
    </a>
    <p style="font-size: 18px; color: #2e8b57; margin: 10px 0;">
      If you have any questions, feel free to reach out to our support team.
    </p>
    <p style="font-size: 18px; color: #2e8b57; margin: 10px 0;">
      <strong style="color: #ff4500;">The Panda Homes Team</strong>
    </p>
  </div>
`;

export const rentReminderEmailTemplate = (
  tenantName: string,
  amount: number,
  dueDate: string,
) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
        <h1 style="color: #333;">Rent Payment Reminder</h1>
      </div>
      
      <div style="padding: 20px;">
        <p style="color: #666;">Dear ${tenantName},</p>
        
        <p style="color: #666; line-height: 1.6;">
          This is a friendly reminder that your rent payment of ₦${amount} is due on ${dueDate}.
        </p>
        
        <p style="color: #666; line-height: 1.6;">
          To ensure timely payment and avoid any late fees, please process your payment using the approved payment methods.
        </p>
        
        <div style="text-align: center; margin: 30px 0;">
          <div style="background-color: #007bff;
                      color: white;
                      padding: 12px 24px;
                      border-radius: 4px;
                      display: inline-block;
                      font-weight: bold;">
            Pay Rent Now
          </div>
        </div>
        
        <p style="color: #666; line-height: 1.6;">
          If you have already made the payment, please disregard this reminder.
        </p>

        <p style="color: #666; line-height: 1.6;">
          Thank you for your prompt attention to this matter.
        </p>
        
        <p style="color: #666; margin-top: 30px;">
          Best regards,<br>
          Your Property Management Team
        </p>
      </div>
      
      <div style="background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #666;">
        <p>This is an automated message, please do not reply directly to this email.</p>
      </div>
    </div>
  `;
