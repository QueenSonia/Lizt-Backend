import { Test, TestingModule } from '@nestjs/testing';
import { PropertyHistoryController } from './property-history.controller';
import { PropertyHistoryService } from './property-history.service';

describe('PropertyHistoryController', () => {
  let controller: PropertyHistoryController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PropertyHistoryController],
      providers: [PropertyHistoryService],
    }).compile();

    controller = module.get<PropertyHistoryController>(
      PropertyHistoryController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
