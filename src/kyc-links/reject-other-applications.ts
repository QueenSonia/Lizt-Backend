import { EntityManager } from 'typeorm';
import {
  ApplicationStatus,
  KYCApplication,
} from './entities/kyc-application.entity';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';

/**
 * Reject every OTHER pending KYC application for a property once that property
 * has been taken (an ACTIVE property_tenant was created).
 *
 * Runs on the caller's transaction `manager` so the property-occupied and
 * competitors-rejected states commit atomically — closing the window where a
 * new application could be submitted mid-attachment and survive as PENDING.
 *
 * Pass `excludeApplicationId` to spare the application being approved; omit it
 * (direct/manual attach with no application) to reject all PENDING ones. The
 * property model is single-occupancy (one rentable unit, scalar
 * `property_status`), so any remaining PENDING application is moot once the
 * property is occupied.
 *
 * Shared by every attachment path. Previously only the offer-letter payment
 * path rejected competitors, leaving the manual/admin/onboard paths to orphan
 * applications as PENDING.
 */
export async function rejectOtherPendingApplications(
  manager: EntityManager,
  propertyId: string,
  excludeApplicationId?: string | null,
): Promise<void> {
  if (!propertyId) return;

  const pending: KYCApplication[] = await manager.find(KYCApplication, {
    where: { property_id: propertyId, status: ApplicationStatus.PENDING },
  });

  const toReject = pending.filter((app) => app.id !== excludeApplicationId);
  if (toReject.length === 0) return;

  await manager
    .createQueryBuilder()
    .update(KYCApplication)
    .set({ status: ApplicationStatus.REJECTED })
    .whereInIds(toReject.map((app) => app.id))
    .execute();

  // Mirror the audit trail the payment path already writes (best-effort).
  const now = new Date();
  const formattedDate = now.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const formattedTime = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  for (const application of toReject) {
    try {
      const applicantName = `${application.first_name} ${application.last_name}`;
      const propertyHistory = manager.create(PropertyHistory, {
        property_id: propertyId,
        tenant_id: application.tenant_id || null,
        event_type: 'kyc_application_rejected',
        event_description: `KYC application rejected for ${applicantName} — ${formattedDate} at ${formattedTime}`,
        related_entity_id: application.id,
        related_entity_type: 'kyc_application',
      });
      await manager.save(propertyHistory);
    } catch (error) {
      // Audit history is best-effort — never fail the attachment over it.
      console.error(
        `Failed to create property history for rejected application ${application.id}:`,
        error,
      );
    }
  }
}
