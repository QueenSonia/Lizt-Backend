import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NoticeAgreement } from './entities/notice-agreement.entity';
import { CreateNoticeAgreementDto } from './dto/create-notice-agreement.dto';
import { Property } from 'src/properties/entities/property.entity';
import { Users } from 'src/users/entities/user.entity';
import {
  generatePdfBufferFromEditor,
  generatePdfBufferFromTemplate,
  generatePdfFromTemplate,
} from './utils/pdf-generator';
import { sendViaWhatsappOrEmail } from './utils/sender';
import { FileUploadService } from 'src/utils/cloudinary';
import { v4 as uuidv4 } from 'uuid';
@Injectable()
export class NoticeAgreementService {
  constructor(
    @InjectRepository(NoticeAgreement)
    private readonly noticeRepo: Repository<NoticeAgreement>,
    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,
    @InjectRepository(Users)
    private readonly userRepo: Repository<Users>,
    private readonly fileUploadService: FileUploadService,
  ) {}

  async create(dto: CreateNoticeAgreementDto) {
    const property = await this.propertyRepo.findOne({
      where: { id: dto.property_id },
      relations: ['property_tenants'],
    });

    let doesTenantExist = property?.property_tenants.find(
      (tenant) => tenant.tenant_id === dto.tenant_id,
    );

    if (!doesTenantExist) {
      throw new NotFoundException('Tenant not found in property');
    }

    const tenant = await this.userRepo.findOneBy({ id: dto.tenant_id });

    if (!property || !tenant)
      throw new NotFoundException('Property or tenant not found');

    const agreement = this.noticeRepo.create({
      ...dto,
      notice_id: `NTC-${uuidv4().slice(0, 8)}`,
      property_name: property.name,
      tenant_name: tenant.first_name + " " + tenant.last_name,
    }) as any;

    await this.noticeRepo.save(agreement);

    // agreement.effective_date = new Date(agreement.effective_date);
    // agreement.property_location = property.location

    const pdfBuffer = await generatePdfBufferFromEditor(dto.html_content);
    const filename = `${Date.now()}-notice.pdf`;
    const uploadResult = await this.fileUploadService.uploadBuffer(
      pdfBuffer,
      filename,
      'notices',
    );

    agreement.notice_image = uploadResult.secure_url;
    await this.noticeRepo.save(agreement);

    // agreement.notice_image = pdfPath
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

  async getAllNoticeAgreement(ownerId: string) {

    console.log(ownerId)
    return await this.noticeRepo
      .createQueryBuilder('notice')
      .leftJoinAndSelect('notice.property', 'property')
      .where('property.owner_id = :ownerId', { ownerId })
      .getMany();
  }
  
}
