import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NoticeAgreement } from './entities/notice-agreement.entity';
import { CreateNoticeAgreementDto } from './dto/create-notice-agreement.dto';
import { Property } from 'src/properties/entities/property.entity';
import { Users } from 'src/users/entities/user.entity';
import { generatePdfFromTemplate } from './utils/pdf-generator';
import { sendViaWhatsappOrEmail } from './utils/sender';

@Injectable()
export class NoticeAgreementService {
  constructor(
    @InjectRepository(NoticeAgreement)
    private readonly noticeRepo: Repository<NoticeAgreement>,
    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,
    @InjectRepository(Users)
    private readonly userRepo: Repository<Users>,
  ) {}

  async create(dto: CreateNoticeAgreementDto) {
    const property = await this.propertyRepo.findOneBy({ id: dto.property_id });
    const tenant = await this.userRepo.findOneBy({ id: dto.tenant_id });

    if (!property || !tenant) throw new NotFoundException('Property or tenant not found');

    const agreement = this.noticeRepo.create({
      ...dto,
      property_name: property.name,
      tenant_name: tenant.first_name,
    }) as any

    await this.noticeRepo.save(agreement);

    agreement.effective_date = new Date(agreement.effective_date);

    const pdfPath = await generatePdfFromTemplate(agreement, tenant); // generate PDF contract
    // await sendViaWhatsappOrEmail(
    //     pdfPath,
    //     agreement.send_via,
    //     tenant.email,
    //     tenant.phone_number
    //   );
      // send via WhatsApp/email

    return agreement;
  }

  async findOne(id: string) {
    return this.noticeRepo.findOne({ where: { id } });
  }
}
