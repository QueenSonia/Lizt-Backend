export enum EmailSubject {
  WELCOME_EMAIL = 'Welcome to Panda Homes!',
  COMPLETE_PROFILE = 'Kindly Complete Your Profile',
}

export const clientSignUpEmailTemplate = (link: string) => `
  <div style="width: 60%; margin: 0 auto; text-align: center; padding: 20px; border-radius: 10px; border: 2px solid #ff8c00; background-color: #fffaf0; font-family: Arial, sans-serif;">
    <h3 style="font-size: 24px; color: #d2691e; margin-bottom: 10px;">Welcome to Panda Homes!</h3>
    <p style="font-size: 18px; color: #8b4513; margin: 10px 0;">
      We're excited to have you on board! To get started, please complete your profile.
    </p>
    <a href="${link}" style="display: inline-block; padding: 12px 20px; margin: 20px 0; font-size: 18px; color: #fff; background-color: #ff4500; text-decoration: none; border-radius: 5px;">
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
