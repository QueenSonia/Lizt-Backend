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
  UseInterceptors,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';

import { TenantKycService } from './tenant-kyc.service';
import { CreateTenantKycDto, UpdateTenantKycDto } from './dto';
import { SkipAuth } from 'src/auth/auth.decorator';
import { RoleGuard } from 'src/auth/role.guard';
import { RolesEnum } from 'src/base.entity';
import { Roles } from 'src/auth/role.decorator';
import {
  BulkDeleteTenantKycDto,
  ParseTenantKycQueryDto,
} from './dto/others.dto';
import { ManagedScopeInterceptor } from 'src/common/scope/managed-scope.interceptor';
import { ManagedLandlordIds } from 'src/common/scope/managed-landlord-ids.decorator';

@Controller('tenant-kyc')
@UseInterceptors(ManagedScopeInterceptor)
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
   * Create KYC for existing tenant (landlord only)
   * @remarks This endpoint allows landlords to create KYC information for existing tenants
   * @throws {401} `Unauthorized`
   * @throws {403} `Forbidden` - Access denied due to insufficient role permissions
   * @throws {422} `Unprocessable Entity` - Failed payload validation
   * @throws {500} `Internal Server Error`
   */
  @ApiOkResponse({ description: 'Operation successful' })
  @ApiBearerAuth()
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.ADMIN)
  @Post('existing-tenant')
  createForExistingTenant(
    @Body()
    createTenantKycDto: CreateTenantKycDto & {
      tenant_id?: string;
    },
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.tenantKycService.createForExistingTenant(
      createTenantKycDto,
      landlordIds,
    );
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
  @Roles(RolesEnum.ADMIN)
  @Get()
  findAll(
    @Query() query: ParseTenantKycQueryDto,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.tenantKycService.findAll(landlordIds, query);
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
  @Roles(RolesEnum.ADMIN)
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.tenantKycService.findOne(landlordIds, id);
  }

  /**
   * Get KYC data by tenant user ID
   * @remarks Only accessible by admins/landlords
   * @throws {401} `Unauthorized`
   * @throws {403} `Forbidden` - Access denied due to insufficient role permissions
   * @throws {404} `NotFound`
   * @throws {500} `Internal Server Error`
   */
  @ApiOkResponse({ description: 'Operation successful' })
  @ApiBearerAuth()
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.ADMIN)
  @Get('user/:user_id')
  findByUserId(@Param('user_id') user_id: string) {
    return this.tenantKycService.findByUserId(user_id);
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
  @Roles(RolesEnum.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateTenantKycDto: UpdateTenantKycDto,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.tenantKycService.update(landlordIds, id, updateTenantKycDto);
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
  @Roles(RolesEnum.ADMIN)
  @Delete(':id')
  deleteOne(
    @Param('id') id: string,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.tenantKycService.deleteOne(landlordIds, id);
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
  @Roles(RolesEnum.ADMIN)
  @Delete('bulk')
  deleteMany(
    @Body() bulkDeleteTenantKycDto: BulkDeleteTenantKycDto,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.tenantKycService.deleteMany(landlordIds, bulkDeleteTenantKycDto);
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
  @Roles(RolesEnum.ADMIN)
  @Delete()
  deleteAll(@ManagedLandlordIds() landlordIds: string[]) {
    return this.tenantKycService.deleteAll(landlordIds);
  }
}
