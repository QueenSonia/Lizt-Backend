import { NotificationType } from '../enums/notification-type';

export class CreateNotificationDto {
  date: string;
  type: NotificationType;
  description: string;
  status: 'Pending' | 'Completed';
  property_id: string;
  user_id: string;
  service_request_id?: string;
}
