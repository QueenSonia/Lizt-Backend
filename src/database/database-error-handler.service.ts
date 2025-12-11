import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class DatabaseErrorHandlerService {
  private readonly logger = new Logger(DatabaseErrorHandlerService.name);

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (this.isConnectionError(error) && attempt < maxRetries) {
          this.logger.warn(
            `Database connection error on attempt ${attempt}/${maxRetries}. Retrying in ${delay}ms...`,
            error.message,
          );

          await this.sleep(delay);
          delay *= 1.5; // Exponential backoff
          continue;
        }

        throw error;
      }
    }

    // This should never be reached, but TypeScript needs it
    throw (
      lastError || new Error('Unknown error occurred during retry attempts')
    );
  }

  private isConnectionError(error: any): boolean {
    const connectionErrorCodes = [
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EPIPE',
    ];

    return connectionErrorCodes.some(
      (code) =>
        error.code === code ||
        error.message?.includes(code) ||
        error.message?.includes('Connection terminated') ||
        error.message?.includes('server closed the connection'),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
