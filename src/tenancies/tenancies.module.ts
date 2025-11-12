import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenanciesController } from './tenancies.controller';
import { TenanciesService } from './tenancies.service';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Rent } from 'src/rents/entities/rent.entity';
import { Property } from 'src/properties/entities/property.entity';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { Users } from 'src/users/entities/user.entity';
import { UsersModule } from 'src/users/users.module';
import { AuthModule } from 'src/auth/auth.module';
import { WhatsappBotModule } from 'src/whatsapp-bot/whatsapp-bot.module';
import { UtilsModule } from 'src/utils/utils.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PropertyTenant,
      Rent,
      Property,
      PropertyHistory,
      Users,
    ]),
    UsersModule,
    AuthModule,
    WhatsappBotModule,
    UtilsModule,
  ],
  controllers: [TenanciesController],
  providers: [TenanciesService],
  exports: [TenanciesService],
})
export class TenanciesModule {}
