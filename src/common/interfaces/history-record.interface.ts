/**
 * Property history record types
 * Used by TenantAssignmentService for tracking property events
 */

export type PropertyHistoryEventType =
  | 'tenancy_started'
  | 'tenancy_ended'
  | 'rent_updated'
  | 'property_created'
  | 'property_updated';

export interface HistoryRecordData {
  propertyId: string;
  tenantId: string;
  eventType: PropertyHistoryEventType;
  moveInDate?: Date;
  moveOutDate?: Date;
  moveOutReason?: string;
  monthlyRent?: number;
  ownerComment?: string;
  tenantComment?: string;
}
