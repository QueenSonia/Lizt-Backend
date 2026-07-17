import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { TenantFlowService } from '../../src/whatsapp-bot/tenant-flow';
import { TenantAiService } from '../../src/whatsapp-bot/tenant-ai.service';
import { TemplateSenderService } from '../../src/whatsapp-bot/template-sender';
import { FlowTokenService } from '../../src/whatsapp-bot/flow-token.service';
import { WhatsAppNotificationLogService } from '../../src/whatsapp-bot/whatsapp-notification-log.service';
import { MaintenanceMediaService } from '../../src/whatsapp-bot/maintenance-media.service';
import { MaintenanceRequestsService } from '../../src/maintenance-requests/maintenance-requests.service';
import { TenantBalancesService } from '../../src/tenant-balances/tenant-balances.service';
import { NextPeriodStateResolver } from '../../src/whatsapp-bot/tenant-flow/next-period-state.resolver';
import { NotificationRecipientsService } from '../../src/common/notify/notification-recipients.service';
import { CacheService } from '../../src/lib/cache';
import { UtilService } from '../../src/utils/utility-service';

import { Users } from '../../src/users/entities/user.entity';
import { MaintenanceRequest } from '../../src/maintenance-requests/entities/maintenance-request.entity';
import { PropertyTenant } from '../../src/properties/entities/property-tenants.entity';
import { Property } from '../../src/properties/entities/property.entity';
import { Rent } from '../../src/rents/entities/rent.entity';
import { RenewalInvoice } from '../../src/tenancies/entities/renewal-invoice.entity';

/**
 * Covers the tenancy gate's replay of an interrupted button tap.
 *
 * The bug this guards: a tenant with an unconfirmed tenancy who taps a
 * single-tap WhatsApp quick-reply (e.g. "Yes, confirm" on
 * tenant_confirm_filed_request) was intercepted by the gate, and the tap was
 * discarded — stranding the maintenance request in PENDING_TENANT_CONFIRMATION
 * with no way for the tenant to re-tap.
 */
