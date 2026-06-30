import { Account } from '../../users/entities/account.entity';
import { Users } from '../../users/entities/user.entity';

/**
 * The user whose branding/logo a tenant-facing document should display for a
 * property owned by `owner`.
 *
 * Property-manager model: every managed landlord's documents carry the managing
 * admin's branding (Property Kraft). So we resolve through the landlord's
 * `creator` (the admin) and use the admin's user branding; when there is no
 * managing admin (pre-reparent / unmanaged landlord) we fall back to the
 * landlord's own user — the legacy behaviour.
 *
 * Pure resolver: the caller must have loaded `owner.creator.user` and
 * `owner.user` (add `…owner.creator`, `…owner.creator.user` to the query
 * relations). No DB access here.
 */
export function resolveBrandingUser(
  owner: Account | null | undefined,
): Users | null {
  return owner?.creator?.user ?? owner?.user ?? null;
}
