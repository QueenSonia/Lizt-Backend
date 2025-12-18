import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PropertiesService } from '../properties/properties.service';

@Injectable()
export class RentConsistencyService {
  private readonly logger = new Logger(RentConsistencyService.name);

  constructor(private readonly propertiesService: PropertiesService) {}

  /**
   * Run rent consistency check every day at 2 AM
   * This helps catch and fix data inconsistencies automatically
   * DISABLED: Temporarily disabled to save Neon compute quota
   */
  // @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runDailyConsistencyCheck() {
    this.logger.log('Starting daily rent consistency check...');

    try {
      const result = await this.propertiesService.checkAndFixRentConsistency();

      this.logger.log(`Daily rent consistency check completed:`, {
        issuesFound: result.issues.length,
        issuesFixed: result.fixed,
        details: result.details,
      });

      // If issues were found and fixed, log them for monitoring
      if (result.issues.length > 0) {
        this.logger.warn(`Rent consistency issues detected and fixed:`, {
          issues: result.issues,
          totalFixed: result.fixed,
        });
      }
    } catch (error) {
      this.logger.error('Daily rent consistency check failed:', error);
    }
  }

  /**
   * Run a more frequent check every 6 hours for critical issues
   * This catches issues faster during business hours
   * DISABLED: Temporarily disabled to save Neon compute quota
   */
  // @Cron('0 */6 * * *') // Every 6 hours
  async runFrequentConsistencyCheck() {
    this.logger.log('Starting frequent rent consistency check...');

    try {
      // Only check for critical issues (orphaned active rents)
      const result = await this.propertiesService.checkAndFixRentConsistency();

      // Only log if critical issues were found
      const criticalIssues = result.issues.filter(
        (issue) =>
          issue.type === 'orphaned_active_rent' ||
          issue.type === 'multiple_active_rents',
      );

      if (criticalIssues.length > 0) {
        this.logger.warn(`Critical rent consistency issues detected:`, {
          criticalIssues,
          totalFixed: result.fixed,
        });
      }
    } catch (error) {
      this.logger.error('Frequent rent consistency check failed:', error);
    }
  }
}
