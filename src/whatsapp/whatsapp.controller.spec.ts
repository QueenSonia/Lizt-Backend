import { Test, TestingModule } from '@nestjs/testing';
import { TwilioController } from './whatsapp.controller';
import { TwilioService } from './services/twilio.service';

describe('TwilioController', () => {
  let controller: TwilioController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TwilioController],
      providers: [TwilioService],
    }).compile();

    controller = module.get<TwilioController>(TwilioController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
