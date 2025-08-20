import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { REDIS_CLIENT, REDIS_CLOUD_URL } from './constants';
import { CacheService } from './cache.service';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: async (config: ConfigService) => {
        const logger = new Logger('RedisModule');
        const redisUrl = config.get(REDIS_CLOUD_URL);

        const client = new Redis(redisUrl, {
          retryStrategy: (times) => {
            const delay = Math.min(times * 100, 5000);

            return delay;
          },

          enableReadyCheck: true,

          maxRetriesPerRequest: 3,

          connectTimeout: 10000,
        });

        try {
          await client.ping();
          logger.log('Redis connection verified');
        } catch (e) {
          logger.error('Redis connection failed', e.stack);
          throw e;
        }

        return client;
      },
      inject: [ConfigService],
    },
    CacheService,
  ],
  exports: [REDIS_CLIENT, CacheService],
})
export class AppCacheModule {}
