import { MaintenanceRequestStatusEnum } from '../dto/create-maintenance-request.dto';

export type TenantVisibleStatus = 'pending' | 'closed';

export function mapMRStatusForTenant(
  raw: MaintenanceRequestStatusEnum,
): TenantVisibleStatus {
  return raw === MaintenanceRequestStatusEnum.CLOSED ||
    raw === MaintenanceRequestStatusEnum.REJECTED
    ? 'closed'
    : 'pending';
}
