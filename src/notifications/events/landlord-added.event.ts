export interface LandlordAddedEvent {
  // The new landlord's account id — carries the feed-row attribution so the
  // event surfaces on the managing admin's scoped live feed with the landlord's
  // name.
  user_id: string;
  profile_name: string;
  date: string;
}
