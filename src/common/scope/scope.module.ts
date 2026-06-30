import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from 'src/users/entities/account.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { ManagementScopeService } from './management-scope.service';
import { ManagedScopeInterceptor } from './managed-scope.interceptor';

/**
 * Provides {@link ManagementScopeService} (and the {@link ManagedScopeInterceptor})
 * for resolving the set of landlords an admin/facility-manager may see or act
 * for. Import this module wherever landlord-scoped reads/writes need to fan out
 * across managed landlords.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Account, TeamMember])],
  providers: [ManagementScopeService, ManagedScopeInterceptor],
  exports: [ManagementScopeService, ManagedScopeInterceptor],
})
export class ScopeModule {}
