import { DataSource, DataSourceOptions } from 'typeorm';
import { config as envConfig } from 'dotenv-flow';
import { config as typeormConfig } from '../ormconfig';

envConfig({ default_node_env: 'production' });

const {
  PROD_PORT,
  PROD_DB_NAME,
  PROD_DB_HOST,
  PROD_DB_PASSWORD,
  PROD_DB_USERNAME,
} = process.env;

const isProduction = process.env.NODE_ENV === 'production';

// Build connection URL for Neon
const connectionUrl = `postgresql://${PROD_DB_USERNAME}:${PROD_DB_PASSWORD}@${PROD_DB_HOST}:${PROD_PORT}/${PROD_DB_NAME}?sslmode=require`;

// For CLI operations (migrations), use source files
const cliConfig: DataSourceOptions = {
  type: 'postgres',
  url: connectionUrl,
  entities: ['src/**/*.entity{.ts,.js}'], // Source files for CLI generation
  migrations: ['src/migrations/**/*.ts'],
  synchronize: false,
  ssl: { rejectUnauthorized: false },
  schema: 'public',
  // Minimal connection settings for migrations
  extra: {
    max: 1,
    connectionTimeoutMillis: 60000,
    statement_timeout: 60000,
    query_timeout: 60000,
  },
};

// Use CLI config for migrations, runtime config for app
export const AppDataSource = new DataSource(cliConfig);

// Initialize only once when needed
export async function ensureDbConnection() {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  return AppDataSource;
}
