import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './auth.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from 'src/users/entities/account.entity';
import { CacheService } from 'src/lib/cache';
import { ACCOUNT_CACHE, ACCOUNT_CACHE_TTL } from 'src/lib/cache/cache-keys';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private reflector: Reflector,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly cacheService: CacheService,
  ) {
    super();
  }

  // Override to attach the full Account entity (from DB) to request.user
  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Call passport's JWT auth first to validate the token and populate request.user (payload)
    const passportCan = (await super.canActivate(context)) as boolean;
    if (!passportCan) return false;

    const req = context.switchToHttp().getRequest();
    const jwtUser = req.user;

    // If the JWT payload provided an id, fetch the full Account (from cache or DB)
    if (jwtUser && jwtUser.id) {
      try {
        const cacheKey = ACCOUNT_CACHE(jwtUser.id);

        // Try cache first
        let account: Account | null | undefined =
          await this.cacheService.get<Account>(cacheKey);

        if (!account) {
          // Cache miss - fetch from DB
          account = await this.accountRepository.findOne({
            where: { id: jwtUser.id },
            relations: ['user'],
          });

          if (account) {
            // Cache the account data (store as plain object to avoid serialization issues)
            const accountData = {
              ...account,
              user: account.user ? { ...account.user } : null,
            };
            await this.cacheService.set(
              cacheKey,
              accountData,
              ACCOUNT_CACHE_TTL,
            );
          }
        }

        if (account) {
          req.user = account;
        }
      } catch (error) {
        // If cache/DB lookup fails, keep the JWT payload on request.user and allow guard to succeed
        this.logger.warn(
          `Failed to fetch account for user ${jwtUser.id}: ${error.message}`,
        );
      }
    }

    return true;
  }

  /**
   * Invalidate cached account data. Call this when account data changes.
   */
  async invalidateAccountCache(accountId: string): Promise<void> {
    try {
      await this.cacheService.delete(ACCOUNT_CACHE(accountId));
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate cache for account ${accountId}: ${error.message}`,
      );
    }
  }
}
