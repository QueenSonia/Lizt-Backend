import { BadRequestException } from '@nestjs/common';
import { PasswordMatch } from 'src/auth/password-match.pipe';

describe('PasswordMatch', () => {
  let pipe: PasswordMatch;

  beforeEach(() => {
    pipe = new PasswordMatch();
  });

  it('should be defined', () => {
    expect(pipe).toBeDefined();
  });

  describe('transform', () => {
    it('should return value if passwords match', () => {
      const value = {
        new_password: 'password123',
        confirm_password: 'password123',
      };
      const metadata = {} as any;

      const result = pipe.transform(value, metadata);

      expect(result).toEqual(value);
    });

    it('should throw BadRequestException if passwords do not match', () => {
      const value = {
        new_password: 'password123',
        confirm_password: 'different',
      };
      const metadata = {} as any;

      expect(() => pipe.transform(value, metadata)).toThrow(
        BadRequestException,
      );
      expect(() => pipe.transform(value, metadata)).toThrow(
        'Passwords do not match',
      );
    });
  });
});
