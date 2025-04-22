import { Test, TestingModule } from '@nestjs/testing';
import { PropertyHistoryService } from './property-history.service';

describe('PropertyHistoryService', () => {
  let service: PropertyHistoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PropertyHistoryService],
    }).compile();

    service = module.get<PropertyHistoryService>(PropertyHistoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
