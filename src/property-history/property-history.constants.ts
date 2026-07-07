/**
 * Event types that describe the property itself, not any tenant's journey.
 * The attach-time backfill must never stamp these with a tenant_id — they
 * belong to the property timeline and stay tenant-neutral for the life of
 * the row.
 */
export const PROPERTY_LEVEL_EVENT_TYPES = [
  'property_created',
  'property_edited',
  'property_activated',
  'property_deactivated',
  'property_marketing_enabled',
  'property_marketing_disabled',
] as const;
