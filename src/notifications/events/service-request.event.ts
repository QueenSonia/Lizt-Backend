export interface ServiceRequestCreatedEvent {
  request_id: number;
  user_id: number;
  date: string;
  property_id: string;
  property_name:string
}