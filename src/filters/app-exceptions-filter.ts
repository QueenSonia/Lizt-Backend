import {
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import { randomUUID } from 'crypto';

import { AppException } from '../common/errors/app-exception';
import { AppErrorCode } from '../common/errors/app-error-codes.enum';
import { KYCException } from '../common/errors/kyc-exception';

/**
 * Single, global exception filter.
 *
 * Responsibilities:
 *  1. Generate a requestId for every error (for log correlation).
 *  2. Classify the exception → extract errorCode, message, status.
 *  3. Log a structured JSON line with { requestId, userId, method, path, statusCode, errorCode, source }.
 *  4. Forward unhandled errors to Sentry via @SentryExceptionCaptured().
 *  5. Send a consistent JSON response to the client.
 */
@Catch()
export class AppExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(AppExceptionsFilter.name);

  @SentryExceptionCaptured()
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // ── 1. Request ID ──────────────────────────────────────────────
    const requestId =
      (request.headers['x-request-id'] as string) || randomUUID();

    // ── 2. Classify ────────────────────────────────────────────────
    const { status, message, errorCode, details, source } =
      this.classify(exception, request);

    // ── 3. Structured log ──────────────────────────────────────────
    const userId = (request as any).user?.id ?? null;

    const logPayload = {
      requestId,
      userId,
      method: request.method,
      path: request.url,
      statusCode: status,
      errorCode,
      source,
      stack: exception?.stack,
    };

    if (status >= 500) {
      this.logger.error(message, JSON.stringify(logPayload));
    } else {
      this.logger.warn(message, JSON.stringify(logPayload));
    }

    // ── 4. Response ────────────────────────────────────────────────
    const errorResponse = {
      success: false,
      message,
      errorCode,
      statusCode: status,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(details && { details }),
    };

    // Guard against double-write (headers already sent by streaming, SSE, etc.)
    if (!response.headersSent) {
      response.status(status).json(errorResponse);
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Classification helpers
  // ────────────────────────────────────────────────────────────────

  private classify(
    exception: any,
    request: Request,
  ): {
    status: number;
    message: string;
    errorCode: string;
    details?: Record<string, any>;
    source: string;
  } {
    // ── AppException (our base class) ──────────────────────────────
    if (exception instanceof AppException) {
      const exRes = exception.getResponse() as any;
      return {
        status: exception.getStatus(),
        message: exRes.message,
        errorCode: exception.errorCode,
        details: exception.details,
        source: 'AppException',
      };
    }

    // ── KYCException (domain-specific, also extends HttpException) ─
    if (exception instanceof KYCException) {
      const exRes = exception.getResponse() as any;
      return {
        status: exception.getStatus(),
        message: exRes.message,
        errorCode: exception.errorCode,
        details: exception.details,
        source: 'KYCException',
      };
    }

    // ── TypeORM QueryFailedError ───────────────────────────────────
    if (exception instanceof QueryFailedError) {
      return this.classifyDatabaseError(exception);
    }

    // ── Standard NestJS HttpException ──────────────────────────────
    if (exception instanceof HttpException) {
      return this.classifyHttpException(exception);
    }

    // ── Network / timeout errors ──────────────────────────────────
    if (this.isNetworkError(exception)) {
      return this.classifyNetworkError(exception);
    }

    // ── Unknown / unhandled ───────────────────────────────────────
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred. Please try again',
      errorCode: AppErrorCode.INTERNAL_ERROR,
      source: 'Unhandled',
    };
  }

  private classifyHttpException(exception: HttpException) {
    const status = exception.getStatus();
    const data = exception.getResponse();

    let message: string;

    if (typeof data === 'string') {
      message =
        status === HttpStatus.TOO_MANY_REQUESTS
          ? 'Too many requests, try again later'
          : data;
    } else if (
      typeof data === 'object' &&
      data !== null &&
      'message' in data
    ) {
      const errorMessage = (data as any).message;

      if (typeof errorMessage === 'string') {
        message = errorMessage;
      } else if (Array.isArray(errorMessage)) {
        // ValidationPipe returns string arrays
        message = errorMessage
          .map((item: any) =>
            typeof item === 'string' ? item : item?.message ?? '',
          )
          .join(', ');
      } else {
        message = 'An error occurred';
      }
    } else {
      message = 'An error occurred';
    }

    const errorCode = this.httpStatusToErrorCode(status);

    return { status, message, errorCode, source: 'HttpException' };
  }

  private classifyDatabaseError(exception: QueryFailedError) {
    const driverError = (exception as any)?.driverError;

    switch (driverError?.code) {
      case '23505': // unique violation
        return {
          status: HttpStatus.CONFLICT,
          message: 'Duplicate entry',
          errorCode: AppErrorCode.DUPLICATE_ENTRY,
          source: 'TypeORM',
        };
      case '23503': // foreign key violation
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Invalid reference',
          errorCode: AppErrorCode.INVALID_INPUT,
          source: 'TypeORM',
        };
      case '23502': // not null violation
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Missing required field',
          errorCode: AppErrorCode.VALIDATION_FAILED,
          source: 'TypeORM',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Database error',
          errorCode: AppErrorCode.DATABASE_ERROR,
          source: 'TypeORM',
        };
    }
  }

  private classifyNetworkError(exception: any) {
    if (
      exception.code === 'ECONNREFUSED' ||
      exception.code === 'ENOTFOUND'
    ) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Service connection failed. Please try again later',
        errorCode: AppErrorCode.SERVICE_UNAVAILABLE,
        source: 'Network',
      };
    }
    if (exception.code === 'ETIMEDOUT') {
      return {
        status: HttpStatus.REQUEST_TIMEOUT,
        message: 'Request timed out. Please try again',
        errorCode: AppErrorCode.TIMEOUT,
        source: 'Network',
      };
    }
    return {
      status: HttpStatus.BAD_GATEWAY,
      message: 'Network error occurred',
      errorCode: AppErrorCode.NETWORK_ERROR,
      source: 'Network',
    };
  }

  private isNetworkError(exception: any): boolean {
    return ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE'].includes(
      exception?.code,
    );
  }

  private httpStatusToErrorCode(status: number): string {
    switch (status) {
      case HttpStatus.NOT_FOUND:
        return AppErrorCode.NOT_FOUND;
      case HttpStatus.UNAUTHORIZED:
        return AppErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return AppErrorCode.FORBIDDEN;
      case HttpStatus.CONFLICT:
        return AppErrorCode.DUPLICATE_ENTRY;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return AppErrorCode.VALIDATION_FAILED;
      case HttpStatus.TOO_MANY_REQUESTS:
        return AppErrorCode.RATE_LIMITED;
      case HttpStatus.REQUEST_TIMEOUT:
        return AppErrorCode.TIMEOUT;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return AppErrorCode.SERVICE_UNAVAILABLE;
      case HttpStatus.BAD_GATEWAY:
        return AppErrorCode.NETWORK_ERROR;
      default:
        return status >= 500
          ? AppErrorCode.INTERNAL_ERROR
          : AppErrorCode.INVALID_INPUT;
    }
  }
}
