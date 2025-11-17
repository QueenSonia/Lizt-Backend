export interface RentCreatedEvent {
  rentId: number;
  amount: number;
  userId: number;
  property_id: string;
  date: string;
}
