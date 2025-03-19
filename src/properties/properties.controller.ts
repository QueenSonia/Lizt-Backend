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
} from '@nestjs/swagger';
import { PaginationResponseDto } from './dto/paginate.dto';

@Controller('properties')
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @ApiOperation({ summary: 'Create Property' })
  @ApiBody({ type: CreatePropertyDto })
  @ApiCreatedResponse({ type: CreatePropertyDto })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post()
  async createProperty(@Body() body: CreatePropertyDto) {
    try {
      return this.propertiesService.createProperty(body);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get All Properties' })
  @ApiOkResponse({
    type: PaginationResponseDto,
    description: 'Paginated list of properties',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get()
  getAllProperties(@Query() query: PropertyFilter) {
    try {
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
}
