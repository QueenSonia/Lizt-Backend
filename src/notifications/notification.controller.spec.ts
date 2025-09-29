import { Test, TestingModule } from '@nestjs/testing';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationType } from './enums/notification-type';

describe('NotificationController', () => {
  let controller: NotificationController;
  let service: NotificationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [NotificationService],
    }).compile();

    controller = module.get<NotificationController>(NotificationController);
    service = module.get<NotificationService>(NotificationService);
  });

  it('should return created notification from controller', async () => {
    const result = controller.create({
      date: '2025-03-20',
      type: NotificationType.LEASE_SIGNED,
      description: 'You signed rental agreement.',
      status: 'Completed',
      property_id: '',
    });

    expect(result).toHaveProperty('id');
    expect((await result).type).toBe(NotificationType.LEASE_SIGNED);
  });
});
