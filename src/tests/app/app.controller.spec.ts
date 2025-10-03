import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from '../../app.controller';
import { AppService } from '../../app.service';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
    appService = app.get<AppService>(AppService);
  });

  it('should be defined', () => {
    expect(appController).toBeDefined();
  });

  describe('getHello', () => {
    it('should call AppService.getHello and return "Hello World!"', () => {
      // Mock AppService.getHello
      const spy = jest
        .spyOn(appService, 'getHello')
        .mockReturnValue('Hello World!');

      const result = appController.getHello();
      expect(spy).toHaveBeenCalled();
      expect(result).toBe('Hello World!');
    });
  });
});
