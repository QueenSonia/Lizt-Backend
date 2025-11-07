import { DataSource, DataSourceOptions } from 'typeorm';
import { config as envConfig } from 'dotenv-flow';
import { config as typeormConfig } from '../ormconfig';

envConfig({ default_node_env: 'production' });

// const {
//   PROD_PORT,
//   PROD_DB_NAME,
//   PROD_DB_HOST,
//   PROD_DB_PASSWORD,
//   PROD_DB_USERNAME,
// } = process.env;

const isProduction = process.env.NODE_ENV === 'production';

// export default new DataSource({
//   type: 'postgres',
//   host: PROD_DB_HOST!,
//   port: Number(PROD_PORT),
//   username: PROD_DB_USERNAME!,
//   password: PROD_DB_PASSWORD!,
//   database: PROD_DB_NAME!,
//   entities: ['src/**/*.entity{.ts,.js}'], // Source files for CLI generation
//   migrations: ['src/migrations/**/*.ts'],
//   synchronize: false,
//   ssl: isProduction ? { rejectUnauthorized: false } : false,
//   extra: {
//     sslmode: 'require',
//   },
//   schema: 'public',
// } as DataSourceOptions);

export const AppDataSource = new DataSource(typeormConfig);

// Initialize only once when needed
export async function ensureDbConnection() {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  return AppDataSource;
}
