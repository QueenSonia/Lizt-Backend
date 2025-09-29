import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from 'src/auth/auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('secret-key'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateToken', () => {
    it('should generate a JWT token for a user', async () => {
      // Arrange
      const user = {
        id: '1',
        email: 'test@example.com',
        role: 'user',
        first_name: 'Test',
        last_name: 'User',
        phone_number: '09012345678',
      };
      const expectedPayload = { ...user, sub: user.id };
      const expectedToken = 'mocked-token';
      const jwtSignSpy = jest
        .spyOn(jwtService, 'signAsync')
        .mockResolvedValue(expectedToken);
      const configGetSpy = jest
        .spyOn(configService, 'get')
        .mockReturnValue('secret-key');

      // Act
      const result = await service.generateToken(user);

      // Assert
      expect(jwtSignSpy).toHaveBeenCalledWith(expectedPayload, {
        secret: 'secret-key',
        issuer: 'PANDA-HOMES',
        expiresIn: '365d',
      });
      expect(configGetSpy).toHaveBeenCalledWith('JWT_SECRET');
      expect(result).toBe(expectedToken);
    });
  });
});
