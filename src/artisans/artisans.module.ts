import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Artisan } from './entities/artisan.entity';
import { ArtisansService } from './artisans.service';
import { ArtisansController } from './artisans.controller';
import { Team } from '../users/entities/team.entity';
import { TeamMember } from '../users/entities/team-member.entity';
import { Account } from '../users/entities/account.entity';
import { UtilsModule } from '../utils/utils.module';

@Module({
  imports: [
    // Account is needed by JwtAuthGuard to hydrate req.user from the JWT
    // payload into the full Account entity.
    TypeOrmModule.forFeature([Artisan, Team, TeamMember, Account]),
    UtilsModule,
  ],
  controllers: [ArtisansController],
  providers: [ArtisansService],
  exports: [ArtisansService],
})
export class ArtisansModule {}
