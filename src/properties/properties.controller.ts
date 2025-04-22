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
} from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto, PropertyFilter } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
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
import { PaginationResponseDto } from './dto/paginate.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { FileUploadService } from 'src/utils/cloudinary';
import { RoleGuard } from 'src/auth/role.guard';
import { Roles } from 'src/auth/role.decorator';
import { ADMIN_ROLES } from 'src/base.entity';
@ApiTags('Properties')
@Controller('properties')
export class PropertiesController {
  constructor(
    private readonly propertiesService: PropertiesService,
    private readonly fileUploadService: FileUploadService,
  ) {}

  @ApiOperation({ summary: 'Create Property' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreatePropertyDto })
  @ApiCreatedResponse({ type: CreatePropertyDto })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post()
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN)
  @UseInterceptors(FilesInterceptor('property_images', 20))
  async createProperty(
    @Body() body: CreatePropertyDto,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    try {
      if (!files || files.length === 0) {
        throw new HttpException(
          'Property images are required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const uploadedUrls = await Promise.all(
        files.map((file) => this.fileUploadService.uploadFile(file)),
      );

      body.property_images = uploadedUrls.map((upload) => upload.secure_url);

      return this.propertiesService.createProperty(body);
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
  @ApiOkResponse({
    type: PaginationResponseDto,
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
    try {
      return this.propertiesService.getPropertyById(id);
    } catch (error) {
      throw error;
    }
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

  @ApiOperation({ summary: 'Update Property' })
  @ApiBody({ type: UpdatePropertyDto })
  @ApiOkResponse({ description: 'Property successfully updated' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Put(':id')
  updatePropertyById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePropertyDto,
  ) {
    try {
      return this.propertiesService.updatePropertyById(id, body);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Delete Property' })
  @ApiOkResponse()
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Delete(':id')
  deletePropertyById(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return this.propertiesService.deletePropertyById(id);
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
  @Roles(ADMIN_ROLES.ADMIN)
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
  @Roles(ADMIN_ROLES.ADMIN)
  @Post('move-in/:property_id')
  moveTenantIn(
    @Param('property_id', new ParseUUIDPipe()) property_id: string,
    @Body('tenant_id', new ParseUUIDPipe()) tenant_id: string,
    @Body('move_in_date') moveInDate: string,
  ) {
    try {
      return this.propertiesService.moveTenantIn(
        property_id,
        tenant_id,
        moveInDate,
      );
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Move Tenant Out of Property' })
  @ApiOkResponse({ description: 'Tenant moved out successfully' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN)
  @Post('move-out/:property_id')
  moveTenantOut(
    @Param('property_id', new ParseUUIDPipe()) property_id: string,
    @Body('tenant_id', new ParseUUIDPipe()) tenant_id: string,
    @Body('move_out_date') moveOutDate: string,
  ) {
    try {
      return this.propertiesService.moveTenantOut(
        property_id,
        tenant_id,
        moveOutDate,
      );
    } catch (error) {
      throw error;
    }
  }
}
