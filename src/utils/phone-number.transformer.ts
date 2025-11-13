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
 * Can be used in services, controllers, etc.
 */
export function normalizePhoneNumber(phoneNumber: string): string {
  if (!phoneNumber) return '';

  // Remove all non-digit characters
  let normalized = phoneNumber.replace(/\D/g, '');

  // If number already starts with '234' (Nigeria country code), leave it
  if (normalized.startsWith('234')) {
    return normalized;
  }

  // If number starts with '0', strip it and prepend '234'
  if (normalized.startsWith('0')) {
    normalized = '234' + normalized.slice(1);
    return normalized;
  }

  // If it's missing both '0' and '234' (e.g., "8031234567"), add '234'
  if (/^[7-9]\d{9}$/.test(normalized)) {
    normalized = '234' + normalized;
  }

  return normalized;
}
