import { registerAs } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { config as envConfig } from 'dotenv-flow';

envConfig({ default_node_env: 'production' });
const {
  PROD_PORT,
  PROD_DB_NAME,
  PROD_DB_HOST,
  PROD_DB_PASSWORD,
  PROD_DB_USERNAME,
  PROD_DB_SSL,
} = process.env;

const isProduction = process.env.NODE_ENV !== 'development';

console.log({ isProduction });

export const config = {
  type: 'postgres',
  // url: process.env.DATABASE_URL,
  host: PROD_DB_HOST!,
  port: Number(PROD_PORT),
  username: PROD_DB_USERNAME!,
  password: PROD_DB_PASSWORD!,
  database: PROD_DB_NAME!,
  entities: ['dist/**/*.entity{.ts,.js}'],
  synchronize: isProduction ? false : true,
  migrations: ['dist/src/migrations/*{.ts,.js}'],
  ssl: isProduction ? { rejectUnauthorized: false } : false,

  extra: {
    sslmode: 'require',
  },
  // ssl: {
  //   rejectUnauthorized: false,
  // },
  schema: 'public',
} as DataSourceOptions;

export default registerAs('typeorm', () => config);
export const connectionSource = new DataSource(config);
