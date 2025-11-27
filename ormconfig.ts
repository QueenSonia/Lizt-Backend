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
  DB_MAX_CONNECTIONS,
  DB_CONNECTION_TIMEOUT,
  DB_IDLE_TIMEOUT,
} = process.env;

const isProduction = process.env.NODE_ENV === 'production';

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
  synchronize: false, // Changed to false - use migrations instead
  migrations: ['dist/src/migrations/*{.ts,.js}'],
  ssl: { rejectUnauthorized: false },

  // Connection pool settings for Neon
  extra: {
    sslmode: 'require',
    max: Number(DB_MAX_CONNECTIONS) || 3, // Further reduced for Neon's connection limits
    connectionTimeoutMillis: Number(DB_CONNECTION_TIMEOUT) || 20000, // 20 seconds (increased)
    idleTimeoutMillis: Number(DB_IDLE_TIMEOUT) || 30000, // 30 seconds (increased)
    acquireTimeoutMillis: 20000, // 20 seconds (increased)
    keepAlive: true, // Keep connections alive
    keepAliveInitialDelayMillis: 10000,
  },

  // Additional pool settings
  maxQueryExecutionTime: 45000, // 45 seconds (increased)

  // Retry logic for connection issues
  retryAttempts: 5, // More retries
  retryDelay: 2000, // Faster retries

  // ssl: {
  //   rejectUnauthorized: false,
  // },
  schema: 'public',
} as DataSourceOptions;

export default registerAs('typeorm', () => config);
// export const connectionSource = new DataSource(config);
