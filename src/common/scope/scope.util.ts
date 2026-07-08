import { ForbiddenException } from '@nestjs/common';

/**
 * Act-on-behalf scope helpers.
 *
 * Reads use the ManagedScopeInterceptor + @ManagedLandlordIds() to resolve the
 * requester's managed-landlord set. For writes / by-id ownership, the service
 * receives that same set and checks membership in-memory — no extra DB round
 * trip, and consistent with how the read endpoints are scoped.
 *
 * `managedLandlordIds` is the set of landlord Account.ids the requester (admin
 * or FM) is allowed to act for. `landlordId` is the owner_id of the entity (or
 * the explicit landlord_id supplied on a create payload).
 */
export function isLandlordInScope(
  managedLandlordIds: string[],
  landlordId?: string | null,
): boolean {
  return (
    Array.isArray(managedLandlordIds) &&
    !!landlordId &&
    managedLandlordIds.includes(landlordId)
  );
}

export function assertLandlordInScope(
  managedLandlordIds: string[],
  landlordId?: string | null,
): void {
  if (!isLandlordInScope(managedLandlordIds, landlordId)) {
    throw new ForbiddenException(
      'You do not have permission to act on behalf of this landlord.',
    );
  }
}
