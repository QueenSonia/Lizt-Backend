import { Module } from '@nestjs/common';
import { NoticeAgreementController } from './notice-agreement.controller';
import { NoticeAgreementService } from './notice-agreement.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NoticeAgreement } from './entities/notice-agreement.entity';
import { Property } from 'src/properties/entities/property.entity';
import { Users } from 'src/users/entities/user.entity';
import { FileUploadService } from 'src/utils/cloudinary';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { Account } from 'src/users/entities/account.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([NoticeAgreement, Property, Users, Account]),
    WhatsappModule,
  ],
  controllers: [NoticeAgreementController],
  providers: [NoticeAgreementService, FileUploadService],
})
export class NoticeAgreementModule {}
