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

      if (this.configService.get<string>('NODE_ENV') === 'development') {
        await this.dataSource.synchronize();
      }

      console.log('Database connection established successfully🗼');
    } catch (error) {
      console.error('Unable to connect to the database⚠️:', error);
      process.exit(1);
    }
  }
}
