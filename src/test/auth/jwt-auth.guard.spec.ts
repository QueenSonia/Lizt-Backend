import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from 'src/auth/auth.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    // Arrange
    it('should return true for public routes', () => {
      const context = {
        getHandler: jest.fn(),
        getClass: jest.fn(),
        switchToHttp: jest.fn(),
      } as unknown as ExecutionContext;

      // Act
      const getAllAndOverrideSpy = jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue(true);

      const result = guard.canActivate(context);

      // Assert
      expect(getAllAndOverrideSpy).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      expect(result).toBe(true);
    });

    // it('should delegate to parent AuthGuard for non-public routes', async () => {
    //   const context = {
    //     getHandler: jest.fn(),
    //     getClass: jest.fn(),
    //     switchToHttp: jest.fn(),
    //   } as unknown as ExecutionContext;

    //   const getAllAndOverrideSpy = jest
    //     .spyOn(reflector, 'getAllAndOverride')
    //     .mockReturnValue(false);

    //   // Mock the parent class method using jest.spyOn on the guard instance
    //   // Since canActivate is inherited, we need to mock the parent behavior differently
    //   const originalCanActivate = Object.getPrototypeOf(guard).canActivate;

    //   const parentCanActivateSpy = jest
    //     .fn()
    //     .mockImplementation((context) => Promise.resolve(true));

    //   // Replace the parent method temporarily
    //   Object.getPrototypeOf(guard).canActivate = parentCanActivateSpy;

    //   const result = await guard.canActivate(context);

    //   expect(getAllAndOverrideSpy).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
    //     context.getHandler(),
    //     context.getClass(),
    //   ]);
    //   expect(parentCanActivateSpy).toHaveBeenCalledWith(context);
    //   expect(result).toBe(true);

    //   // Restore original method
    //   Object.getPrototypeOf(guard).canActivate = originalCanActivate;
    // });
  });
});
