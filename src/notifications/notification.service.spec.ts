import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { NotificationType } from './enums/notification-type';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationService],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  it('should create a notification', async () => {
    const notification = service.create({
        date: '2025-03-20',
        type: NotificationType.LEASE_SIGNED,
        description: 'You signed rental agreement.',
        status: 'Completed',
        property_id: ''
    });

    expect(notification).toHaveProperty('id');
    expect((await notification).type).toBe(NotificationType.LEASE_SIGNED);
  });
});
