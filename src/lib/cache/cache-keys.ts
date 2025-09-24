export const USER_2FA = (userId: string) => `session:user:2fa:${userId}`;

export const PHONE_CHANGE_SESSION = (phoneNumber: string) =>
  `session:phone_change:${phoneNumber}`;

export const PASSWORD_SESSION = (phoneNumber: string) =>
  `session:password_change:${phoneNumber}`;

export const SIGN_UP_SESSION = (phoneNumber: string) =>
  `session:signup:${phoneNumber}`;

export const USER_GROUPS = (userId: string) => `user:groups:${userId}`;
