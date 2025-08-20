"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppCacheModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const ioredis_1 = __importDefault(require("ioredis"));
const constants_1 = require("./constants");
const cache_service_1 = require("./cache.service");
let AppCacheModule = class AppCacheModule {
};
exports.AppCacheModule = AppCacheModule;
exports.AppCacheModule = AppCacheModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [
            {
                provide: constants_1.REDIS_CLIENT,
                useFactory: async (config) => {
                    const logger = new common_1.Logger('RedisModule');
                    const redisUrl = config.get(constants_1.REDIS_CLOUD_URL);
                    const client = new ioredis_1.default(redisUrl, {
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
                    }
                    catch (e) {
                        logger.error('Redis connection failed', e.stack);
                        throw e;
                    }
                    return client;
                },
                inject: [config_1.ConfigService],
            },
            cache_service_1.CacheService,
        ],
        exports: [constants_1.REDIS_CLIENT, cache_service_1.CacheService],
    })
], AppCacheModule);
//# sourceMappingURL=cache.module.js.map