import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NoticeAgreement,
  NoticeStatus,
} from './entities/notice-agreement.entity';
import {
  CreateNoticeAgreementDto,
  NoticeAgreementFilter,
} from './dto/create-notice-agreement.dto';
import { Property } from 'src/properties/entities/property.entity';
import { Users } from 'src/users/entities/user.entity';
import { generatePdfBufferFromEditor } from './utils/pdf-generator';
import { sendEmailWithAttachment } from './utils/sender';
import { FileUploadService } from 'src/utils/cloudinary';
import { v4 as uuidv4 } from 'uuid';
import { config } from 'src/config';
import { TwilioService } from 'src/twilio/twilio.service';
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
    private readonly twilioService: TwilioService,
  ) {}

  async create(dto: CreateNoticeAgreementDto) {
    const property = await this.propertyRepo.findOne({
      where: { id: dto.property_id },
      relations: ['property_tenants'],
    });

    const doesTenantExist = property?.property_tenants.find(
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
      tenant_name: tenant.first_name + ' ' + tenant.last_name,
    }) as any;

    await this.noticeRepo.save(agreement);

    const pdfBuffer = await generatePdfBufferFromEditor(dto.html_content);
    const filename = `${Date.now()}-notice`;
    const uploadResult = await this.fileUploadService.uploadBuffer(
      pdfBuffer,
      filename,
      'notices',
      { resource_type: 'raw', format: 'pdf' },
    );

    agreement.notice_image = `${uploadResult.secure_url}`;
    await this.noticeRepo.save(agreement);

    try {
      await Promise.all([
        sendEmailWithAttachment(uploadResult.secure_url, tenant.email),
        this.twilioService.sendWhatsAppMedia(
          tenant.phone_number,
          uploadResult.secure_url,
          `Dear ${tenant.first_name}, please find your ${agreement.notice_type} notice attached.`,
        ),
      ]);
      console.log(
        `Notice agreement sent successfully to ${tenant.email} and WhatsApp`,
      );
    } catch (error) {
      console.error('Failed to send notice agreement:', error);
    }

    return agreement;
  }

  async findOne(id: string) {
    return this.noticeRepo.findOne({ where: { id } });
  }

  async getAllNoticeAgreement(ownerId: string) {
    console.log(ownerId);
    return await this.noticeRepo
      .createQueryBuilder('notice')
      .leftJoinAndSelect('notice.property', 'property')
      .where('property.owner_id = :ownerId', { ownerId })
      .getMany();
  }

  async resendNoticeAgreement(id: string) {
    const notice = await this.noticeRepo.findOne({
      where: { id },
      relations: ['tenant'],
    });

    if (!notice) {
      throw new NotFoundException('Notice agreement not found');
    }

    if (!notice.notice_image) {
      throw new NotFoundException('Notice agreement PDF not found');
    }

    try {
      await sendEmailWithAttachment(notice.notice_image, notice.tenant.email);
      console.log(
        `Notice agreement resent successfully to ${notice.tenant.email}`,
      );
      return { message: 'Notice agreement sent successfully' };
    } catch (error) {
      console.error('Failed to resend notice agreement:', error);
      throw new Error('Failed to send notice agreement');
    }
  }

  async getNoticeAgreementsByTenantId(
    tenant_id: string,
    queryParams: NoticeAgreementFilter,
  ) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const [notices, count] = await this.noticeRepo.findAndCount({
      where: {
        tenant_id,
      },
      relations: ['property'],
      skip,
      take: size,
      order: { created_at: 'DESC' },
    });

    const totalPages = Math.ceil(count / size);
    return {
      notice_agreements: notices,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getNoticeAnalytics(id: string) {
    const totalNotices = await this.noticeRepo.count({
      where: {
        property: {
          owner_id: id,
        },
      },
    });

    console.log({ totalNotices });

    const acknowledgedNotices = await this.noticeRepo.count({
      where: { status: NoticeStatus.ACKNOWLEDGED },
    });

    const unacknowledgedNotices = await this.noticeRepo.count({
      where: { status: NoticeStatus.NOT_ACKNOWLEDGED },
    });

    const pendingNotices = await this.noticeRepo.count({
      where: { status: NoticeStatus.PENDING },
    });

    return {
      totalNotices,
      acknowledgedNotices,
      unacknowledgedNotices,
      pendingNotices,
    };
  }
}
