import { NotificationType } from '../enums/notification-type';

export class CreateNotificationDto {
  date: string;
  type: NotificationType;
  description: string;
  status: 'Pending' | 'Completed';
  // Nullable: common-area maintenance requests have no property_id, and the
  // notification service already null-checks before building the property
  // detail deep-link (`notification.service.ts:27`).
  property_id: string | null;
  user_id: string;
  maintenance_request_id?: string;
}
