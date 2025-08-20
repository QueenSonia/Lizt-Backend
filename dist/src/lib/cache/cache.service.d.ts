import Redis from 'ioredis';
export declare class CacheService {
    private cache;
    constructor(cache: Redis);
    private stringifyIfNeeded;
    private parseIfNeeded;
    get<T = any>(key: string): Promise<T | undefined>;
    addToSet(key: string, value: any, ttl?: number): Promise<void>;
    removeFromSet(key: string, member: any): Promise<number>;
    getSetMembers(key: string): Promise<any[]>;
    isMember(key: string, member: string): Promise<boolean>;
    set(key: string, value: any, ttl?: number): Promise<"OK">;
    delete(key: string): Promise<number>;
    exists(key: string): Promise<boolean>;
    clear(): Promise<"OK">;
}
