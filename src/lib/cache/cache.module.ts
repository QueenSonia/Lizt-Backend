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
            // Stop retrying after 3 attempts
            if (times > 3) {
              logger.warn('Redis connection failed after 3 attempts. Running without Redis cache.');
              return null; // Stop retrying
            }
            const delay = Math.min(times * 100, 5000);
            return delay;
          },

          enableReadyCheck: true,

          maxRetriesPerRequest: 3,

          connectTimeout: 10000,

          lazyConnect: true, // Don't connect immediately
        });

        // Add error handler to prevent unhandled errors
        client.on('error', (err) => {
          logger.warn('Redis connection error:', err.message);
        });

        try {
          await client.connect();
          await client.ping();
          logger.log('Redis connection verified');
        } catch (e) {
          logger.error('Redis connection failed - continuing without cache');
          logger.warn('To use Redis caching, start Redis: npm run db:dev:up');
          // Return a mock client that does nothing instead of throwing
          return {
            get: async () => null,
            set: async () => 'OK',
            del: async () => 1,
            exists: async () => 0,
            expire: async () => 1,
            ttl: async () => -1,
            keys: async () => [],
            flushall: async () => 'OK',
            ping: async () => 'PONG',
            quit: async () => 'OK',
            disconnect: () => {},
            on: () => {},
            off: () => {},
          };
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