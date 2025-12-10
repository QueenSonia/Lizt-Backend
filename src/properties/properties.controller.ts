import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  Put,
  UseInterceptors,
  UploadedFiles,
  HttpException,
  HttpStatus,
  UseGuards,
  Req,
  NotFoundException,
} from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto, PropertyFilter } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { CreatePropertyWithTenantDto } from './dto/create-property-with-tenant.dto';
import {
  ApiOperation,
  ApiBody,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiSecurity,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiConsumes,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { PropertyPaginationResponseDto } from './dto/paginate.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { FileUploadService } from 'src/utils/cloudinary';
import { RoleGuard } from 'src/auth/role.guard';
import { Roles } from 'src/auth/role.decorator';
import { ADMIN_ROLES, RolesEnum } from 'src/base.entity';
import { MoveTenantInDto, MoveTenantOutDto } from './dto/move-tenant.dto';
import { CreatePropertyGroupDto } from './dto/create-property-group.dto';
import { RentsService } from 'src/rents/rents.service';
import { AssignTenantDto } from './dto/assign-tenant.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Account } from 'src/users/entities/account.entity';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { Property } from 'src/properties/entities/property.entity';
import { FixEmptyLastnameService } from 'src/utils/fix-empty-lastname';
import { SkipAuth } from 'src/auth/auth.decorator';

@ApiTags('Properties')
@Controller('properties')
export class PropertiesController {
  constructor(
    private readonly propertiesService: PropertiesService,
    private readonly fileUploadService: FileUploadService,
    private readonly fixEmptyLastnameService: FixEmptyLastnameService,
  ) {}

  @ApiOperation({ summary: 'Create Property' })
  // @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreatePropertyDto })
  @ApiCreatedResponse({ type: CreatePropertyDto })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post()
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.LANDLORD)
  // @UseInterceptors(FilesInterceptor('property_images', 20))
  async createProperty(
    @Body() body: CreatePropertyDto,
    @CurrentUser() requester: Account,
  ): Promise<Property> {
    return this.propertiesService.createProperty(body, requester.id);
  }

  @ApiOperation({ summary: 'Check for Duplicate Tenant Phone Number' })
  @ApiOkResponse({
    description: 'Returns property name if phone number already exists',
    schema: {
      properties: {
        exists: { type: 'boolean' },
        propertyName: { type: 'string' },
      },
    },
  })
  @ApiQuery({ name: 'phone', required: true, type: String })
  @ApiSecurity('access_token')
  @Get('check-duplicate-phone')
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.LANDLORD)
  async checkDuplicatePhone(
    @Query('phone') phone: string,
    @CurrentUser() requester: Account,
  ) {
    try {
      const result = await this.propertiesService.checkExistingTenant(
        requester.id,
        phone,
      );
      return result;
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Create Property with Existing Tenant' })
  @ApiBody({ type: CreatePropertyWithTenantDto })
  @ApiCreatedResponse({
    description: 'Property created with existing tenant successfully',
    schema: {
      properties: {
        property: { type: 'object' },
        message: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post('create-with-tenant')
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.LANDLORD)
  async createPropertyWithTenant(
    @Body() body: CreatePropertyWithTenantDto,
    @CurrentUser() requester: Account,
  ): Promise<{
    property: Property;
    message: string;
    kycStatus: string;
    isExistingTenant: boolean;
  }> {
    try {
      const result =
        await this.propertiesService.createPropertyWithExistingTenant(
          body,
          body.existingTenant,
          requester.id,
        );

      // Provide appropriate message based on KYC status
      let message: string;
      if (result.isExistingTenant) {
        // Existing tenant - provide status-specific message
        switch (result.kycStatus) {
          case 'approved':
            message =
              'Property created successfully. Existing tenant with approved KYC has been attached.';
            break;
          case 'pending':
            message =
              'Property created successfully. Existing tenant attached (KYC awaiting approval).';
            break;
          case 'rejected':
            message =
              'Property created successfully. Existing tenant attached (KYC was rejected - resubmission link sent).';
            break;
          case 'pending_completion':
            message =
              'Property created successfully. Existing tenant attached (KYC completion link sent).';
            break;
          default:
            message =
              'Property created successfully. Existing tenant has been attached to the new property.';
        }
      } else {
        message =
          'Property created successfully. KYC completion link sent to tenant.';
      }

      return {
        property: result.property,
        message,
        kycStatus: result.kycStatus,
        isExistingTenant: result.isExistingTenant,
      };
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get All Properties' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiQuery({ name: 'name', required: false, type: String })
  @ApiQuery({ name: 'property_status', required: false, type: String })
  @ApiQuery({ name: 'location', required: false, type: String })
  @ApiQuery({ name: 'tenant_id', required: false, type: String })
  @ApiQuery({ name: 'owner_id', required: false, type: String })
  @ApiQuery({ name: 'start_date', required: false, type: String })
  @ApiQuery({ name: 'end_date', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiOkResponse({
    type: PropertyPaginationResponseDto,
    description: 'Paginated list of properties',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get()
  getAllProperties(@Query() query: PropertyFilter, @Req() req: any) {
    try {
      query.owner_id = req?.user?.id;
      return this.propertiesService.getAllProperties(query);
    } catch (error) {
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('/vacant')
  getVacantProperties(@CurrentUser() requester: Account): Promise<Property[]> {
    return this.propertiesService.getVacantProperties(requester.id);
  }

  @ApiOperation({ summary: 'Get All Property Groups' })
  @ApiOkResponse({
    description: 'List of property groups with their properties',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('property-groups')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  async getAllPropertyGroups(@Req() req: any) {
    try {
      const owner_id = req?.user?.id;
      return this.propertiesService.getAllPropertyGroups(owner_id);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({
    summary:
      'Check if tenant data leakage fix is working (Landlord accessible)',
  })
  @ApiOkResponse({
    description: 'Quick check of tenant data consistency',
  })
  @ApiSecurity('access_token')
  @Get('check-tenant-data-fix')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  async checkTenantDataFix(@CurrentUser() requester: Account) {
    return this.propertiesService.checkTenantDataFix(requester.id);
  }

  @ApiOperation({
    summary: 'Deep diagnostic for tenant data leakage issues',
  })
  @ApiOkResponse({
    description: 'Detailed diagnostic of tenant data issues',
  })
  @ApiSecurity('access_token')
  @Get('diagnose-tenant-data-leakage')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  async diagnoseTenantDataLeakage(@CurrentUser() requester: Account) {
    return this.propertiesService.diagnoseTenantDataLeakage(requester.id);
  }

  @ApiOperation({
    summary: 'Clean up duplicate tenant assignments',
  })
  @ApiOkResponse({
    description: 'Duplicate tenant assignments cleaned up',
  })
  @ApiSecurity('access_token')
  @Post('cleanup-duplicate-tenants')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  async cleanupDuplicateTenants(@CurrentUser() requester: Account) {
    return this.propertiesService.cleanupDuplicateTenantAssignments(
      requester.id,
    );
  }

  @ApiOperation({
    summary: 'Fix orphaned rent records',
  })
  @ApiOkResponse({
    description: 'Orphaned rent records fixed',
  })
  @ApiSecurity('access_token')
  @Post('fix-orphaned-rents')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  async fixOrphanedRents(@CurrentUser() requester: Account) {
    return this.propertiesService.fixOrphanedRentRecords(requester.id);
  }

  @ApiOperation({
    summary: 'List All Properties (No Auth - Dev/Testing Only)',
    description:
      'Get all properties with their IDs. No authentication required.',
  })
  @ApiOkResponse({
    description: 'List of all properties',
  })
  @SkipAuth()
  @Get('dev/list-all')
  async listAllPropertiesNoAuth() {
    try {
      const properties = await this.propertiesService.getAllPropertiesNoAuth();
      return {
        statusCode: HttpStatus.OK,
        count: properties.length,
        properties: properties.map((p) => ({
          id: p.id,
          name: p.name,
          location: p.location,
          status: p.property_status,
          owner_id: p.owner_id,
          created_at: p.created_at,
        })),
      };
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({
    summary: 'Force Delete Property (No Auth - Dev/Testing Only)',
    description:
      'Permanently deletes a property and ALL associated records including tenants, rents, history, service requests, KYC data, etc. No authentication required. USE WITH CAUTION!',
  })
  @ApiOkResponse({
    description: 'Property and all associated records permanently deleted',
    schema: {
      properties: {
        statusCode: { type: 'number', example: 200 },
        message: {
          type: 'string',
          example: 'Property and all associated records permanently deleted',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Property not found' })
  @SkipAuth()
  @Delete('dev/force-delete/:id')
  async forceDeleteProperty(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      await this.propertiesService.forceDeleteProperty(id);

      return {
        statusCode: HttpStatus.OK,
        message: 'Property and all associated records permanently deleted',
      };
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get One Property' })
  @ApiOkResponse({
    type: CreatePropertyDto,
    description: 'Property successfully fetched',
  })
  @ApiNotFoundResponse({ description: 'Property not found' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get(':id')
  getPropertyById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.propertiesService.getPropertyById(id);
  }

  @ApiOperation({ summary: 'Get Property Details with History' })
  @ApiOkResponse({
    description: 'Property details with history successfully fetched',
  })
  @ApiNotFoundResponse({ description: 'Property not found' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get(':id/details')
  getPropertyDetails(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.propertiesService.getPropertyDetails(id);
  }

  @ApiOperation({ summary: 'Get Rents Of A Property' })
  @ApiOkResponse({
    type: CreatePropertyDto,
    description: 'Property and rents successfully fetched',
  })
  @ApiNotFoundResponse({ description: 'Property not found' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('rent/:id')
  getRentsOfAProperty(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return this.propertiesService.getRentsOfAProperty(id);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get Service Request Of A Property' })
  @ApiOkResponse({
    type: CreatePropertyDto,
    description: 'Property and Service request successfully fetched',
  })
  @ApiNotFoundResponse({ description: 'Service request not found' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('service-request/:id')
  getServiceRequestOfAProperty(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return this.propertiesService.getServiceRequestOfAProperty(id);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Update Property' })
  // @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UpdatePropertyDto })
  @ApiOkResponse({ description: 'Property successfully updated' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Put(':id')
  @UseGuards(JwtAuthGuard) // only landlords
  // @UseInterceptors(FilesInterceptor('property_images', 20))
  async updatePropertyById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePropertyDto,
    @CurrentUser() requester: Account, // Get the authenticated user
    // @UploadedFiles() files?: Array<Express.Multer.File>,
  ) {
    try {
      // if (files?.length) {
      //   const uploadedUrls = await Promise.all(
      //     files.map((file) =>
      //       this.fileUploadService.uploadFile(file, 'properties'),
      //     ),
      //   );
      //   body.property_images = uploadedUrls.map((upload) => upload.secure_url);
      // }
      console.log(body);

      return this.propertiesService.updatePropertyById(id, body, requester.id);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Delete Property' })
  @ApiOkResponse()
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Delete(':id')
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.LANDLORD)
  async deletePropertyById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() requester: Account, // Get the logged-in user
  ) {
    try {
      await this.propertiesService.deletePropertyById(id, requester.id);

      return {
        statusCode: HttpStatus.OK,
        message: 'Property deleted Successfully.',
      };
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get Admin Dashboard Stats' })
  @ApiOkResponse({
    schema: {
      properties: {
        total_properties: { type: 'number' },
        total_tenants: { type: 'number' },
        due_tenants: { type: 'number' },
        unresolved_requests: { type: 'number' },
      },
    },
  })
  @Get('admin/dashboard')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  async getAdminDashboardStats(@Req() req: any) {
    try {
      const user_id = req?.user?.id;
      return await this.propertiesService.getAdminDashboardStats(user_id);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Move Tenant Into Property' })
  @ApiOkResponse({ description: 'Tenant moved in successfully' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @Post('move-in')
  moveTenantIn(@Body() moveInData: MoveTenantInDto) {
    try {
      return this.propertiesService.moveTenantIn(moveInData);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Move Tenant Out of Property' })
  @ApiOkResponse({ description: 'Tenant moved out successfully' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @Post('move-out')
  moveTenantOut(
    @Body() moveOutData: MoveTenantOutDto,
    @CurrentUser() requester: Account,
  ) {
    try {
      return this.propertiesService.moveTenantOut(moveOutData, requester.id);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get scheduled move-outs' })
  @ApiSecurity('access_token')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @Get('scheduled-move-outs')
  getScheduledMoveOuts(@CurrentUser() requester: Account) {
    try {
      return this.propertiesService.getScheduledMoveOuts(requester.id);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Cancel scheduled move-out' })
  @ApiSecurity('access_token')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @Delete('scheduled-move-outs/:id')
  cancelScheduledMoveOut(
    @Param('id') scheduleId: string,
    @CurrentUser() requester: Account,
  ) {
    try {
      return this.propertiesService.cancelScheduledMoveOut(
        scheduleId,
        requester.id,
      );
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Process scheduled move-outs (Admin only)' })
  @ApiSecurity('access_token')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN)
  @Post('process-scheduled-move-outs')
  processScheduledMoveOuts() {
    try {
      return this.propertiesService.processScheduledMoveOuts();
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Create Property Group' })
  @ApiBody({ type: CreatePropertyGroupDto })
  @ApiCreatedResponse({ type: CreatePropertyGroupDto })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post('property-group')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  async createPropertyGroup(
    @Body() body: CreatePropertyGroupDto,
    @Req() req: any,
  ) {
    try {
      const owner_id = req?.user?.id;
      return this.propertiesService.createPropertyGroup(body, owner_id);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get Property Group Details' })
  @ApiOkResponse({ description: 'Property group details with properties' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('property-group/:id')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  async getPropertyGroupById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: any,
  ) {
    try {
      const owner_id = req?.user?.id;
      return this.propertiesService.getPropertyGroupById(id, owner_id);
    } catch (error) {
      throw error;
    }
  }
  @Post('assign-tenant/:id')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  async assignTenantToProperty(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() data: AssignTenantDto,
  ) {
    return this.propertiesService.assignTenant(id, data);
  }

  @ApiOperation({
    summary: 'Sync Property Statuses and Fix Missing History Records',
  })
  @ApiOkResponse({
    description:
      'Property statuses synchronized and missing history records created',
    schema: {
      properties: {
        message: { type: 'string' },
        statusUpdates: { type: 'number' },
        historyRecordsCreated: { type: 'number' },
      },
    },
  })
  @ApiSecurity('access_token')
  @Post('sync-statuses')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  async syncPropertyStatuses() {
    return this.propertiesService.syncPropertyStatuses();
  }

  @ApiOperation({
    summary: 'Fix Tenant Data Leakage - Run Data Consistency Analysis',
  })
  @ApiOkResponse({
    description: 'Data consistency analysis completed',
    schema: {
      properties: {
        message: { type: 'string' },
        fixed: { type: 'boolean' },
        details: { type: 'object' },
      },
    },
  })
  @ApiSecurity('access_token')
  @Post('fix-tenant-data-leakage')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  async fixTenantDataLeakage(@CurrentUser() requester: Account) {
    return this.propertiesService.fixTenantDataLeakage(requester.id);
  }

  @ApiOperation({
    summary: 'Fix Empty Last Names - Clean up empty lastName fields',
  })
  @ApiOkResponse({
    description: 'Empty lastName fields fixed',
    schema: {
      properties: {
        message: { type: 'string' },
        usersFixed: { type: 'number' },
        kycFixed: { type: 'number' },
        details: { type: 'object' },
      },
    },
  })
  @ApiSecurity('access_token')
  @Post('fix-empty-lastnames')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  async fixEmptyLastNames(@CurrentUser() requester: Account) {
    const userResult = await this.fixEmptyLastnameService.fixEmptyLastNames(
      requester.id,
    );
    const kycResult = await this.fixEmptyLastnameService.fixEmptyLastNamesInKyc(
      requester.id,
    );

    return {
      message: 'Empty lastName fix completed',
      usersFixed: userResult.fixedUsers?.length || 0,
      kycFixed: kycResult.fixedKyc?.length || 0,
      userResult,
      kycResult,
    };
  }
}
