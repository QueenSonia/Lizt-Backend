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
} from '@nestjs/swagger';
import { PaginationResponseDto } from './dto/paginate.dto';
import { FilesInterceptor } from '@nestjs/platform-express';
import { FileUploadService } from 'src/utils/cloudinary';

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
