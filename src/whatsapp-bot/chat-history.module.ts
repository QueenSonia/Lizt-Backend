import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatHistoryService } from './chat-history.service';
import { ChatHistoryController } from './chat-history.controller';
import { ChatLog } from './entities/chat-log.entity';
import { Users } from '../users/entities/user.entity';
import { MaintenanceRequest } from '../maintenance-requests/entities/maintenance-request.entity';
import { UsersModule } from '../users/users.module';
import { UtilsModule } from 'src/utils/utils.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatLog, Users, MaintenanceRequest]),
    forwardRef(() => UsersModule),
    UtilsModule,
  ],
  controllers: [ChatHistoryController],
  providers: [ChatHistoryService],
  exports: [ChatHistoryService],
})
export class ChatHistoryModule { }
