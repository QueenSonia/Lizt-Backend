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
} from '@nestjs/swagger';
import { PaginationResponseDto } from './dto/paginate.dto';

@Controller('rents')
@ApiSecurity('access_token')
export class RentsController {
  constructor(private readonly rentsService: RentsService) {}

  @ApiOperation({ summary: 'Pay Rent' })
  @ApiBody({ type: CreateRentDto })
  @ApiCreatedResponse({ type: CreateRentDto })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post()
  payRent(@Body() body: CreateRentDto) {
    try {
      return this.rentsService.payRent(body);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get All Rents' })
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

  @ApiOperation({ summary: 'Get Due Rents' })
  @ApiOkResponse({
    type: PaginationResponseDto,
    description: 'Paginated list of rents',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('due')
  getDueRents(@Query() query: RentFilter) {
    try {
      return this.rentsService.getDueRents(query);
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
