import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ArtisansService } from './artisans.service';
import {
  LookupArtisanByPhoneDto,
  SuggestArtisansDto,
} from './dto/suggest-artisans.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Account } from '../users/entities/account.entity';

// Artisan = tradesperson an FM hires to resolve maintenance tasks. Not a
// login account — see Artisan entity. Endpoints here back the autocomplete +
// conflict-detection UX in the FM ResolutionModal.
@ApiTags('Artisans')
@UseGuards(JwtAuthGuard)
@Controller('artisans')
export class ArtisansController {
  constructor(private readonly artisansService: ArtisansService) {}

  @ApiOperation({
    summary: 'Suggest artisans by partial name or phone',
    description:
      "Returns up to `limit` artisans in the caller's team whose name or " +
      'normalized phone matches `q`. Powers the artisan-name autocomplete in ' +
      'the FM ResolutionModal. Ordered by most-recent-use, then created_at desc.',
  })
  @ApiOkResponse()
  @ApiSecurity('access_token')
  @Get('suggest')
  async suggest(
    @Query() query: SuggestArtisansDto,
    @CurrentUser() requester: Account,
  ) {
    const teamId = await this.artisansService.resolveCallerTeamId(requester);
    const rows = await this.artisansService.suggest(
      teamId,
      query.q,
      query.limit ?? 8,
    );
    return rows.map((a) => ({ id: a.id, name: a.name, phone: a.phone }));
  }

  @ApiOperation({
    summary: 'Look up a single artisan in the caller\'s team by phone',
    description:
      'Returns `{ id, name, phone }` or `null`. The modal calls this once an ' +
      "FM finishes typing the artisan's phone, to detect the case where the " +
      'phone matches an existing artisan but the typed name differs.',
  })
  @ApiOkResponse()
  @ApiSecurity('access_token')
  @Get('lookup-by-phone')
  async lookupByPhone(
    @Query() query: LookupArtisanByPhoneDto,
    @CurrentUser() requester: Account,
  ) {
    const teamId = await this.artisansService.resolveCallerTeamId(requester);
    const match = await this.artisansService.lookupByPhone(teamId, query.phone);
    if (!match) return null;
    return { id: match.id, name: match.name, phone: match.phone };
  }
}
