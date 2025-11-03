import { Module } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { PropertiesController } from './properties.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Property } from './entities/property.entity';
import { FileUploadService } from 'src/utils/cloudinary';
import { PropertyTenant } from './entities/property-tenants.entity';
import { PropertyGroup } from './entities/property-group.entity';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { RentsService } from 'src/rents/rents.service';
import { RentsModule } from 'src/rents/rents.module';
import { UsersService } from 'src/users/users.service';
import { UsersModule } from 'src/users/users.module';
import { Account } from 'src/users/entities/account.entity';
import { KYCLinksModule } from 'src/kyc-links/kyc-links.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Property,
      PropertyTenant,
      Account,
      PropertyGroup,
      PropertyHistory,
    ]),
    RentsModule,
    UsersModule,
    KYCLinksModule,
  ],
  controllers: [PropertiesController],
  providers: [PropertiesService, FileUploadService, RentsService],
})
export class PropertiesModule {}
