import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ManagementScopeService } from './management-scope.service';

/**
 * Resolves the set of landlord account ids the authenticated requester may see
 * (based on their ACTIVE role) and stashes it on `req.managedLandlordIds`
 * before the route handler runs. Read it in handlers via the
 * `@ManagedLandlordIds()` param decorator.
 *
 * Apply at the controller class level (`@UseInterceptors(ManagedScopeInterceptor)`)
 * on dashboard controllers whose reads must fan out across managed landlords.
 * Runs one cheap indexed query per request; no-ops for unauthenticated
 * (public/SkipAuth) requests, leaving `managedLandlordIds` as [].
 */
@Injectable()
export class ManagedScopeInterceptor implements NestInterceptor {
  constructor(private readonly scopeService: ManagementScopeService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest();
    req.managedLandlordIds = req?.user?.id
      ? await this.scopeService.resolveScopeLandlordIds(req.user)
      : [];
    return next.handle();
  }
}
