import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Req,
  UseGuards,
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
} from '@nestjs/swagger';
import { ADMIN_ROLES } from 'src/base.entity';
import { Roles } from 'src/auth/role.decorator';
import { PaginationResponseDto } from './dto/paginate.dto';

@ApiTags('Notice-Agreements')
@Controller('notice-agreement')
export class NoticeAgreementController {
  constructor(private readonly service: NoticeAgreementService) {}

  @ApiOperation({ summary: 'Create Notice Agreement' })
  @ApiBody({ type: CreateNoticeAgreementDto })
  @ApiCreatedResponse({ type: CreateNoticeAgreementDto })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post()
  create(@Body() dto: CreateNoticeAgreementDto) {
    try {
      return this.service.create(dto);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get All Notice Agreements' })
  @ApiOkResponse({
    type: [CreateNoticeAgreementDto],
    description: 'List of notice agreements',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN)
  @Get()
  getAllNoticeAgreement(@Req() req: any) {
    try {
      const owner_id = req?.user?.id;
      return this.service.getAllNoticeAgreement(owner_id);
    } catch (error) {
      throw error;
    }
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
  findOne(@Param('id') id: string) {
    try {
      return this.service.findOne(id);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Resend Notice Agreement' })
  @ApiOkResponse({ description: 'Notice agreement resent successfully' })
  @ApiNotFoundResponse({ description: 'Notice agreement not found' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post('resend/:id')
  resendNoticeAgreement(@Param('id') id: string) {
    try {
      return this.service.resendNoticeAgreement(id);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get Notice Agreements by Tenant ID' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiOkResponse({
    type: PaginationResponseDto,
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
}
