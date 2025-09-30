import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtStrategy } from 'src/auth/jwt.strategy';
import { IReqUser, RolesEnum } from 'src/base.entity';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('secret-key'),
          },
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('constructor', () => {
    it('should throw an error if JWT_SECRET is not defined', () => {
      jest.spyOn(configService, 'get').mockReturnValue(undefined);
      expect(() => new JwtStrategy(configService)).toThrow(
        'JWT_SECRET is not defined in environment variables',
      );
    });
  });

  describe('validate', () => {
    // Arrange
    it('should return user data from payload', async () => {
      const payload = {
        id: '1',
        email: 'test@example.com',
        role: RolesEnum.ADMIN,
        first_name: 'Test',
        last_name: 'User',
        phone_number: '09012345678',
      };

      // Act
      const result = await strategy.validate(payload);

      // Assert
      expect(result).toEqual({
        id: '1',
        email: 'test@example.com',
        role: RolesEnum.ADMIN,
        first_name: 'Test',
        last_name: 'User',
        phone_number: '09012345678',
      } as IReqUser);
    });
  });
});
