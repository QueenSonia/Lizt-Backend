export interface MaintenanceRequestCreatedEvent {
  maintenance_request_id: string;
  request_id?: string;
  user_id: string;
  landlord_id: string;
  // property_id is null for common-area FM-filed MRs, but the in-app
  // notification still needs to render via `event.property_name` ??
  // `event.common_area_name`.
  property_id: string | null;
  property_name: string | null;
  common_area_id?: string | null;
  common_area_name?: string | null;
  tenant_id?: string | null;
  // tenant_name is null when an FM files for a vacant property or a common
  // area; the listener falls back to creator_name in that case.
  tenant_name: string | null;
  tenant_phone_number?: string | null;
  property_location?: string | null;
  creator_type?: 'tenant' | 'facility_manager' | 'landlord';
  creator_name?: string;
  scope?: 'unit' | 'common_area';
  // 'notice' = informational tenant message for the landlord (no FM). Drives a
  // notice-specific in-app headline; absent/'repair' behaves as before.
  kind?: 'repair' | 'notice';
  is_urgent?: boolean;
  description: string;
  created_at: Date;
}