describe('TenantFlowService — unconfirmed-tenancy gate replay', () => {
  let service: TenantFlowService;
  let cacheStore: Map<string, string>;
  let maintenanceRequestService: { confirmTenantMaintenanceRequest: jest.Mock };
  let templateSender: {
    sendText: jest.Mock;
    sendButtons: jest.Mock;
    sendTemplate: jest.Mock;
  };
  let propertyTenantRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };

  const PHONE = '2348123456789';
  const PENDING_KEY = `tenancy_pending_action_${PHONE}`;
  const ACCOUNT_ID = 'acc-1';
  const PROPERTY_ID = 'prop-1';

  /** An inbound WhatsApp interactive button reply. */
  const buttonMessage = (id: string) => ({
    from: PHONE,
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id, title: 'x' } },
  });

  const textMessage = (body: string) => ({
    from: PHONE,
    type: 'text',
    text: { body },
  });

  /** Rows the gate's `find` returns — i.e. tenancies still unconfirmed. */
  let unconfirmedRows: Array<{ property_id: string }>;

  beforeEach(async () => {
    cacheStore = new Map();
    unconfirmedRows = [{ property_id: PROPERTY_ID }];

    // A real (in-memory) cache — the stash→replay handoff IS the behaviour
    // under test, so a jest.fn() that never returns what it stored would make
    // these tests vacuous.
    const cache = {
      get: jest.fn((k: string) => Promise.resolve(cacheStore.get(k) ?? null)),
      set: jest.fn((k: string, v: string) => {
        cacheStore.set(k, v);
        return Promise.resolve();
      }),
      delete: jest.fn((k: string) => {
        cacheStore.delete(k);
        return Promise.resolve();
      }),
    };

    propertyTenantRepo = {
      // `select` distinguishes findTenantByPhone's tenant-account probe from
      // the gate's unconfirmed-tenancy query.
      find: jest.fn((opts: any) =>
        Promise.resolve(
          opts?.select ? [{ tenant_id: ACCOUNT_ID }] : unconfirmedRows,
        ),
      ),
      findOne: jest.fn(() => Promise.resolve({ property_id: PROPERTY_ID })),
      count: jest.fn(() => Promise.resolve(unconfirmedRows.length)),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
    };

    const usersRepo = {
      findOne: jest.fn(() =>
        Promise.resolve({
          id: 'user-1',
          first_name: 'Zeus',
          phone_number: PHONE,
          accounts: [{ id: ACCOUNT_ID, roles: ['tenant'] }],
        }),
      ),
      find: jest.fn(() => Promise.resolve([])),
    };

    maintenanceRequestService = {
      confirmTenantMaintenanceRequest: jest.fn(() => Promise.resolve({})),
    };

    templateSender = {
      sendText: jest.fn(() => Promise.resolve()),
      sendButtons: jest.fn(() => Promise.resolve()),
      sendTemplate: jest.fn(() => Promise.resolve()),
    };

    const noopRepo = {
      find: jest.fn(() => Promise.resolve([])),
      findOne: jest.fn(() => Promise.resolve(null)),
      count: jest.fn(() => Promise.resolve(0)),
      update: jest.fn(() => Promise.resolve({ affected: 0 })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantFlowService,
        { provide: getRepositoryToken(Users), useValue: usersRepo },
        { provide: getRepositoryToken(MaintenanceRequest), useValue: noopRepo },
        {
          provide: getRepositoryToken(PropertyTenant),
          useValue: propertyTenantRepo,
        },
        {
          provide: getRepositoryToken(Property),
          useValue: {
            ...noopRepo,
            findOne: jest.fn(() =>
              Promise.resolve({ id: PROPERTY_ID, name: 'DefensiveX' }),
            ),
          },
        },
        { provide: getRepositoryToken(Rent), useValue: noopRepo },
        { provide: getRepositoryToken(RenewalInvoice), useValue: noopRepo },
        { provide: CacheService, useValue: cache },
        {
          provide: UtilService,
          useValue: {
            normalizePhoneNumber: (p: string) => p,
            toSentenceCase: (s: string) => s,
            formatPersonName: (s: string) => s,
          },
        },
        {
          provide: MaintenanceRequestsService,
          useValue: maintenanceRequestService,
        },
        { provide: TemplateSenderService, useValue: templateSender },
        { provide: WhatsAppNotificationLogService, useValue: {} },
        { provide: FlowTokenService, useValue: {} },
        { provide: MaintenanceMediaService, useValue: {} },
        { provide: TenantBalancesService, useValue: {} },
        { provide: NextPeriodStateResolver, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: NotificationRecipientsService,
          useValue: { resolveRecipients: jest.fn(() => Promise.resolve([])) },
        },
        { provide: TenantAiService, useValue: {} },
      ],
    }).compile();

    service = module.get<TenantFlowService>(TenantFlowService);
  });

  it('stashes an intercepted button tap so it can be resumed', async () => {
    const blocked = await service.gateUnconfirmedTenant(
      buttonMessage('tenant_confirm_mr:mr-1') as any,
      PHONE,
    );

    expect(blocked).toBe(true);
    expect(cacheStore.has(PENDING_KEY)).toBe(true);
    expect(JSON.parse(cacheStore.get(PENDING_KEY)!)).toMatchObject({
      interactive: { button_reply: { id: 'tenant_confirm_mr:mr-1' } },
    });
  });

  it('does not stash free text (retyping is free; stale intent misfires)', async () => {
    const blocked = await service.gateUnconfirmedTenant(
      textMessage('my tank is dirty') as any,
      PHONE,
    );

    expect(blocked).toBe(true);
    expect(cacheStore.has(PENDING_KEY)).toBe(false);
  });

  it('does not stash the confirm/dispute escape hatch itself', async () => {
    const blocked = await service.gateUnconfirmedTenant(
      buttonMessage(`tenancy_details_correct:${PROPERTY_ID}`) as any,
      PHONE,
    );

    expect(blocked).toBe(false);
    expect(cacheStore.has(PENDING_KEY)).toBe(false);
  });

  it('replays the stashed tap once the tenancy is confirmed', async () => {
    // Tenant taps "Yes, confirm" on an FM-filed request while still gated.
    await service.gateUnconfirmedTenant(
      buttonMessage('tenant_confirm_mr:mr-1') as any,
      PHONE,
    );
    expect(
      maintenanceRequestService.confirmTenantMaintenanceRequest,
    ).not.toHaveBeenCalled();

    // They confirm their tenancy; nothing is left unconfirmed afterwards.
    unconfirmedRows = [];
    await service.handleInteractive(
      buttonMessage(`tenancy_details_correct:${PROPERTY_ID}`) as any,
      PHONE,
    );

    // The interrupted MR confirmation now lands, rather than being lost.
    expect(
      maintenanceRequestService.confirmTenantMaintenanceRequest,
    ).toHaveBeenCalledWith('mr-1', ACCOUNT_ID, 'whatsapp');
    expect(cacheStore.has(PENDING_KEY)).toBe(false);

    // ...and the dead-end "you're all set" card is suppressed in favour of the
    // replayed handler's own reply.
    const allSet = templateSender.sendButtons.mock.calls.find(
      (c: any[]) => typeof c[1] === 'string' && c[1].includes("you're all set"),
    );
    expect(allSet).toBeUndefined();
  });

  it('holds the stash while another tenancy is still unconfirmed', async () => {
    await service.gateUnconfirmedTenant(
      buttonMessage('tenant_confirm_mr:mr-1') as any,
      PHONE,
    );

    // Confirming one property leaves a second still unconfirmed — the gate
    // would still block, so the action must not run yet.
    unconfirmedRows = [{ property_id: 'prop-2' }];
    await service.handleInteractive(
      buttonMessage(`tenancy_details_correct:${PROPERTY_ID}`) as any,
      PHONE,
    );

    expect(
      maintenanceRequestService.confirmTenantMaintenanceRequest,
    ).not.toHaveBeenCalled();
    expect(cacheStore.has(PENDING_KEY)).toBe(true);

    // Confirming the last one chains through to the replay.
    unconfirmedRows = [];
    await service.handleInteractive(
      buttonMessage('tenancy_details_correct:prop-2') as any,
      PHONE,
    );

    expect(
      maintenanceRequestService.confirmTenantMaintenanceRequest,
    ).toHaveBeenCalledWith('mr-1', ACCOUNT_ID, 'whatsapp');
  });

  it('drops the stash when the tenant disputes their details', async () => {
    await service.gateUnconfirmedTenant(
      buttonMessage('tenant_confirm_mr:mr-1') as any,
      PHONE,
    );

    await service.handleInteractive(
      buttonMessage(`tenancy_details_incorrect:${PROPERTY_ID}`) as any,
      PHONE,
    );

    // Dispute never confirms, so the tenant stays gated; the tap must not
    // survive to fire against details they've said are wrong.
    expect(cacheStore.has(PENDING_KEY)).toBe(false);
    expect(
      maintenanceRequestService.confirmTenantMaintenanceRequest,
    ).not.toHaveBeenCalled();
  });

  it('does not replay a tap that was already consumed', async () => {
    await service.gateUnconfirmedTenant(
      buttonMessage('tenant_confirm_mr:mr-1') as any,
      PHONE,
    );

    unconfirmedRows = [];
    await service.handleInteractive(
      buttonMessage(`tenancy_details_correct:${PROPERTY_ID}`) as any,
      PHONE,
    );
    await service.handleInteractive(
      buttonMessage(`tenancy_details_correct:${PROPERTY_ID}`) as any,
      PHONE,
    );

    expect(
      maintenanceRequestService.confirmTenantMaintenanceRequest,
    ).toHaveBeenCalledTimes(1);
  });
});
