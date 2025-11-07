import {
  Controller,
  Put,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiBody,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiSecurity,
  ApiTags,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { RoleGuard } from 'src/auth/role.guard';
import { Roles } from 'src/auth/role.decorator';
import { ADMIN_ROLES, RolesEnum } from 'src/base.entity';
import { RenewTenancyDto } from './dto/renew-tenancy.dto';
import { TenanciesService } from 'src/tenancies/tenancies.service';

@ApiTags('Tenancies')
@Controller('tenancies')
@UseGuards(JwtAuthGuard, RoleGuard)
export class TenanciesController {
  constructor(private readonly tenanciesService: TenanciesService) {}

  @ApiOperation({ summary: 'Renew Tenancy' })
  @ApiBody({ type: RenewTenancyDto })
  @ApiOkResponse({ description: 'Tenancy successfully renewed' })
  @ApiBadRequestResponse({ description: 'Invalid input data' })
  @ApiNotFoundResponse({ description: 'Tenancy not found' })
  @ApiSecurity('access_token')
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @Put(':id/renew')
  async renewTenancy(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() renewTenancyDto: RenewTenancyDto,
  ) {
    return this.tenanciesService.renewTenancy(id, renewTenancyDto);
  }
}
