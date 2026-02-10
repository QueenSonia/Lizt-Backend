import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../../src/auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RefreshToken } from '../../src/auth/entities/refresh-token.entity';
import { Repository } from 'typeorm';
import { IReqUser, RolesEnum } from '../../src/base.entity';

type MockRepository = Partial<Record<keyof Repository<any>, jest.Mock>>;

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let configService: ConfigService;
  let refreshTokenRepository: MockRepository;

  const mockUser: IReqUser = {
    id: 'user-123',
    email: 'test@example.com',
    role: RolesEnum.LANDLORD,
    first_name: 'Test',
    last_name: 'User',
    phone_number: '+1234567890',
  };

  beforeEach(async () => {
    const mockJwtService = {
      signAsync: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_SECRET') return 'test-secret';
        return null;
      }),
    };

    refreshTokenRepository = {
      save: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        delete: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: refreshTokenRepository,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateToken', () => {
    it('should generate a JWT token with 7 days expiry', async () => {
      const expectedToken = 'jwt-token-123';
      (jwtService.signAsync as jest.Mock).mockResolvedValue(expectedToken);

      const result = await service.generateToken(mockUser);

      expect(result).toBe(expectedToken);
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { ...mockUser, sub: mockUser.id },
        {
          secret: 'test-secret',
          issuer: 'PANDA-HOMES',
          expiresIn: '7d',
        },
      );
    });
  });

  describe('generateAccessToken', () => {
    it('should generate an access token with 7 days expiry', async () => {
      const expectedToken = 'access-token-123';
      (jwtService.signAsync as jest.Mock).mockResolvedValue(expectedToken);

      const result = await service.generateAccessToken(mockUser);

      expect(result).toBe(expectedToken);
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { ...mockUser, sub: mockUser.id, type: 'access' },
        {
          secret: 'test-secret',
          issuer: 'PANDA-HOMES',
          expiresIn: '7d',
        },
      );
    });
  });

  describe('generateRefreshToken', () => {
    it('should create and save a refresh token', async () => {
      const accountId = 'account-123';
      const userAgent = 'Mozilla/5.0';
      const ipAddress = '192.168.1.1';

      const savedToken = {
        id: 'token-id',
        account_id: accountId,
        token: expect.any(String),
        expires_at: expect.any(Date),
        user_agent: userAgent,
        ip_address: ipAddress,
      };

      (refreshTokenRepository.save as jest.Mock).mockResolvedValue(savedToken);

      const result = await service.generateRefreshToken(
        accountId,
        userAgent,
        ipAddress,
      );

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(refreshTokenRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          account_id: accountId,
          token: expect.any(String),
          expires_at: expect.any(Date),
          user_agent: userAgent,
          ip_address: ipAddress,
        }),
      );
    });

    it('should set expiry date to 30 days from now', async () => {
      const accountId = 'account-123';
      let savedExpiryDate: Date;

      (refreshTokenRepository.save as jest.Mock).mockImplementation((data) => {
        savedExpiryDate = data.expires_at;
        return Promise.resolve(data);
      });

      await service.generateRefreshToken(accountId);

      const now = new Date();
      const thirtyDaysLater = new Date();
      thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

      expect(savedExpiryDate!.getTime()).toBeGreaterThan(now.getTime());
      expect(savedExpiryDate!.getTime()).toBeLessThanOrEqual(
        thirtyDaysLater.getTime(),
      );
    });
  });

  describe('validateRefreshToken', () => {
    it('should return token if valid and not expired', async () => {
      const token = 'valid-token';
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);

      const mockRefreshToken = {
        id: 'token-id',
        token,
        account_id: 'account-123',
        expires_at: futureDate,
        is_revoked: false,
      };

      (refreshTokenRepository.findOne as jest.Mock).mockResolvedValue(
        mockRefreshToken,
      );

      const result = await service.validateRefreshToken(token);

      expect(result).toEqual(mockRefreshToken);
      expect(refreshTokenRepository.findOne).toHaveBeenCalledWith({
        where: { token, is_revoked: false },
      });
    });

    it('should return null if token not found', async () => {
      (refreshTokenRepository.findOne as jest.Mock).mockResolvedValue(null);

      const result = await service.validateRefreshToken('invalid-token');

      expect(result).toBeNull();
    });

    it('should revoke and return null if token is expired', async () => {
      const token = 'expired-token';
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const mockRefreshToken = {
        id: 'token-id',
        token,
        expires_at: pastDate,
        is_revoked: false,
      };

      (refreshTokenRepository.findOne as jest.Mock).mockResolvedValue(
        mockRefreshToken,
      );
      (refreshTokenRepository.update as jest.Mock).mockResolvedValue({});

      const result = await service.validateRefreshToken(token);

      expect(result).toBeNull();
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { token },
        { is_revoked: true },
      );
    });
  });

  describe('revokeRefreshToken', () => {
    it('should mark token as revoked', async () => {
      const token = 'token-to-revoke';
      (refreshTokenRepository.update as jest.Mock).mockResolvedValue({});

      await service.revokeRefreshToken(token);

      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { token },
        { is_revoked: true },
      );
    });
  });

  describe('revokeAllUserTokens', () => {
    it('should revoke all non-revoked tokens for a user', async () => {
      const accountId = 'account-123';
      (refreshTokenRepository.update as jest.Mock).mockResolvedValue({});

      await service.revokeAllUserTokens(accountId);

      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { account_id: accountId, is_revoked: false },
        { is_revoked: true },
      );
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should delete all expired tokens', async () => {
      const mockQueryBuilder = {
        delete: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 5 }),
      };

      (refreshTokenRepository.createQueryBuilder as jest.Mock).mockReturnValue(
        mockQueryBuilder,
      );

      await service.cleanupExpiredTokens();

      expect(mockQueryBuilder.delete).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('expires_at < :now', {
        now: expect.any(Date),
      });
      expect(mockQueryBuilder.execute).toHaveBeenCalled();
    });
  });
});
