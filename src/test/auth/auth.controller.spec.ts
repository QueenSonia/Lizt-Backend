import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '../../auth/auth.controller';
import { AuthService } from '../../auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // describe('generateToken', () => {
  //   it('should call AuthService.generateToken and return the token', async () => {
  //     const user = {
  //       id: '1',
  //       email: 'test@example.com',
  //       role: 'user',
  //       first_name: 'Test',
  //       last_name: 'User',
  //       phone_number: '09012345678',
  //     };
  //     const token = 'mocked-token';
  //     const generateTokenSpy = jest
  //       .spyOn(authService, 'generateToken')
  //       .mockResolvedValue(token);

  //     const result = await controller.generateToken(user);

  //     expect(generateTokenSpy).toHaveBeenCalledWith(user);
  //     expect(result).toBe(token);
  //   });

  //   it('should throw an error if AuthService.generateToken fails', async () => {
  //     const user = {
  //       id: '1',
  //       email: 'test@example.com',
  //       role: 'user',
  //       first_name: 'Test',
  //       last_name: 'User',
  //       phone_number: '09012345678',
  //     };
  //     const error = new Error('Token generation failed');
  //     jest.spyOn(authService, 'generateToken').mockRejectedValue(error);

  //     await expect(controller.generateToken(user)).rejects.toThrow(error);
  //   });
  // });
});
