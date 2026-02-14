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
    // INCREASED: 2 is too low for an app with background jobs + web requests
    max: Number(DB_MAX_CONNECTIONS) || 10,
    min: 1, // Keep at least 1 connection warm
    connectionTimeoutMillis: Number(DB_CONNECTION_TIMEOUT) || 10000, // Reduced from 20s
    idleTimeoutMillis: Number(DB_IDLE_TIMEOUT) || 10000,
    acquireTimeoutMillis: 10000, // Reduced from 15s
    createTimeoutMillis: 10000, // Reduced from 20s
    destroyTimeoutMillis: 5000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 200,
    // Statement timeout to prevent long-running queries from blocking
    statement_timeout: 30000, // 30s max for any query
    // Enable keep-alive so Neon's pooler doesn't drop idle connections
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000, // Send first keepalive after 10s idle
  },

  // Additional pool settings
  maxQueryExecutionTime: 10000, // Log slow queries after 10 seconds

  // Retry logic for connection issues
  retryAttempts: 5, // Increased from 3
  retryDelay: 500, // Reduced from 1000ms

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

// DataSource instance for TypeORM CLI (migrations)
export const connectionSource = new DataSource(config);
