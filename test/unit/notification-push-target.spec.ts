import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationService } from 'src/notifications/notification.service';
import { Notification } from 'src/notifications/entities/notification.entity';
import { Account } from 'src/users/entities/account.entity';
import { PushNotificationService } from 'src/notifications/push-notification.service';
import { ManagementScopeService } from 'src/common/scope/management-scope.service';
import { NotificationType } from 'src/notifications/enums/notification-type';
import { RolesEnum } from 'src/base.entity';

describe('NotificationService push retargeting', () => {
  let service: NotificationService;

  const notificationRepository = {
    create: jest.fn((dto) => dto),
    save: jest.fn(async (n) => ({ id: 'n-1', ...n })),
  };
  const accountRepository = { findOne: jest.fn() };
  const pushNotificationService = { sendToUser: jest.fn() };

  const dto = {
    date: '2026-07-07',
    type: NotificationType.PAYMENT_RECEIVED,
    description: 'Payment received',
    status: 'Completed' as const,
    property_id: 'prop-1',
    user_id: 'landlord-1',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: getRepositoryToken(Notification),
          useValue: notificationRepository,
        },
        { provide: getRepositoryToken(Account), useValue: accountRepository },
        { provide: PushNotificationService, useValue: pushNotificationService },
        {
          provide: ManagementScopeService,
          useValue: { resolveManagedLandlordIds: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(NotificationService);
  });

  it('pushes to the managing admin for a landlord-addressed notification', async () => {
    accountRepository.findOne.mockResolvedValue({
      id: 'landlord-1',
      roles: [RolesEnum.LANDLORD],
      creator_id: 'admin-1',
    });

    await service.create(dto);

    expect(pushNotificationService.sendToUser).toHaveBeenCalledWith(
      'admin-1',
      expect.objectContaining({ body: 'Payment received' }),
    );
  });

  it('keeps the landlord as push target when there is no managing admin', async () => {
    accountRepository.findOne.mockResolvedValue({
      id: 'landlord-1',
      roles: [RolesEnum.LANDLORD],
      creator_id: null,
    });

    await service.create(dto);

    expect(pushNotificationService.sendToUser).toHaveBeenCalledWith(
      'landlord-1',
      expect.anything(),
    );
  });

  it('never redirects non-landlord recipients (tenant-addressed rows)', async () => {
    accountRepository.findOne.mockResolvedValue({
      id: 'tenant-1',
      roles: [RolesEnum.TENANT],
      creator_id: 'admin-1', // tenant accounts may carry a creator too
    });

    await service.create({ ...dto, user_id: 'tenant-1' });

    expect(pushNotificationService.sendToUser).toHaveBeenCalledWith(
      'tenant-1',
      expect.anything(),
    );
  });

  it('still saves and pushes to the original id when the account lookup finds nothing', async () => {
    accountRepository.findOne.mockResolvedValue(null);

    const saved = await service.create(dto);

    expect(saved).toHaveProperty('id');
    expect(pushNotificationService.sendToUser).toHaveBeenCalledWith(
      'landlord-1',
      expect.anything(),
    );
  });
});
