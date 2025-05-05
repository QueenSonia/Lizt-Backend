import { ApiProperty } from '@nestjs/swagger';

export class NoticeAnalyticsDTO {
  @ApiProperty({ description: 'Total number of notices' })
  totalNotices: number;

  @ApiProperty({ description: 'Number of acknowledged notices' })
  acknowledgedNotices: number;

  @ApiProperty({ description: 'Number of unacknowledged notices' })
  unacknowledgedNotices: number;

  @ApiProperty({ description: 'Number of pending notices' })
  pendingNotices: number;
}