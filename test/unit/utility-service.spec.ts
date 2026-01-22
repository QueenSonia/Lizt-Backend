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
  });
});
