"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheService = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = __importDefault(require("ioredis"));
const date_fns_1 = require("date-fns");
const constants_1 = require("./constants");
let CacheService = class CacheService {
    cache;
    constructor(cache) {
        this.cache = cache;
    }
    stringifyIfNeeded(value) {
        if (value && (typeof value === 'object' || Array.isArray(value))) {
            return JSON.stringify(value);
        }
        return value;
    }
    parseIfNeeded(value) {
        try {
            return JSON.parse(value);
        }
        catch (e) {
            return value;
        }
    }
    async get(key) {
        const value = await this.cache.get(key);
        return value ? this.parseIfNeeded(value) : undefined;
    }
    async addToSet(key, value, ttl) {
        const pipeline = this.cache.pipeline();
        pipeline.sadd(key, this.stringifyIfNeeded(value));
        pipeline.expire(key, (0, date_fns_1.millisecondsToSeconds)(ttl || constants_1.DEFAULT_TTL));
        await pipeline.exec();
    }
    async removeFromSet(key, member) {
        return await this.cache.srem(key, member);
    }
    async getSetMembers(key) {
        const members = await this.cache.smembers(key);
        return members.map((member) => this.parseIfNeeded(member));
    }
    async isMember(key, member) {
        return (await this.cache.sismember(key, member)) === 1;
    }
    async set(key, value, ttl) {
        const stringifiedValue = this.stringifyIfNeeded(value);
        const ttlInSeconds = (0, date_fns_1.millisecondsToSeconds)(ttl ?? constants_1.DEFAULT_TTL);
        if (ttlInSeconds > 0) {
            return await this.cache.set(key, stringifiedValue, 'EX', ttlInSeconds);
        }
        else {
            return await this.cache.set(key, stringifiedValue);
        }
    }
    async delete(key) {
        return await this.cache.del(key);
    }
    async exists(key) {
        return (await this.cache.exists(key)) === 1;
    }
    async clear() {
        return await this.cache.flushdb();
    }
};
exports.CacheService = CacheService;
exports.CacheService = CacheService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(constants_1.REDIS_CLIENT)),
    __metadata("design:paramtypes", [ioredis_1.default])
], CacheService);
//# sourceMappingURL=cache.service.js.map