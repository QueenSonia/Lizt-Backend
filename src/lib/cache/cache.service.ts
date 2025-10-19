import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { millisecondsToSeconds } from 'date-fns';

import { DEFAULT_TTL, REDIS_CLIENT } from './constants';

@Injectable()
export class CacheService {
  constructor(@Inject(REDIS_CLIENT) private cache: Redis) {}

  private stringifyIfNeeded<T = any>(value: T): string | T {
    if (value && (typeof value === 'object' || Array.isArray(value))) {
      return JSON.stringify(value);
    }
    return value;
  }

  private parseIfNeeded<T = any>(value: any): T {
    try {
      return JSON.parse(value);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      return value as unknown as T;
    }
  }

  async get<T = any>(key: string): Promise<T | undefined> {
    const value = await this.cache.get(key);
    return value ? this.parseIfNeeded(value) : undefined;
  }

  async addToSet(key: string, value: any, ttl?: number) {
    const pipeline = this.cache.pipeline();

    pipeline.sadd(key, this.stringifyIfNeeded(value));
    pipeline.expire(key, millisecondsToSeconds(ttl || DEFAULT_TTL));

    await pipeline.exec();
  }

  async removeFromSet(key: string, member: any) {
    return await this.cache.srem(key, member);
  }

  async getSetMembers(key: string) {
    const members = await this.cache.smembers(key);
    return members.map((member) => this.parseIfNeeded(member));
  }

  async isMember(key: string, member: string) {
    return (await this.cache.sismember(key, member)) === 1;
  }

  async set(key: string, value: any, ttl?: number) {
    const stringifiedValue = this.stringifyIfNeeded(value);

    const ttlInSeconds = millisecondsToSeconds(ttl ?? DEFAULT_TTL);

    if (ttlInSeconds > 0) {
      return await this.cache.set(key, stringifiedValue, 'EX', ttlInSeconds);
    } else {
      return await this.cache.set(key, stringifiedValue);
    }
  }

  async delete(key: string) {
    return await this.cache.del(key);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.cache.exists(key)) === 1;
  }

  async clear() {
    return await this.cache.flushdb();
  }
}
