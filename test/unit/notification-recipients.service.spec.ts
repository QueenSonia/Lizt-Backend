import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Account } from 'src/users/entities/account.entity';
import { UtilService } from 'src/utils/utility-service';
import { NotificationRecipientsService } from 'src/common/notify/notification-recipients.service';
import { NotificationCategory } from 'src/common/notify/notification-category.enum';

describe('NotificationRecipientsService', () => {
  let service: NotificationRecipientsService;
  const accountRepository = { findOne: jest.fn() };

  const landlordUser = {
    first_name: 'Lami',
    last_name: 'Okoro',
    phone_number: '+2348010000001',
    email: 'lami@example.com',
  };
  const adminUser = {
    first_name: 'Ada',
    last_name: 'Eze',
    phone_number: '+2348020000002',
    email: 'ada@example.com',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationRecipientsService,
        { provide: getRepositoryToken(Account), useValue: accountRepository },
        {
          provide: UtilService,
          useValue: {
            normalizePhoneNumber: jest.fn((p: string) => p.replace(/^\+/, '')),
          },
        },
      ],
    }).compile();

    service = module.get(NotificationRecipientsService);
  });

  it('resolves the managing admin as the sole recipient (stub keeps landlord unsubscribed)', async () => {
    accountRepository.findOne.mockResolvedValue({
      id: 'landlord-1',
      profile_name: null,
      email: 'landlord-acc@example.com',
      user: landlordUser,
      creator: {
        id: 'admin-1',
        profile_name: 'Property Kraft',
        email: 'kraft@example.com',
        user: adminUser,
      },
    });

    const recipients = await service.resolveRecipients(
      'landlord-1',
      NotificationCategory.PAYMENTS,
    );

    expect(recipients).toEqual([
      {
        accountId: 'admin-1',
        kind: 'admin',
        name: 'Property Kraft',
        phone: '2348020000002',
        email: 'kraft@example.com',
      },
    ]);
  });

  it('falls back to the landlord when there is no managing admin', async () => {
    accountRepository.findOne.mockResolvedValue({
      id: 'landlord-1',
      profile_name: null,
      email: null,
      user: landlordUser,
      creator: null,
    });

    const recipients = await service.resolveRecipients(
      'landlord-1',
      NotificationCategory.MAINTENANCE,
    );

    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({
      accountId: 'landlord-1',
      kind: 'landlord',
      name: 'Lami Okoro',
      phone: '2348010000001',
      email: 'lami@example.com',
    });
  });

  it('de-dupes admin and landlord sharing a phone, admin leg winning', async () => {
    accountRepository.findOne.mockResolvedValue({
      id: 'landlord-1',
      profile_name: null,
      email: null,
      user: adminUser, // same person/phone as the admin
      creator: {
        id: 'admin-1',
        profile_name: 'Property Kraft',
        email: 'kraft@example.com',
        user: adminUser,
      },
    });
    // Force the future-subscribed path so both legs are produced.
    jest
      .spyOn(
        service as unknown as {
          isLandlordSubscribed: () => Promise<boolean>;
        },
        'isLandlordSubscribed',
      )
      .mockResolvedValue(true);

    const recipients = await service.resolveRecipients(
      'landlord-1',
      NotificationCategory.RENEWALS,
    );

    expect(recipients).toHaveLength(1);
    expect(recipients[0].kind).toBe('admin');
  });

  it('returns [] for a missing account and null phone when the user has none', async () => {
    accountRepository.findOne.mockResolvedValueOnce(null);
    expect(
      await service.resolveRecipients('ghost', NotificationCategory.KYC),
    ).toEqual([]);

    accountRepository.findOne.mockResolvedValueOnce({
      id: 'landlord-1',
      profile_name: 'No Phone Estates',
      email: null,
      user: { ...landlordUser, phone_number: null },
      creator: null,
    });
    const recipients = await service.resolveRecipients(
      'landlord-1',
      NotificationCategory.KYC,
    );
    expect(recipients[0].phone).toBeNull();
  });
});
