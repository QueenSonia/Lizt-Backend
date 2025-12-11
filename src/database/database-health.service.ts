import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class DatabaseHealthService {
  private readonly logger = new Logger(DatabaseHealthService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkDatabaseHealth() {
    try {
      await this.dataSource.query('SELECT 1');
      this.logger.debug('Database health check passed');
    } catch (error) {
      this.logger.error('Database health check failed:', error.message);

      // Attempt to reconnect if connection is lost
      if (!this.dataSource.isInitialized) {
        this.logger.warn('Attempting to reconnect to database...');
        try {
          await this.dataSource.initialize();
          this.logger.log('Database reconnection successful');
        } catch (reconnectError) {
          this.logger.error(
            'Database reconnection failed:',
            reconnectError.message,
          );
        }
      }
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
