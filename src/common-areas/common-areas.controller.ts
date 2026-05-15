import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Account } from '../users/entities/account.entity';

// common_areas.owner_id FKs to users.id, not accounts.id. The JWT carries
// Account.id, so every handler here resolves to `requester.userId` before
// touching owner_id — anything else surfaces as a 23503 FK violation on
// insert and silent 403/empty results on read paths.
@ApiTags('Common-Areas')
@UseGuards(JwtAuthGuard)
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
  create(
    @Body() dto: CreateCommonAreaDto,
    @CurrentUser() requester: Account,
  ) {
    return this.commonAreasService.create(requester.userId, dto);
  }

  @ApiOperation({
    summary: "List the landlord's common areas with request counts",
  })
  @ApiOkResponse({ description: 'Common areas owned by the caller' })
  @ApiSecurity('access_token')
  @Get()
  findAll(@CurrentUser() requester: Account) {
    return this.commonAreasService.findAllForLandlord(requester.userId);
  }

  @ApiOperation({
    summary: 'Common areas visible to a facility manager',
    description:
      'Returns every common area owned by a landlord the requesting FM is teamed with. Each row includes `owner_id` and `owner_name` so the UI can prefix the landlord name when the FM serves multiple landlords.',
  })
  @ApiOkResponse({ description: 'Common areas across teamed landlords' })
  @ApiSecurity('access_token')
  @Get('for-fm')
  findAllForFm(@CurrentUser() requester: Account) {
    return this.commonAreasService.findAllForFm(requester.userId);
  }

  @ApiOperation({ summary: 'Get a common area by id' })
  @ApiOkResponse({ description: 'Common area details' })
  @ApiNotFoundResponse()
  @ApiSecurity('access_token')
  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() requester: Account,
  ) {
    return this.commonAreasService.findOne(id, requester.userId);
  }

  @ApiOperation({ summary: 'Update a common area (owner only)' })
  @ApiOkResponse({ description: 'Common area updated' })
  @ApiSecurity('access_token')
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCommonAreaDto,
    @CurrentUser() requester: Account,
  ) {
    return this.commonAreasService.update(id, requester.userId, dto);
  }

  @ApiOperation({ summary: 'Soft-delete a common area (owner only)' })
  @ApiOkResponse({ description: 'Common area deleted' })
  @ApiSecurity('access_token')
  @Delete(':id')
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() requester: Account,
  ) {
    return this.commonAreasService.softDelete(id, requester.userId);
  }
}
