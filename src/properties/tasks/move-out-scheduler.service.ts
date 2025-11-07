import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PropertiesService } from '../properties.service';

@Injectable()
export class MoveOutSchedulerService {
  private readonly logger = new Logger(MoveOutSchedulerService.name);

  constructor(private readonly propertiesService: PropertiesService) {}

  // Run every day at 6:00 AM to process scheduled move-outs
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleScheduledMoveOuts() {
    this.logger.log('Processing scheduled move-outs...');

    try {
      const result = await this.propertiesService.processScheduledMoveOuts();
      this.logger.log(
        `Processed ${result.processed} out of ${result.total} scheduled move-outs`,
      );
    } catch (error) {
      this.logger.error('Failed to process scheduled move-outs:', error);
    }
  }

  // Also run at noon as a backup
  @Cron(CronExpression.EVERY_DAY_AT_NOON)
  async handleScheduledMoveOutsBackup() {
    this.logger.log('Running backup scheduled move-outs processing...');

    try {
      const result = await this.propertiesService.processScheduledMoveOuts();
      if (result.processed > 0) {
        this.logger.log(
          `Backup processing: Processed ${result.processed} out of ${result.total} scheduled move-outs`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Failed to process scheduled move-outs in backup run:',
        error,
      );
    }
  }
}
