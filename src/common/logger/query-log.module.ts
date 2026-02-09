import { Global, Module, OnModuleInit, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { QueryLog, QueryType } from './query-log.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([QueryLog])],
  exports: [TypeOrmModule],
})
export class QueryLogModule implements OnModuleInit {
  private readonly logger = new Logger('QueryLog');
  private isLogging = false;
  private slowQueryThreshold = 100; // ms

  constructor(private dataSource: DataSource) {}

  onModuleInit() {
    this.setupQueryLogging();
  }

  private setupQueryLogging() {
    // Intercept createQueryRunner to wrap query execution
    const originalCreateQueryRunner = this.dataSource.createQueryRunner.bind(
      this.dataSource,
    );

    const saveLog = this.saveQueryLog.bind(this);

    this.dataSource.createQueryRunner = (
      mode?: 'master' | 'slave',
    ): QueryRunner => {
      const queryRunner = originalCreateQueryRunner(mode);

      // Wrap the query method on the query runner
      const originalQuery = queryRunner.query.bind(queryRunner);

      queryRunner.query = async (
        query: string,
        parameters?: any[],
        useStructuredResult?: boolean,
      ): Promise<any> => {
        const startTime = Date.now();
        try {
          const result = await originalQuery(
            query,
            parameters,
            useStructuredResult,
          );
          const duration = Date.now() - startTime;

          // Log asynchronously
          void saveLog(query, duration, parameters);

          return result;
        } catch (error) {
          const duration = Date.now() - startTime;
          void saveLog(query, duration, parameters, true);
          throw error;
        }
      };

      return queryRunner;
    };

    this.logger.log('✅ Query logging initialized');
  }

  private getQueryType(query: string): QueryType {
    const trimmed = query.trim().toUpperCase();
    if (trimmed.startsWith('SELECT')) return QueryType.SELECT;
    if (trimmed.startsWith('INSERT')) return QueryType.INSERT;
    if (trimmed.startsWith('UPDATE')) return QueryType.UPDATE;
    if (trimmed.startsWith('DELETE')) return QueryType.DELETE;
    return QueryType.OTHER;
  }

  private extractTableName(query: string): string | null {
    const patterns = [
      /FROM\s+["']?(\w+)["']?/i,
      /INTO\s+["']?(\w+)["']?/i,
      /UPDATE\s+["']?(\w+)["']?/i,
      /DELETE\s+FROM\s+["']?(\w+)["']?/i,
    ];

    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  private async saveQueryLog(
    query: string,
    durationMs: number,
    parameters?: any[],
    isError = false,
  ): Promise<void> {
    // Prevent recursive logging
    if (
      this.isLogging ||
      query.includes('query_logs') ||
      query.includes('api_logs')
    ) {
      return;
    }

    // Only log queries that take more than 10ms (skip trivial ones)
    if (durationMs < 10 && !isError) {
      return;
    }

    this.isLogging = true;

    try {
      const repo = this.dataSource.getRepository(QueryLog);
      const logEntry = new QueryLog();
      logEntry.query_type = this.getQueryType(query);
      logEntry.query = query.substring(0, 5000);
      logEntry.table_name = this.extractTableName(query) || '';
      logEntry.duration_ms = Math.round(durationMs);
      logEntry.parameters = parameters
        ? JSON.stringify(parameters).substring(0, 1000)
        : '';
      logEntry.is_slow = durationMs > this.slowQueryThreshold;
      await repo.save(logEntry);
    } catch (err) {
      this.logger.error(`Failed to save query log: ${err}`);
    } finally {
      this.isLogging = false;
    }
  }
}
