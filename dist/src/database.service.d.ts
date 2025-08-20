import { OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
export declare class DatabaseService implements OnApplicationBootstrap {
    private readonly dataSource;
    private readonly configService;
    constructor(dataSource: DataSource, configService: ConfigService);
    onApplicationBootstrap(): Promise<void>;
}
