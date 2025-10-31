import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';

import { TenantKycService } from './tenant-kyc.service';
import { CreateTenantKycDto, UpdateTenantKycDto } from './dto';
import { SkipAuth } from 'src/auth/auth.decorator';
import { RoleGuard } from 'src/auth/role.guard';
import { ADMIN_ROLES, RolesEnum } from 'src/base.entity';
import { Roles } from 'src/auth/role.decorator';
import { CurrentUser } from 'src/lib/utils';
import {
  BulkDeleteTenantKycDto,
  ParseTenantKycQueryDto,
} from './dto/others.dto';

@Controller('tenant-kyc')
export class TenantKycController {
  constructor(private readonly tenantKycService: TenantKycService) {}

  /**
   * Submit new tenant kyc data
   * @remarks This is the first step to initiating the new tenancy process. After submission, admin reviews then sends them a registration link if approved.
   * @throws {409} `Conflict`
   * @throws {422} `Unprocessable Entity` - Failed payload validation
   * @throws {500} `Internal Server Error`
   */
  @SkipAuth()
  @ApiOkResponse({ description: 'Operation successful' })
  @HttpCode(HttpStatus.OK)
  @Post()
  create(@Body() createTenantKycDto: CreateTenantKycDto) {
    return this.tenantKycService.create(createTenantKycDto);
  }

  /**
   * Get all new tenant kyc data.
   * @remarks Only accessible by admins/land-lords
   * @throws {401} `Unauthorized`
   * @throws {403} `Forbidden` - Access denied due to insufficient role permissions
   * @throws {422} `Unprocessable Entity` - Failed payload validation
   * @throws {500} `Internal Server Error`
   */
  @ApiOkResponse({ description: 'Operation successful' })
  @ApiBearerAuth()
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @Get()
  findAll(
    @Query() query: ParseTenantKycQueryDto,
    @CurrentUser('id') admin_id: string,
  ) {
    return this.tenantKycService.findAll(admin_id, query);
  }

  /**
   * View single new tenant kyc data.
   * @remarks Only accessible by admins/land-lords
   * @throws {401} `Unauthorized`
   * @throws {403} `Forbidden` - Access denied due to insufficient role permissions
   * @throws {404} `NotFound`
   * @throws {500} `Internal Server Error`
   */
  @ApiOkResponse({ description: 'Operation successful' })
  @ApiBearerAuth()
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN)
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser('id') admin_id: string) {
    return this.tenantKycService.findOne(admin_id, id);
  }

  /**
   * Update single kyc data.
   * @remarks Only accessible by admins/land-lords
   * @throws {401} `Unauthorized`
   * @throws {403} `Forbidden` - Access denied due to insufficient role permissions
   * @throws {404} `NotFound`
   * @throws {500} `Internal Server Error`
   */
  @ApiOkResponse({ description: 'Operation successful' })
  @ApiBearerAuth()
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateTenantKycDto: UpdateTenantKycDto,
    @CurrentUser('id') admin_id: string,
  ) {
    return this.tenantKycService.update(admin_id, id, updateTenantKycDto);
  }

  /**
   * Delete single kyc record.
   * @remarks Only accessible by admins/land-lords
   * @throws {401} `Unauthorized`
   * @throws {403} `Forbidden` - Access denied due to insufficient role permissions
   * @throws {404} `NotFound`
   * @throws {500} `Internal Server Error`
   */
  @ApiOkResponse({ description: 'Operation successful' })
  @ApiBearerAuth()
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @Delete(':id')
  deleteOne(@Param('id') id: string, @CurrentUser('id') admin_id: string) {
    return this.tenantKycService.deleteOne(admin_id, id);
  }

  /**
   * Bulk delete kyc records.
   * @remarks Only accessible by admins/land-lords. Provide array of selected record ids to be deleted.
   * @throws {401} `Unauthorized`
   * @throws {403} `Forbidden` - Access denied due to insufficient role permissions
   * @throws {500} `Internal Server Error`
   */
  @ApiOkResponse({ description: 'Operation successful' })
  @ApiBearerAuth()
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @Delete('bulk')
  deleteMany(
    @Body() bulkDeleteTenantKycDto: BulkDeleteTenantKycDto,
    @CurrentUser('id') admin_id: string,
  ) {
    return this.tenantKycService.deleteMany(admin_id, bulkDeleteTenantKycDto);
  }

  /**
   * Delete all kyc records.
   * @remarks Only accessible by admins/land-lords
   * @throws {401} `Unauthorized`
   * @throws {403} `Forbidden` - Access denied due to insufficient role permissions
   * @throws {500} `Internal Server Error`
   */
  @ApiOkResponse({ description: 'Operation successful' })
  @ApiBearerAuth()
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @Delete()
  deleteAll(@CurrentUser('id') admin_id: string) {
    return this.tenantKycService.deleteAll(admin_id);
  }
}
