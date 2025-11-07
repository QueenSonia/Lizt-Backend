import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseService implements OnApplicationBootstrap {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    try {
      if (!this.dataSource.isInitialized) {
        await this.dataSource.initialize();
      }

      // Set up connection error handlers for PostgreSQL
      const pool = (this.dataSource.driver as any).master;
      if (pool && typeof pool.on === 'function') {
        pool.on('error', (err: Error) => {
          console.error('Unexpected database pool error:', err);
        });
      }

      if (this.configService.get<string>('NODE_ENV') === 'development') {
        await this.dataSource.synchronize();
      }

      console.log('Database connection established successfully🗼');
    } catch (error) {
      console.error('Unable to connect to the database⚠️:', error);

      // Don't exit immediately in development - allow retries
      if (this.configService.get<string>('NODE_ENV') === 'production') {
        process.exit(1);
      } else {
        console.log(
          'Continuing in development mode - will retry on next request',
        );
      }
    }
  }
}
