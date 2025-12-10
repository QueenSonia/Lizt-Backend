import { forwardRef, Module } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { PropertiesController } from './properties.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Property } from './entities/property.entity';
import { FileUploadService } from 'src/utils/cloudinary';
import { PropertyTenant } from './entities/property-tenants.entity';
import { PropertyGroup } from './entities/property-group.entity';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { ScheduledMoveOut } from './entities/scheduled-move-out.entity';
import { RentsService } from 'src/rents/rents.service';
import { RentsModule } from 'src/rents/rents.module';
import { UsersService } from 'src/users/users.service';
import { UsersModule } from 'src/users/users.module';
import { Account } from 'src/users/entities/account.entity';
import { KYCLinksModule } from 'src/kyc-links/kyc-links.module';
import { MoveOutSchedulerService } from './tasks/move-out-scheduler.service';
import { TenantKyc } from 'src/tenant-kyc/entities/tenant-kyc.entity';
import { FixEmptyLastnameService } from 'src/utils/fix-empty-lastname';
import { Users } from 'src/users/entities/user.entity';
import { UtilsModule } from 'src/utils/utils.module';
import { Rent } from 'src/rents/entities/rent.entity';
import { KYCApplication } from 'src/kyc-links/entities/kyc-application.entity';
import { KYCLink } from 'src/kyc-links/entities/kyc-link.entity';
import { WhatsappBotModule } from 'src/whatsapp-bot/whatsapp-bot.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Property,
      PropertyTenant,
      Account,
      PropertyGroup,
      PropertyHistory,
      ScheduledMoveOut,
      TenantKyc,
      Users,
      Rent,
      KYCApplication,
      KYCLink,
    ]),
    RentsModule,
    UsersModule,
    KYCLinksModule,
    UtilsModule,
    forwardRef(() => WhatsappBotModule),
  ],
  controllers: [PropertiesController],
  providers: [
    PropertiesService,
    FileUploadService,
    RentsService,
    MoveOutSchedulerService,
    FixEmptyLastnameService,
  ],
})
export class PropertiesModule {}
