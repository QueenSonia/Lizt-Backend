export interface ServiceRequestCreatedEvent {
  requestId: number;
  userId: number;
  date: string;
  property_id: string;
}