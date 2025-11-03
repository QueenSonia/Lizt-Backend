import { Logger } from '@nestjs/common';
import { KYCException } from '../errors/kyc-exception';
import { KYCErrorCode } from '../errors/kyc-error-codes.enum';

/**
 * Retry utility for handling transient failures in KYC operations
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */
export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
  onRetry?: (attempt: number, error: any) => void;
}

export class RetryUtil {
  private static readonly logger = new Logger(RetryUtil.name);

  /**
   * Execute a function with retry logic for transient failures
   */
  static async withRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {},
  ): Promise<T> {
    const {
      maxAttempts = 3,
      baseDelay = 1000,
      maxDelay = 10000,
      backoffMultiplier = 2,
      retryableErrors = [
        'ECONNREFUSED',
        'ENOTFOUND',
        'ETIMEDOUT',
        'ECONNRESET',
        'EPIPE',
        'NETWORK_ERROR',
        'SERVICE_UNAVAILABLE',
        'TIMEOUT_ERROR',
      ],
      onRetry,
    } = options;

    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // Check if error is retryable
        if (!this.isRetryableError(error, retryableErrors)) {
          throw error;
        }

        // Don't retry on the last attempt
        if (attempt === maxAttempts) {
          break;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          baseDelay * Math.pow(backoffMultiplier, attempt - 1),
          maxDelay,
        );

        this.logger.warn(
          `Attempt ${attempt} failed, retrying in ${delay}ms: ${error.message}`,
        );

        // Call retry callback if provided
        if (onRetry) {
          onRetry(attempt, error);
        }

        // Wait before retrying
        await this.delay(delay);
      }
    }

    // All attempts failed, throw appropriate error
    throw this.createRetryFailedException(lastError, maxAttempts);
  }

  /**
   * Check if an error is retryable based on error codes and types
   */
  private static isRetryableError(
    error: any,
    retryableErrors: string[],
  ): boolean {
    // Check error code (for network errors)
    if (error.code && retryableErrors.includes(error.code)) {
      return true;
    }

    // Check KYC error codes
    if (error instanceof KYCException) {
      const retryableKYCErrors = [
        KYCErrorCode.NETWORK_ERROR,
        KYCErrorCode.SERVICE_UNAVAILABLE,
        KYCErrorCode.TIMEOUT_ERROR,
        KYCErrorCode.DATABASE_ERROR,
        KYCErrorCode.WHATSAPP_SERVICE_UNAVAILABLE,
      ];
      return retryableKYCErrors.includes(error.errorCode);
    }

    // Check HTTP status codes for retryable errors
    if (error.status || error.statusCode) {
      const status = error.status || error.statusCode;
      const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
      return retryableStatusCodes.includes(status);
    }

    // Check error message for retryable patterns
    if (error.message && typeof error.message === 'string') {
      const retryablePatterns = [
        'timeout',
        'connection',
        'network',
        'unavailable',
        'temporary',
        'rate limit',
      ];
      const message = error.message.toLowerCase();
      return retryablePatterns.some((pattern) => message.includes(pattern));
    }

    return false;
  }

  /**
   * Create appropriate exception when all retry attempts fail
   */
  private static createRetryFailedException(
    lastError: any,
    maxAttempts: number,
  ): KYCException {
    if (lastError instanceof KYCException) {
      return lastError;
    }

    // Determine appropriate error code based on the last error
    let errorCode: KYCErrorCode;
    let customMessage: string;

    if (this.isNetworkError(lastError)) {
      errorCode = KYCErrorCode.NETWORK_ERROR;
      customMessage = `Network operation failed after ${maxAttempts} attempts`;
    } else if (this.isTimeoutError(lastError)) {
      errorCode = KYCErrorCode.TIMEOUT_ERROR;
      customMessage = `Operation timed out after ${maxAttempts} attempts`;
    } else if (this.isServiceError(lastError)) {
      errorCode = KYCErrorCode.SERVICE_UNAVAILABLE;
      customMessage = `Service unavailable after ${maxAttempts} attempts`;
    } else {
      errorCode = KYCErrorCode.INTERNAL_SERVER_ERROR;
      customMessage = `Operation failed after ${maxAttempts} attempts: ${lastError.message || 'Unknown error'}`;
    }

    return new KYCException(errorCode, undefined, customMessage);
  }

  /**
   * Helper method to create a delay
   */
  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check if error is a network error
   */
  private static isNetworkError(error: any): boolean {
    return (
      error.code === 'ECONNREFUSED' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNRESET' ||
      error.code === 'EPIPE'
    );
  }

  /**
   * Check if error is a timeout error
   */
  private static isTimeoutError(error: any): boolean {
    return (
      error.code === 'ETIMEDOUT' ||
      (error.status && error.status === 408) ||
      (error.statusCode && error.statusCode === 408)
    );
  }

  /**
   * Check if error is a service error
   */
  private static isServiceError(error: any): boolean {
    const serviceErrorCodes = [500, 502, 503, 504];
    return (
      (error.status && serviceErrorCodes.includes(error.status)) ||
      (error.statusCode && serviceErrorCodes.includes(error.statusCode))
    );
  }
}

/**
 * Decorator for automatic retry on method calls
 */
export function Retry(options: RetryOptions = {}) {
  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor,
  ) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return RetryUtil.withRetry(() => method.apply(this, args), options);
    };
  };
}
