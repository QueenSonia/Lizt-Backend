import { Transform } from 'class-transformer';
import { UtilService } from './utility-service';

/**
 * Decorator to automatically normalize phone numbers in DTOs
 * Converts local Nigerian format (0812...) to international format (2348...)
 *
 * Usage:
 * @NormalizePhoneNumber()
 * phone_number: string;
 */
export function NormalizePhoneNumber() {
  return Transform(({ value }) => {
    if (!value) return value;

    const utilService = new UtilService();
    return utilService.normalizePhoneNumber(value);
  });
}

/**
 * Standalone function to normalize phone numbers
 * Normalizes to format: 234XXXXXXXXXX (no + prefix)
 * Can be used in services, controllers, etc.
 */
export function normalizePhoneNumber(phoneNumber: string): string {
  if (!phoneNumber) return '';

  // Remove all non-digit characters (including +)
  const cleaned = phoneNumber.replace(/\D/g, '');

  // Already in correct format: 234XXXXXXXXXX
  if (cleaned.startsWith('234')) {
    return cleaned;
  }

  // Nigerian local format: 0XXXXXXXXXX -> 234XXXXXXXXXX
  if (cleaned.startsWith('0')) {
    return '234' + cleaned.slice(1);
  }

  // 10 digits without country code (e.g., 8031234567)
  if (/^[7-9]\d{9}$/.test(cleaned)) {
    return '234' + cleaned;
  }

  // Default: prepend 234
  return '234' + cleaned;
}
