/**
 * Coarse taxonomy of owner-directed notifications. Every landlord-directed
 * send (WhatsApp template today; potentially email later) declares one of
 * these so the future per-landlord subscription table can key on
 * (landlord_account_id, category) without renaming anything at call sites.
 */
export enum NotificationCategory {
  KYC = 'kyc',
  MAINTENANCE = 'maintenance',
  MAINTENANCE_CHAT = 'maintenance_chat',
  PAYMENTS = 'payments',
  RENEWALS = 'renewals',
  OFFER_LETTERS = 'offer_letters',
  TENANCY = 'tenancy',
}
