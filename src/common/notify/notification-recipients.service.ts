import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from 'src/users/entities/account.entity';
import { Users } from 'src/users/entities/user.entity';
import { UtilService } from 'src/utils/utility-service';
import { NotificationCategory } from './notification-category.enum';

/** One person a landlord-directed notification should actually reach. */
export interface NotifyRecipient {
  /** Account.id of the recipient (admin's or landlord's). */
  accountId: string;
  kind: 'admin' | 'landlord';
  /** Recipient's own display name, for template greetings. */
  name: string;
  /** E.164-normalized phone, or null when the user has none on file. */
  phone: string | null;
  email: string | null;
}

/**
 * Resolves who actually receives a notification that is *about* a landlord's
 * portfolio. Property-manager model: the managing admin
 * (`accounts.creator_id`) operates the dashboard and the WhatsApp line, so the
 * admin is always a recipient; the landlord is added only once they have
 * opted into that category (see {@link isLandlordSubscribed} — currently a
 * stub, no opt-in exists yet). Landlords with no managing admin
 * (pre-reparent / unmanaged) fall back to being the sole recipient, mirroring
 * `resolveBrandingUser` and the kyc-feedback `managingAdminId ?? landlordId`
 * pattern.
 *
 * Callers loop the result and skip null phones; `landlord_id`-style payload
 * fields must keep the LANDLORD's account id for attribution — only the
 * destination (phone/greeting) comes from here.
 */
@Injectable()
export class NotificationRecipientsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly utilService: UtilService,
  ) {}

  async resolveRecipients(
    landlordAccountId: string,
    category: NotificationCategory,
  ): Promise<NotifyRecipient[]> {
    if (!landlordAccountId) return [];

    const landlord = await this.accountRepository.findOne({
      where: { id: landlordAccountId },
      relations: ['user', 'creator', 'creator.user'],
    });
    if (!landlord) return [];

    const recipients: NotifyRecipient[] = [];

    const admin = landlord.creator;
    if (admin) {
      recipients.push(this.toRecipient(admin, 'admin'));
      if (await this.isLandlordSubscribed(landlordAccountId, category)) {
        recipients.push(this.toRecipient(landlord, 'landlord'));
      }
    } else {
      // Unmanaged landlord: they still run their own affairs.
      recipients.push(this.toRecipient(landlord, 'landlord'));
    }

    return this.dedupe(recipients);
  }

  /**
   * Subscription seam for the future per-category landlord opt-in. No prefs
   * table exists yet, so nobody is subscribed; when it lands, replace this
   * body with a repo lookup keyed (landlord_account_id, category) — call
   * sites stay untouched.
   */
  private async isLandlordSubscribed(
    landlordAccountId: string,
    category: NotificationCategory,
  ): Promise<boolean> {
    void landlordAccountId;
    void category;
    return false;
  }

  private toRecipient(
    account: Account,
    kind: NotifyRecipient['kind'],
  ): NotifyRecipient {
    const user: Users | undefined = account.user;
    const name =
      account.profile_name ||
      `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim() ||
      'there';
    return {
      accountId: account.id,
      kind,
      name,
      phone: user?.phone_number
        ? this.utilService.normalizePhoneNumber(user.phone_number)
        : null,
      email: account.email ?? user?.email ?? null,
    };
  }

  /**
   * Collapse duplicate targets: same account, or distinct accounts sharing a
   * phone (an admin who is also the landlord's user, multi-role setups). The
   * first occurrence wins, so the admin leg takes precedence.
   */
  private dedupe(recipients: NotifyRecipient[]): NotifyRecipient[] {
    const seenAccounts = new Set<string>();
    const seenPhones = new Set<string>();
    return recipients.filter((r) => {
      if (seenAccounts.has(r.accountId)) return false;
      if (r.phone && seenPhones.has(r.phone)) return false;
      seenAccounts.add(r.accountId);
      if (r.phone) seenPhones.add(r.phone);
      return true;
    });
  }
}
