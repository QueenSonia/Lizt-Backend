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
    } catch (e) {
      return value as unknown as T;
    }
  }

  async get<T = any>(key: string): Promise<T | undefined> {
    const value = await this.cache.get(key);
    return value ? this.parseIfNeeded(value) : undefined;
  }

  /**
   * Get multiple keys in a single Redis call (MGET)
   * Returns an object with key-value pairs
   * Missing keys will have undefined values
   */
  async getMultiple<T = any>(
    keys: string[],
  ): Promise<Record<string, T | undefined>> {
    if (keys.length === 0) return {};

    const values = await this.cache.mget(...keys);
    const result: Record<string, T | undefined> = {};

    keys.forEach((key, index) => {
      const value = values[index];
      result[key] = value ? this.parseIfNeeded(value) : undefined;
    });

    return result;
  }

  /**
   * Set multiple keys in a single Redis call (MSET)
   * Note: MSET doesn't support TTL, so use pipeline for TTL support
   */
  async setMultiple(
    entries: Array<{ key: string; value: any; ttl?: number }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const pipeline = this.cache.pipeline();

    for (const { key, value, ttl } of entries) {
      const stringifiedValue = this.stringifyIfNeeded(value);
      const ttlInSeconds = millisecondsToSeconds(ttl ?? DEFAULT_TTL);

      if (ttlInSeconds > 0) {
        pipeline.set(key, stringifiedValue, 'EX', ttlInSeconds);
      } else {
        pipeline.set(key, stringifiedValue);
      }
    }

    await pipeline.exec();
  }

  /**
   * Delete multiple keys in a single Redis call
   */
  async deleteMultiple(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return await this.cache.del(...keys);
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

  /**
   * Set a value with TTL specified in seconds (not milliseconds)
   */
  async setWithTtlSeconds(key: string, value: any, ttlSeconds: number) {
    const stringifiedValue = this.stringifyIfNeeded(value);
    return await this.cache.set(key, stringifiedValue, 'EX', ttlSeconds);
  }

  async delete(key: string) {
    return await this.cache.del(key);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.cache.exists(key)) === 1;
  }

  /**
   * Get the remaining TTL (time to live) for a key in seconds
   * Returns -2 if the key does not exist, -1 if the key exists but has no TTL
   */
  async ttl(key: string): Promise<number> {
    return await this.cache.ttl(key);
  }

  async clear() {
    return await this.cache.flushdb();
  }
}
