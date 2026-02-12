import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Req,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { PushNotificationService } from './push-notification.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { Notification } from './entities/notification.entity';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly service: NotificationService,
    private readonly pushNotificationService: PushNotificationService,
  ) { }
  @Get('user')
  findByUserId(
    @Req() req,
    @Query() paginationQuery: PaginationQueryDto,
  ): Promise<{ notifications: Notification[]; total: number }> {
    const user_id = req?.user?.id;
    const { page = 1, limit = 20 } = paginationQuery;
    return this.service.findByUserId(user_id, { page, limit });
  }

  @Post()
  create(@Body() dto: CreateNotificationDto): Promise<Notification> {
    return this.service.create(dto);
  }

  @Get()
  findAll(): Promise<Notification[]> {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Notification | null> {
    return this.service.findOne(id);
  }

  @Get('/property/:property_id')
  findByPropertyId(
    @Param('property_id') property_id: string,
  ): Promise<Notification[]> {
    return this.service.findByPropertyId(property_id);
  }
  @Post('subscribe')
  subscribe(@Body() subscription: any, @Req() req) {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User not authenticated');
    }
    return this.pushNotificationService.subscribe(userId, subscription);
  }
}
