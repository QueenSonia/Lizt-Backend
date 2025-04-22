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
  Req,
  UseInterceptors,
  UploadedFiles,
  HttpException,
  HttpStatus,
  UseGuards,
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
import { PaginationResponseDto } from './dto/paginate.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { FileUploadService } from 'src/utils/cloudinary';
import { RoleGuard } from 'src/auth/role.guard';
import { Roles } from 'src/auth/role.decorator';
import { ADMIN_ROLES } from 'src/base.entity';

@ApiTags('Rents')
@Controller('rents')
export class RentsController {
  constructor(
    private readonly rentsService: RentsService,
    private readonly fileUploadService: FileUploadService,
  ) {}

  @ApiOperation({ summary: 'Pay Rent' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateRentDto })
  @ApiCreatedResponse({ type: CreateRentDto })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post()
  @UseInterceptors(FilesInterceptor('rent_receipts', 20))
  async payRent(
    @Body() body: CreateRentDto,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    try {
      if (!files || files.length === 0) {
        throw new HttpException(
          'Rent receipts are required',
          HttpStatus.BAD_REQUEST,
        );
      }
      const uploadedUrls = await Promise.all(
        files.map((file) => this.fileUploadService.uploadFile(file, 'rents')),
      );

      body.rent_receipts = uploadedUrls.map((upload) => upload.secure_url);

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
    type: PaginationResponseDto,
    description: 'Paginated list of rents',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get()
  getAllRents(@Query() query: RentFilter) {
    try {
      return this.rentsService.getAllRents(query);
    } catch (error) {
      throw error;
    }
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
  getRentByTenantId(
    @Param('tenant_id', new ParseUUIDPipe()) tenant_id: string,
  ) {
    try {
      return this.rentsService.getRentByTenantId(tenant_id);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get Due Rents Within 7 Days' })
  @ApiOkResponse({
    type: PaginationResponseDto,
    description: 'Paginated list of rents',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('due')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN)
  getDueRentsWithinSevenDays(@Query() query: RentFilter, @Req() req: any) {
    try {
      query.owner_id = req?.user?.id;
      return this.rentsService.getDueRentsWithinSevenDays(query);
    } catch (error) {
      throw error;
    }
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
    type: PaginationResponseDto,
    description: 'Paginated list of overdue rents',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('overdue')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN)
  getOverdueRents(@Query() query: RentFilter, @Req() req: any) {
    try {
      query.owner_id = req?.user?.id;
      return this.rentsService.getOverdueRents(query);
    } catch (error) {
      throw error;
    }
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
  @Roles(ADMIN_ROLES.ADMIN)
  sendReminder(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return this.rentsService.sendRentReminder(id);
    } catch (error) {
      throw error;
    }
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
  getRentById(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return this.rentsService.getRentById(id);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Update Rent' })
  @ApiBody({ type: UpdateRentDto })
  @ApiOkResponse({ description: 'Rent successfully updated' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Put(':id')
  updatePropertyById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateRentDto,
  ) {
    try {
      return this.rentsService.updateRentById(id, body);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Delete Rent' })
  @ApiOkResponse()
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Delete(':id')
  deletePropertyById(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return this.rentsService.deleteRentById(id);
    } catch (error) {
      throw error;
    }
  }
}
