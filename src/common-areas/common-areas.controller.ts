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
  UseInterceptors,
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
import { ManagedScopeInterceptor } from 'src/common/scope/managed-scope.interceptor';
import { ManagedLandlordIds } from 'src/common/scope/managed-landlord-ids.decorator';

// common_areas.owner_id FKs to accounts.id (same shape as property.owner_id).
// The JWT carries Account.id, so every handler passes `requester.id` straight
// through as the owner — no User.id resolution needed. Admin (PM) list reads
// fan out across the managed-landlord set via @ManagedLandlordIds.
@ApiTags('Common-Areas')
@UseGuards(JwtAuthGuard)
@UseInterceptors(ManagedScopeInterceptor)
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
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.commonAreasService.create(dto, landlordIds);
  }

  @ApiOperation({
    summary: "List the landlord's common areas with request counts",
  })
  @ApiOkResponse({ description: 'Common areas owned by the caller' })
  @ApiSecurity('access_token')
  @Get()
  findAll(@ManagedLandlordIds() landlordIds: string[]) {
    return this.commonAreasService.findAllForLandlord(landlordIds);
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
    return this.commonAreasService.findAllForFm(requester.id);
  }

  @ApiOperation({ summary: 'Get a common area by id' })
  @ApiOkResponse({ description: 'Common area details' })
  @ApiNotFoundResponse()
  @ApiSecurity('access_token')
  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.commonAreasService.findOne(id, landlordIds);
  }

  @ApiOperation({ summary: 'Update a common area (owner only)' })
  @ApiOkResponse({ description: 'Common area updated' })
  @ApiSecurity('access_token')
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCommonAreaDto,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.commonAreasService.update(id, dto, landlordIds);
  }

  @ApiOperation({ summary: 'Soft-delete a common area (owner only)' })
  @ApiOkResponse({ description: 'Common area deleted' })
  @ApiSecurity('access_token')
  @Delete(':id')
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ManagedLandlordIds() landlordIds: string[],
  ) {
    return this.commonAreasService.softDelete(id, landlordIds);
  }
}
