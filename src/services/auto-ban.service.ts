import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from 'src/lib/cache';

interface SuspiciousActivity {
  ip: string;
  path: string;
  timestamp: Date;
  userAgent?: string;
}

@Injectable()
export class AutoBanService {
  private readonly logger = new Logger(AutoBanService.name);

  // Thresholds for automatic banning
  private readonly SUSPICIOUS_REQUESTS_THRESHOLD = 10; // 10 suspicious requests
  private readonly TIME_WINDOW_SECONDS = 300; // within 5 minutes
  private readonly BAN_DURATION_SECONDS = 3600; // ban for 1 hour

  constructor(private cacheService: CacheService) {}

  /**
   * Record a suspicious activity and check if IP should be banned
   */
  async recordSuspiciousActivity(
    activity: SuspiciousActivity,
  ): Promise<boolean> {
    const { ip, path } = activity;
    const key = `suspicious_activity:${ip}`;

    try {
      // Get current suspicious activity count
      const countStr = await this.cacheService.get<string>(key);
      const currentCount = countStr ? parseInt(countStr, 10) : 0;
      const newCount = currentCount + 1;

      // Update the count with TTL
      await this.cacheService.setWithTtlSeconds(
        key,
        newCount.toString(),
        this.TIME_WINDOW_SECONDS,
      );

      this.logger.warn(
        `Suspicious activity from ${ip}: ${path} (${newCount}/${this.SUSPICIOUS_REQUESTS_THRESHOLD})`,
      );

      // Check if threshold exceeded
      if (newCount >= this.SUSPICIOUS_REQUESTS_THRESHOLD) {
        await this.banIP(ip, this.BAN_DURATION_SECONDS);
        return true; // IP was banned
      }

      return false; // IP not banned yet
    } catch (error) {
      this.logger.error(
        `Failed to record suspicious activity: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Ban an IP address
   */
  async banIP(
    ip: string,
    durationSeconds: number = this.BAN_DURATION_SECONDS,
  ): Promise<void> {
    const banKey = `ip_banned:${ip}`;

    try {
      await this.cacheService.setWithTtlSeconds(
        banKey,
        'banned',
        durationSeconds,
      );

      this.logger.warn(
        `🚫 BANNED IP ${ip} for ${durationSeconds} seconds due to suspicious activity`,
      );

      // Clear the suspicious activity counter since IP is now banned
      await this.cacheService.delete(`suspicious_activity:${ip}`);
    } catch (error) {
      this.logger.error(`Failed to ban IP ${ip}: ${error.message}`);
    }
  }

  /**
   * Check if an IP is currently banned
   */
  async isIPBanned(ip: string): Promise<boolean> {
    const banKey = `ip_banned:${ip}`;

    try {
      const banned = await this.cacheService.get(banKey);
      return !!banned;
    } catch (error) {
      this.logger.error(
        `Failed to check ban status for IP ${ip}: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Unban an IP address (manual override)
   */
  async unbanIP(ip: string): Promise<void> {
    const banKey = `ip_banned:${ip}`;
    const activityKey = `suspicious_activity:${ip}`;

    try {
      await Promise.all([
        this.cacheService.delete(banKey),
        this.cacheService.delete(activityKey),
      ]);

      this.logger.log(`✅ Unbanned IP ${ip}`);
    } catch (error) {
      this.logger.error(`Failed to unban IP ${ip}: ${error.message}`);
    }
  }

  /**
   * Get list of currently banned IPs (for monitoring)
   */
  async getBannedIPs(): Promise<string[]> {
    // This would require implementing a scan method in your cache service
    // For now, return empty array
    return [];
  }
}
