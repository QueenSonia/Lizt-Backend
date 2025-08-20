"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectionSource = exports.config = void 0;
const config_1 = require("@nestjs/config");
const typeorm_1 = require("typeorm");
const dotenv_flow_1 = require("dotenv-flow");
(0, dotenv_flow_1.config)({ default_node_env: 'production' });
const { PROD_PORT, PROD_DB_NAME, PROD_DB_HOST, PROD_DB_PASSWORD, PROD_DB_USERNAME, PROD_DB_SSL, } = process.env;
const isProduction = process.env.NODE_ENV !== 'development';
console.log({ isProduction });
exports.config = {
    type: 'postgres',
    host: PROD_DB_HOST,
    port: Number(PROD_PORT),
    username: PROD_DB_USERNAME,
    password: PROD_DB_PASSWORD,
    database: PROD_DB_NAME,
    entities: ['dist/**/*.entity{.ts,.js}'],
    synchronize: isProduction ? false : true,
    migrations: ['dist/src/migrations/*{.ts,.js}'],
    ssl: isProduction ? { rejectUnauthorized: false } : false,
};
exports.default = (0, config_1.registerAs)('typeorm', () => exports.config);
exports.connectionSource = new typeorm_1.DataSource(exports.config);
//# sourceMappingURL=ormconfig.js.map