import {
  BadRequestException,
  Injectable,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NoticeAgreement,
  NoticeStatus,
  NoticeType,
} from './entities/notice-agreement.entity';
import {
  CreateNoticeAgreementDto,
  NoticeAgreementFilter,
} from './dto/create-notice-agreement.dto';
import { Property } from 'src/properties/entities/property.entity';
import { Users } from 'src/users/entities/user.entity';
import { generatePdfBufferFromEditor } from './utils/pdf-generator';
import {
  sendEmailWithAttachment,
  sendEmailWithMultipleAttachments,
} from './utils/sender';
import { FileUploadService } from 'src/utils/cloudinary';
import { v4 as uuidv4 } from 'uuid';
import { config } from 'src/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Account } from 'src/users/entities/account.entity';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';
@Injectable()
export class NoticeAgreementService {
  constructor(
    @InjectRepository(NoticeAgreement)
    private readonly noticeRepo: Repository<NoticeAgreement>,
    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly fileUploadService: FileUploadService,
    private readonly eventEmitter: EventEmitter2,
  ) { }

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

    const tenant = await this.accountRepo.findOne({
      where: { id: dto.tenant_id },
      relations: ['user'],
    });

    if (!property || !tenant)
      throw new NotFoundException('Property or tenant not found');

    const agreement = this.noticeRepo.create({
      ...dto,
      notice_id: `NTC-${uuidv4().slice(0, 8)}`,
      property_name: property.name,
      tenant_name: tenant.profile_name,
    }) as any;

    await this.noticeRepo.save(agreement);

    const pdfBuffer = await generatePdfBufferFromEditor(dto.html_content);
    const filename = `${Date.now()}-notice`;
    const uploadResult = await this.fileUploadService.uploadBuffer(
      pdfBuffer,
      filename,
      // 'notices',
      // { resource_type: 'raw', format: 'pdf' },
    );

    agreement.notice_image = `${uploadResult.secure_url}`;
    await this.noticeRepo.save(agreement);

    try {
      await Promise.all([
        sendEmailWithAttachment(uploadResult.secure_url, tenant.email),
      ]);
      console.log(
        `Notice agreement sent successfully to ${tenant.email} and WhatsApp`,
      );
    } catch (error) {
      console.error('Failed to send notice agreement:', error);
    }

    // await sendViaWhatsappOrEmail(
    //     pdfPath,
    //     agreement.send_via,
    //     tenant.email,
    //     tenant.phone_number
    //   );
    // send via WhatsApp/email

    this.eventEmitter.emit('notice.created', {
      user_id: property.owner_id,
      property_id: property.id,
      property_name: property.name,
    });

    return agreement;
  }

  async findOne(id: string, userId: string) {
    const noticeAgreement = await this.noticeRepo.findOne({
      where: { id },
      relations: ['tenant', 'property'],
    });
    if (!noticeAgreement) {
      throw new HttpException(
        'Notice agreement not found',
        HttpStatus.NOT_FOUND,
      );
    }
    // Allow if user is the tenant OR the landlord
    if (
      noticeAgreement.tenant_id !== userId &&
      noticeAgreement.property.owner_id !== userId
    ) {
      throw new HttpException(
        'You do not have permission to view this notice agreement',
        HttpStatus.FORBIDDEN,
      );
    }
    return noticeAgreement;
  }

  async getAllNoticeAgreement(
    ownerId: string,
    queryParams: NoticeAgreementFilter,
  ) {
    const page = queryParams.page
      ? Number(queryParams.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const qb = await this.noticeRepo
      .createQueryBuilder('notice')
      .leftJoinAndSelect('notice.property', 'property')
      .where('property.owner_id = :ownerId', { ownerId });

    // Apply sorting (rent requires custom logic)
    if (queryParams.sort_by && queryParams?.sort_order) {
      qb.orderBy(
        `notice.${queryParams.sort_by}`,
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    }

    const [notice, count] = await qb.skip(skip).take(size).getManyAndCount();

    const totalPages = Math.ceil(count / size);

    return {
      notice,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async resendNoticeAgreement(id: string, userId: string) {
    const noticeAgreement = await this.noticeRepo.findOne({
      where: { id },
      relations: ['tenant', 'property'],
    });

    if (!noticeAgreement) {
      throw new HttpException(
        'Notice agreement not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (noticeAgreement.property.owner_id !== userId) {
      throw new HttpException(
        'You do not have permission to resend this notice agreement',
        HttpStatus.FORBIDDEN,
      );
    }

    if (!noticeAgreement.notice_image) {
      throw new NotFoundException('Notice agreement PDF not found');
    }

    try {
      await sendEmailWithAttachment(
        noticeAgreement.notice_image,
        noticeAgreement.tenant.email,
      );
      console.log(
        `Notice agreement resent successfully to ${noticeAgreement.tenant.email}`,
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
  async attachNoticeDocument(id: string, url: string, userId: string) {
    const noticeAgreement = await this.noticeRepo.findOne({
      where: { id },
      relations: ['property'],
    });

    if (!noticeAgreement) {
      throw new HttpException(
        'Notice agreement not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (noticeAgreement.property.owner_id !== userId) {
      throw new HttpException(
        'You do not have permission to attach documents to this notice agreement',
        HttpStatus.FORBIDDEN,
      );
    }

    return this.noticeRepo.update(id, {
      notice_image: url,
      status: NoticeStatus.ACKNOWLEDGED,
    });
  }
}

