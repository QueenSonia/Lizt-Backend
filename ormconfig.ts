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

  // Connection pool settings optimized for Neon
  extra: {
    sslmode: 'require',
    max: Number(DB_MAX_CONNECTIONS) || 2, // Reduced for Neon's connection limits
    min: 0, // Allow pool to scale down to 0
    connectionTimeoutMillis: Number(DB_CONNECTION_TIMEOUT) || 20000,
    idleTimeoutMillis: Number(DB_IDLE_TIMEOUT) || 10000, // Shorter idle timeout
    acquireTimeoutMillis: 15000,
    createTimeoutMillis: 20000,
    destroyTimeoutMillis: 5000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 200,
    // Disable keep-alive for Neon compatibility
    keepAlive: false,
  },

  // Additional pool settings
  maxQueryExecutionTime: 30000, // 30 seconds

  // Retry logic for connection issues
  retryAttempts: 3,
  retryDelay: 1000,

  // ssl: {
  //   rejectUnauthorized: false,
  // },
  schema: 'public',

  // Cache schema metadata to avoid slow startup queries
  cache: {
    type: 'database',
    duration: 60000, // Cache for 60 seconds
  },
} as DataSourceOptions;

export default registerAs('typeorm', () => config);
// export const connectionSource = new DataSource(config);
