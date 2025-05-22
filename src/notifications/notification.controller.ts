import { Controller, Post, Body, Get, Param, Req } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { Notification } from './entities/notification.entity';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly service: NotificationService) {}
  @Get('user')
  findByUserId(@Req() req): Promise<Notification[]> {
    const user_id = req?.user?.id;
    console.log('user_id', user_id);
    return this.service.findByUserId(user_id);
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
}
