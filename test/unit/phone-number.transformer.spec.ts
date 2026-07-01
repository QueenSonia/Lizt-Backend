import {
  normalizePhoneNumber,
  isValidPhone,
  toE164,
  formatPhoneForDisplay,
} from '../../src/utils/phone-number.transformer';

describe('phone-number.transformer', () => {
  describe('normalizePhoneNumber', () => {
    const ngForms = ['+2348031234567', '2348031234567', '08031234567', '8031234567'];
    it.each(ngForms)('normalizes NG form %s to 2348031234567', (input) => {
      expect(normalizePhoneNumber(input)).toBe('2348031234567');
    });

    it('keeps an explicit international number (UK)', () => {
      expect(normalizePhoneNumber('+447911123456')).toBe('447911123456');
    });

    it('keeps a bare already-international number (inbound `from`)', () => {
      expect(normalizePhoneNumber('447911123456')).toBe('447911123456');
      expect(normalizePhoneNumber('14155552671')).toBe('14155552671');
    });

    it('is idempotent for NG and foreign numbers', () => {
      for (const input of ['08031234567', '+447911123456', '+1 415 555 2671']) {
        const once = normalizePhoneNumber(input);
        expect(normalizePhoneNumber(once)).toBe(once);
      }
    });

    it('returns empty string for empty input', () => {
      expect(normalizePhoneNumber('')).toBe('');
    });
  });

  describe('isValidPhone', () => {
    it.each([
      '+447911123456',
      '447911123456', // already-normalized (no +) must still validate
      '08031234567',
      '2348031234567',
      '+1 (415) 555-2671',
    ])('accepts %s', (input) => {
      expect(isValidPhone(input)).toBe(true);
    });

    it.each(['', 'garbage', '12', '+999 123'])('rejects %s', (input) => {
      expect(isValidPhone(input)).toBe(false);
    });
  });

  describe('toE164', () => {
    it('returns +-prefixed E.164 or null', () => {
      expect(toE164('08031234567')).toBe('+2348031234567');
      expect(toE164('+447911123456')).toBe('+447911123456');
      expect(toE164('garbage')).toBeNull();
    });
  });

  describe('formatPhoneForDisplay', () => {
    it('renders NG numbers in local 0xxx form', () => {
      expect(formatPhoneForDisplay('2348031234567')).toBe('08031234567');
    });

    it('renders foreign numbers in international form', () => {
      expect(formatPhoneForDisplay('447911123456')).toBe('+44 7911 123456');
    });

    it('returns the placeholder for missing input', () => {
      expect(formatPhoneForDisplay(null)).toBe('—');
      expect(formatPhoneForDisplay('', '')).toBe('');
    });
  });
});
