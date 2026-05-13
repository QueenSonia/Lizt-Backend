import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CommonAreasService } from './common-areas.service';
import { CreateCommonAreaDto } from './dto/create-common-area.dto';
import { UpdateCommonAreaDto } from './dto/update-common-area.dto';

@ApiTags('Common-Areas')
@Controller('common-areas')
export class CommonAreasController {
  constructor(private readonly commonAreasService: CommonAreasService) {}

  @ApiOperation({
    summary: 'Create a common area',
    description:
      "Landlord-owned common area. The authenticated user becomes the owner.",
  })
  @ApiCreatedResponse({ description: 'Common area created' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post()
  create(@Body() dto: CreateCommonAreaDto, @Req() req: any) {
    return this.commonAreasService.create(req?.user?.id, dto);
  }

  @ApiOperation({
    summary: "List the landlord's common areas with request counts",
  })
  @ApiOkResponse({ description: 'Common areas owned by the caller' })
  @ApiSecurity('access_token')
  @Get()
  findAll(@Req() req: any) {
    return this.commonAreasService.findAllForLandlord(req?.user?.id);
  }

  @ApiOperation({
    summary: 'Common areas visible to a facility manager',
    description:
      'Returns every common area owned by a landlord the requesting FM is teamed with. Each row includes `owner_id` and `owner_name` so the UI can prefix the landlord name when the FM serves multiple landlords.',
  })
  @ApiOkResponse({ description: 'Common areas across teamed landlords' })
  @ApiSecurity('access_token')
  @Get('for-fm')
  findAllForFm(@Req() req: any) {
    return this.commonAreasService.findAllForFm(req?.user?.id);
  }

  @ApiOperation({ summary: 'Get a common area by id' })
  @ApiOkResponse({ description: 'Common area details' })
  @ApiNotFoundResponse()
  @ApiSecurity('access_token')
  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: any) {
    return this.commonAreasService.findOne(id, req?.user?.id);
  }

  @ApiOperation({ summary: 'Update a common area (owner only)' })
  @ApiOkResponse({ description: 'Common area updated' })
  @ApiSecurity('access_token')
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCommonAreaDto,
    @Req() req: any,
  ) {
    return this.commonAreasService.update(id, req?.user?.id, dto);
  }

  @ApiOperation({ summary: 'Soft-delete a common area (owner only)' })
  @ApiOkResponse({ description: 'Common area deleted' })
  @ApiSecurity('access_token')
  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: any) {
    return this.commonAreasService.softDelete(id, req?.user?.id);
  }
}
