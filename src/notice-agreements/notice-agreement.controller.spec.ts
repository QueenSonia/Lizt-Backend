import { Test, TestingModule } from '@nestjs/testing';
import { NoticeAgreementController } from './notice-agreement.controller';
import { NoticeAgreementService } from './notice-agreement.service';

describe('NoticeAgreementController', () => {
  let controller: NoticeAgreementController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NoticeAgreementController],
      providers: [NoticeAgreementService],
    }).compile();

    controller = module.get<NoticeAgreementController>(NoticeAgreementController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});