import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
  Query,
} from '@nestjs/common';
import { NoticeAgreementService } from './notice-agreement.service';
import {
  CreateNoticeAgreementDto,
  NoticeAgreementFilter,
} from './dto/create-notice-agreement.dto';
import { RoleGuard } from 'src/auth/role.guard';
import {
  ApiOperation,
  ApiBody,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiSecurity,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { RolesEnum } from 'src/base.entity';
import { Roles } from 'src/auth/role.decorator';
import { NoticeAgreementPaginationResponseDto } from './dto/paginate.dto';
import { NoticeAnalyticsDTO } from './dto/notice-analytics.dto';
import { SkipAuth } from 'src/auth/auth.decorator';
import { UploadNoticeDocumentDto } from './dto/uplaod-notice-document.dto';
import { ManagedScopeInterceptor } from 'src/common/scope/managed-scope.interceptor';
import { ManagedLandlordIds } from 'src/common/scope/managed-landlord-ids.decorator';

@ApiTags('Notice-Agreements')
@Controller('notice-agreement')
@UseInterceptors(ManagedScopeInterceptor)
export class NoticeAgreementController {
  constructor(private readonly service: NoticeAgreementService) {}

  @ApiOperation({ summary: 'Get All Notice Agreements' })
  @ApiOkResponse({
    type: [CreateNoticeAgreementDto],
    description: 'List of notice agreements',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get()
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.ADMIN)
  getAllNoticeAgreement(
    @ManagedLandlordIds() landlordIds: string[],
    @Query() query: NoticeAgreementFilter,
  ) {
    return this.service.getAllNoticeAgreement(landlordIds, query);
  }

  @ApiOperation({ summary: 'Get Notice Agreements by Tenant ID' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiOkResponse({
    type: NoticeAgreementPaginationResponseDto,
    description: 'Notice agreements for tenant successfully fetched',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('tenant')
  async getNoticeAgreementsByTenant(
    @Query() query: NoticeAgreementFilter,
    @Req() req: any,
  ) {
    try {
      const tenant_id = req?.user?.id;
      return this.service.getNoticeAgreementsByTenantId(tenant_id, query);
    } catch (error) {
      throw error;
    }
  }

  @UseGuards(RoleGuard)
  @Roles(RolesEnum.ADMIN)
  @Get('analytics')
  @ApiOperation({ summary: 'Get analytics of all notice agreements' })
  @ApiResponse({
    status: 200,
    description: 'The analytics data of notice agreements',
    type: NoticeAnalyticsDTO,
  })
  async getAnalytics(@ManagedLandlordIds() landlordIds: string[]) {
    return await this.service.getNoticeAnalytics(landlordIds);
  }

  @ApiOperation({ summary: 'Create Notice Agreement' })
  @ApiBody({ type: CreateNoticeAgreementDto })
  @ApiCreatedResponse({ type: CreateNoticeAgreementDto })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post()
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.ADMIN)
  create(
    @Body() dto: CreateNoticeAgreementDto,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.service.create(dto, landlordIds);
  }

  @ApiOperation({ summary: 'Get One Notice Agreement' })
  @ApiOkResponse({
    type: CreateNoticeAgreementDto,
    description: 'Notice agreement details',
  })
  @ApiNotFoundResponse({ description: 'Notice agreement not found' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get(':id')
  @Roles(RolesEnum.ADMIN)
  findOne(
    @Param('id') id: string,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.service.findOne(id, landlordIds);
  }

  @ApiOperation({ summary: 'Resend Notice Agreement' })
  @ApiOkResponse({ description: 'Notice agreement resent successfully' })
  @ApiNotFoundResponse({ description: 'Notice agreement not found' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post('resend/:id')
  @Roles(RolesEnum.ADMIN)
  resendNoticeAgreement(
    @Param('id') id: string,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.service.resendNoticeAgreement(id, landlordIds);
  }

  @Post('upload-document/:id')
  @Roles(RolesEnum.ADMIN)
  async attachDocument(
    @Param('id') id: string,
    @Body() body: any,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.service.attachNoticeDocument(id, body.document_url, landlordIds);
  }
}
