import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiSecurity,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { PropertyHistoryService } from './property-history.service';
import {
  CreatePropertyHistoryDto,
  PropertyHistoryFilter,
} from './dto/create-property-history.dto';
import {
  UpdatePropertyHistoryDto,
  UpdatePropertyHistoryResponseDto,
} from './dto/update-property-history.dto';
import { PaginationResponseDto } from './dto/paginate.dto';

@ApiTags('Property-History')
@Controller('property-history')
export class PropertyHistoryController {
  constructor(
    private readonly propertyHistoryService: PropertyHistoryService,
  ) {}

  @ApiOperation({ summary: 'Create Property History' })
  @ApiBody({ type: CreatePropertyHistoryDto })
  @ApiCreatedResponse({ type: CreatePropertyHistoryDto })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post()
  createPropertyHistory(@Body() body: CreatePropertyHistoryDto) {
    try {
      return this.propertyHistoryService.createPropertyHistory(body);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get All Property Histories' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiQuery({ name: 'property_id', required: false, type: String })
  @ApiQuery({ name: 'tenant_id', required: false, type: String })
  @ApiQuery({ name: 'move_in_date', required: false, type: String })
  @ApiQuery({ name: 'move_out_date', required: false, type: String })
  @ApiOkResponse({
    type: PaginationResponseDto,
    description: 'Paginated list of property histories',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get()
  getAllPropertyHistories(@Query() query: PropertyHistoryFilter) {
    try {
      return this.propertyHistoryService.getAllPropertyHistories(query);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get One Property History' })
  @ApiOkResponse({
    type: CreatePropertyHistoryDto,
    description: 'Property history successfully fetched',
  })
  @ApiNotFoundResponse({ description: 'Property history not found' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get(':id')
  getPropertyHistoryById(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return this.propertyHistoryService.getPropertyHistoryById(id);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Update Property History' })
  @ApiBody({ type: UpdatePropertyHistoryDto })
  @ApiOkResponse({ description: 'Property history successfully updated' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Put(':id')
  updatePropertyHistoryById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePropertyHistoryResponseDto,
  ) {
    try {
      return this.propertyHistoryService.updatePropertyHistoryById(id, body);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Delete Property History' })
  @ApiOkResponse()
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Delete(':id')
  deletePropertyHistoryById(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return this.propertyHistoryService.deletePropertyHistoryById(id);
    } catch (error) {
      throw error;
    }
  }
}
