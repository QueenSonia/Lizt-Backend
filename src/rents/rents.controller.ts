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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { RentsService } from './rents.service';
import { CreateRentDto, RentFilter } from './dto/create-rent.dto';
import { UpdateRentDto } from './dto/update-rent.dto';
import {
  ApiOperation,
  ApiBody,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiSecurity,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiQuery,
  ApiConsumes,
  ApiTags,
} from '@nestjs/swagger';
import { RentPaginationResponseDto } from './dto/paginate.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { FileUploadService } from 'src/utils/cloudinary';
import { RoleGuard } from 'src/auth/role.guard';
import { Roles } from 'src/auth/role.decorator';
import { RolesEnum } from 'src/base.entity';
import { CreateRentIncreaseDto } from './dto/create-rent-increase.dto';
import { ManagedScopeInterceptor } from 'src/common/scope/managed-scope.interceptor';
import { ManagedLandlordIds } from 'src/common/scope/managed-landlord-ids.decorator';

@ApiTags('Rents')
@Controller('rents')
@UseInterceptors(ManagedScopeInterceptor)
export class RentsController {
  constructor(
    private readonly rentsService: RentsService,
    private readonly fileUploadService: FileUploadService,
  ) {}

  @ApiOperation({ summary: 'Pay Rent' })
  // @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateRentDto })
  @ApiCreatedResponse({ type: CreateRentDto })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post()
  // @UseInterceptors(FilesInterceptor('rent_receipts', 20))
  async payRent(
    @Body() body: CreateRentDto,
    // @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    try {
      // if (!files || files.length === 0) {
      //   throw new HttpException(
      //     'Rent receipts are required',
      //     HttpStatus.BAD_REQUEST,
      //   );
      // }
      // const uploadedUrls = await Promise.all(
      //   files.map((file) => this.fileUploadService.uploadFile(file, 'rents')),
      // );

      // body.rent_receipts = uploadedUrls.map((upload) => upload.secure_url);
      return this.rentsService.payRent(body);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get All Rents' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiQuery({ name: 'tenant_id', required: false, type: String })
  @ApiQuery({ name: 'property_id', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'start_date', required: false, type: String })
  @ApiQuery({ name: 'end_date', required: false, type: String })
  @ApiOkResponse({
    type: RentPaginationResponseDto,
    description: 'Paginated list of rents',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get()
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.ADMIN)
  getAllRents(
    @Query() query: RentFilter,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.rentsService.getAllRents(query, landlordIds);
  }

  @ApiOperation({ summary: 'Get Rents by Tenant ID' })
  @ApiOkResponse({
    type: CreateRentDto,
    description: 'Tenant Rents successfully fetched',
  })
  @ApiNotFoundResponse({ description: 'Tenant has never paid rent' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('tenant/:tenant_id')
  @Roles(RolesEnum.ADMIN)
  getRentByTenantId(
    @Param('tenant_id', new ParseUUIDPipe()) tenant_id: string,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.rentsService.getRentByTenantId(tenant_id, landlordIds);
  }

  @ApiOperation({ summary: 'Get Due Rents Within 7 Days' })
  @ApiOkResponse({
    type: RentPaginationResponseDto,
    description: 'Paginated list of rents',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('due')
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.ADMIN)
  getDueRentsWithinSevenDays(
    @Query() query: RentFilter,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.rentsService.getDueRentsWithinSevenDays(query, landlordIds);
  }

  @ApiOperation({ summary: 'Get Overdue Rents' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiQuery({ name: 'tenant_id', required: false, type: String })
  @ApiQuery({ name: 'owner_id', required: false, type: String })
  @ApiQuery({ name: 'property_id', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'start_date', required: false, type: String })
  @ApiQuery({ name: 'end_date', required: false, type: String })
  @ApiOkResponse({
    type: RentPaginationResponseDto,
    description: 'Paginated list of overdue rents',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('overdue')
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.ADMIN)
  getOverdueRents(
    @Query() query: RentFilter,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.rentsService.getOverdueRents(query, landlordIds);
  }

  @ApiOperation({ summary: 'Send Rent Reminder' })
  @ApiOkResponse({
    description: 'Reminder sent successfully',
  })
  @ApiNotFoundResponse({ description: 'Rent not found' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('reminder/:id')
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.ADMIN)
  sendReminder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.rentsService.sendRentReminder(id, landlordIds);
  }

  @ApiOperation({ summary: 'Get One Rent' })
  @ApiOkResponse({
    type: CreateRentDto,
    description: 'Property successfully fetched',
  })
  @ApiNotFoundResponse({ description: 'Rent not found' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get(':id')
  @Roles(RolesEnum.ADMIN)
  getRentById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.rentsService.getRentById(id, landlordIds);
  }

  @ApiOperation({ summary: 'Update Rent' })
  // @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UpdateRentDto })
  @ApiOkResponse({ description: 'Rent successfully updated' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Put(':id')
  @Roles(RolesEnum.ADMIN)
  async updateRentById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateRentDto,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.rentsService.updateRentById(id, body, landlordIds);
  }

  @ApiOperation({ summary: 'Delete Rent' })
  @ApiOkResponse()
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Delete(':id')
  @Roles(RolesEnum.ADMIN)
  deleteRentById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.rentsService.deleteRentById(id, landlordIds);
  }

  @ApiOperation({ summary: 'Create or update rent increase for a property' })
  @ApiOkResponse()
  @ApiNotFoundResponse({ description: 'You do not own this Property' })
  @Post('increase')
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.ADMIN)
  async saveOrUpdateRentIncrease(
    @Body() body: CreateRentIncreaseDto,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.rentsService.saveOrUpdateRentIncrease(body, landlordIds);
  }

  @Roles(RolesEnum.ADMIN)
  @Put('/remove/:tenant_id')
  async removeTenant(
    @Param('tenant_id', new ParseUUIDPipe()) tenant_id: string,
    @Body() body: { property_id: string },
  ) {
    try {
      const { property_id } = body;
      return this.rentsService.deactivateTenant({ tenant_id, property_id });
    } catch (error) {
      throw error;
    }
  }
}
