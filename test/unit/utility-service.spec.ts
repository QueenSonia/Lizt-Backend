import { Test, TestingModule } from '@nestjs/testing';
import { UtilService } from '../../src/utils/utility-service';

describe('UtilService', () => {
  let service: UtilService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UtilService],
    }).compile();

    service = module.get<UtilService>(UtilService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('normalizePhoneNumber', () => {
    it('should handle +234 format', () => {
      const result = service.normalizePhoneNumber('+2348031234567');
      expect(result).toBe('2348031234567');
    });

    it('should handle 234 format without plus', () => {
      const result = service.normalizePhoneNumber('2348031234567');
      expect(result).toBe('2348031234567');
    });

    it('should handle 0 prefix format (local Nigerian)', () => {
      const result = service.normalizePhoneNumber('08031234567');
      expect(result).toBe('2348031234567');
    });

    it('should handle 10-digit format', () => {
      const result = service.normalizePhoneNumber('8031234567');
      expect(result).toBe('2348031234567');
    });

    it('should handle phone numbers with spaces', () => {
      const result = service.normalizePhoneNumber('+234 803 123 4567');
      expect(result).toBe('2348031234567');
    });

    it('should handle phone numbers with dashes', () => {
      const result = service.normalizePhoneNumber('+234-803-123-4567');
      expect(result).toBe('2348031234567');
    });

    it('should handle phone numbers with parentheses', () => {
      const result = service.normalizePhoneNumber('+234(803)1234567');
      expect(result).toBe('2348031234567');
    });

    it('should return empty string for empty input', () => {
      const result = service.normalizePhoneNumber('');
      expect(result).toBe('');
    });

    it('should be idempotent - normalizing twice gives same result', () => {
      const phone = '08031234567';
      const normalized1 = service.normalizePhoneNumber(phone);
      const normalized2 = service.normalizePhoneNumber(normalized1);
      expect(normalized1).toBe(normalized2);
    });

    it('should handle different valid Nigerian phone formats consistently', () => {
      const formats = [
        '+2348031234567',
        '2348031234567',
        '08031234567',
        '8031234567',
      ];

      const results = formats.map((format) =>
        service.normalizePhoneNumber(format),
      );

      // All should produce the same result: 234XXXXXXXXXX (no + prefix)
      expect(results.every((result) => result === '2348031234567')).toBe(true);
    });

    it('should keep an international number entered with an explicit + (UK)', () => {
      expect(service.normalizePhoneNumber('+447911123456')).toBe(
        '447911123456',
      );
    });

    it('should keep a bare already-international number (inbound WhatsApp `from`)', () => {
      // Meta delivers `from` as country-code digits with no `+`; it must NOT be
      // re-interpreted as a Nigerian national number.
      expect(service.normalizePhoneNumber('447911123456')).toBe('447911123456');
    });

    it('should normalize a formatted US number', () => {
      expect(service.normalizePhoneNumber('+1 (415) 555-2671')).toBe(
        '14155552671',
      );
    });

    it('should be idempotent for a foreign number', () => {
      const once = service.normalizePhoneNumber('+447911123456');
      expect(service.normalizePhoneNumber(once)).toBe(once);
    });

    it('should not mis-parse NG mobile prefixes that collide with country codes', () => {
      // bare 70/81/90 collide with +7/+81/+90 — must still resolve to NG.
      expect(service.normalizePhoneNumber('7012345678')).toBe('2347012345678');
      expect(service.normalizePhoneNumber('8112345678')).toBe('2348112345678');
      expect(service.normalizePhoneNumber('9012345678')).toBe('2349012345678');
    });
  });
});
