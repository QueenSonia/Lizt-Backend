import { Test, TestingModule } from '@nestjs/testing';
import { NoticeAgreementService } from './notice-agreement.service';

describe('NoticeAgreementService', () => {
  let service: NoticeAgreementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NoticeAgreementService],
    }).compile();

    service = module.get<NoticeAgreementService>(NoticeAgreementService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});