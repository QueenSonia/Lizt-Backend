import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from 'src/lib/cache';
import { ACCOUNT_CACHE } from 'src/lib/cache/cache-keys';

/**
 * Service to manage account cache invalidation.
 * Use this when account data changes (role updates, profile changes, etc.)
 */
@Injectable()
export class AccountCacheService {
  private readonly logger = new Logger(AccountCacheService.name);

  constructor(private readonly cacheService: CacheService) {}

  /**
   * Invalidate cached account data for a specific account.
   * Call this when:
   * - Account role changes
   * - Account profile_name changes
   * - Account is_verified changes
   * - User entity linked to account changes
   */
  async invalidate(accountId: string): Promise<void> {
    try {
      await this.cacheService.delete(ACCOUNT_CACHE(accountId));
      this.logger.debug(`Invalidated cache for account ${accountId}`);
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate cache for account ${accountId}: ${error.message}`,
      );
    }
  }

  /**
   * Invalidate cached account data for multiple accounts.
   */
  async invalidateMany(accountIds: string[]): Promise<void> {
    await Promise.all(accountIds.map((id) => this.invalidate(id)));
  }
}
