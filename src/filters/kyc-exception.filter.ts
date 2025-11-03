import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { KYCException } from '../common/errors/kyc-exception';
import { KYCErrorCode } from '../common/errors/kyc-error-codes.enum';

/**
 * Enhanced exception filter for KYC operations with comprehensive error handling
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */
@Catch()
export class KYCExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(KYCExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Log the error for debugging
    this.logger.error(
      `KYC Error: ${exception.message}`,
      exception.stack,
      `${request.method} ${request.url}`,
    );

    // Handle KYC-specific exceptions
    if (exception instanceof KYCException) {
      return this.handleKYCException(exception, response, request);
    }

    // Handle standard HTTP exceptions
    if (exception instanceof HttpException) {
      return this.handleHttpException(exception, response, request);
    }

    // Handle database errors
    if (exception instanceof QueryFailedError) {
      return this.handleDatabaseError(exception, response, request);
    }

    // Handle network and timeout errors
    if (this.isNetworkError(exception)) {
      return this.handleNetworkError(exception, response, request);
    }

    // Handle validation errors
    if (this.isValidationError(exception)) {
      return this.handleValidationError(exception, response, request);
    }

    // Handle unknown errors
    return this.handleUnknownError(exception, response, request);
  }

  private handleKYCException(
    exception: KYCException,
    response: Response,
    request: Request,
  ) {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse() as any;

    const errorResponse = {
      success: false,
      message: exceptionResponse.message,
      errorCode: exception.errorCode,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      ...(exception.retryAfter && { retryAfter: exception.retryAfter }),
      ...(exception.details && { details: exception.details }),
    };

    // Set retry-after header for rate limiting
    if (exception.retryAfter) {
      response.setHeader('Retry-After', exception.retryAfter.toString());
    }

    response.status(status).json(errorResponse);
  }

  private handleHttpException(
    exception: HttpException,
    response: Response,
    request: Request,
  ) {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    let message: string;
    let errorCode: KYCErrorCode;

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null
    ) {
      message = (exceptionResponse as any).message || 'An error occurred';
    } else {
      message = 'An error occurred';
    }

    // Map HTTP status codes to KYC error codes
    switch (status) {
      case HttpStatus.NOT_FOUND:
        errorCode = request.url.includes('/kyc/')
          ? KYCErrorCode.TOKEN_NOT_FOUND
          : KYCErrorCode.PROPERTY_NOT_FOUND;
        break;
      case HttpStatus.FORBIDDEN:
        errorCode = KYCErrorCode.UNAUTHORIZED_PROPERTY_ACCESS;
        break;
      case HttpStatus.CONFLICT:
        errorCode = message.toLowerCase().includes('duplicate')
          ? KYCErrorCode.DUPLICATE_APPLICATION
          : KYCErrorCode.PROPERTY_OCCUPIED;
        break;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        errorCode = KYCErrorCode.VALIDATION_FAILED;
        break;
      case HttpStatus.TOO_MANY_REQUESTS:
        errorCode = KYCErrorCode.WHATSAPP_RATE_LIMITED;
        break;
      case HttpStatus.SERVICE_UNAVAILABLE:
        errorCode = KYCErrorCode.SERVICE_UNAVAILABLE;
        break;
      case HttpStatus.REQUEST_TIMEOUT:
        errorCode = KYCErrorCode.TIMEOUT_ERROR;
        break;
      case HttpStatus.BAD_GATEWAY:
        errorCode = KYCErrorCode.NETWORK_ERROR;
        break;
      default:
        errorCode = KYCErrorCode.INTERNAL_SERVER_ERROR;
    }

    const errorResponse = {
      success: false,
      message,
      errorCode,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
    };

    response.status(status).json(errorResponse);
  }

  private handleDatabaseError(
    exception: QueryFailedError,
    response: Response,
    request: Request,
  ) {
    const driverError = (exception as any)?.driverError;
    let message: string;
    let errorCode: KYCErrorCode;
    let status: HttpStatus;

    switch (driverError?.code) {
      case '23505': // unique violation
        message = 'Duplicate entry detected';
        errorCode = KYCErrorCode.DUPLICATE_APPLICATION;
        status = HttpStatus.CONFLICT;
        break;
      case '23503': // foreign key violation
        message = 'Invalid reference provided';
        errorCode = KYCErrorCode.INVALID_APPLICATION_DATA;
        status = HttpStatus.BAD_REQUEST;
        break;
      case '23502': // not null violation
        message = 'Missing required field';
        errorCode = KYCErrorCode.MISSING_REQUIRED_FIELDS;
        status = HttpStatus.BAD_REQUEST;
        break;
      case '23514': // check constraint violation
        message = 'Invalid field value provided';
        errorCode = KYCErrorCode.INVALID_FIELD_FORMAT;
        status = HttpStatus.BAD_REQUEST;
        break;
      default:
        message = 'Database error occurred. Please try again';
        errorCode = KYCErrorCode.DATABASE_ERROR;
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        break;
    }

    const errorResponse = {
      success: false,
      message,
      errorCode,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
    };

    response.status(status).json(errorResponse);
  }

  private handleNetworkError(
    exception: any,
    response: Response,
    request: Request,
  ) {
    let message: string;
    let errorCode: KYCErrorCode;
    let status: HttpStatus;

    if (exception.code === 'ECONNREFUSED' || exception.code === 'ENOTFOUND') {
      message = 'Service connection failed. Please try again later';
      errorCode = KYCErrorCode.SERVICE_UNAVAILABLE;
      status = HttpStatus.SERVICE_UNAVAILABLE;
    } else if (exception.code === 'ETIMEDOUT') {
      message = 'Request timed out. Please try again';
      errorCode = KYCErrorCode.TIMEOUT_ERROR;
      status = HttpStatus.REQUEST_TIMEOUT;
    } else {
      message = 'Network error occurred. Please check your connection';
      errorCode = KYCErrorCode.NETWORK_ERROR;
      status = HttpStatus.BAD_GATEWAY;
    }

    const errorResponse = {
      success: false,
      message,
      errorCode,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      retryAfter: 30, // Suggest retry after 30 seconds
    };

    response.setHeader('Retry-After', '30');
    response.status(status).json(errorResponse);
  }

  private handleValidationError(
    exception: any,
    response: Response,
    request: Request,
  ) {
    let message: string;
    let details: any;

    if (Array.isArray(exception.message)) {
      message = 'Validation failed for multiple fields';
      details = exception.message;
    } else if (typeof exception.message === 'string') {
      message = exception.message;
    } else {
      message = 'Validation failed. Please check your input';
    }

    const errorResponse = {
      success: false,
      message,
      errorCode: KYCErrorCode.VALIDATION_FAILED,
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      ...(details && { details }),
    };

    response.status(HttpStatus.UNPROCESSABLE_ENTITY).json(errorResponse);
  }

  private handleUnknownError(
    exception: any,
    response: Response,
    request: Request,
  ) {
    // Log unknown errors for investigation
    this.logger.error(
      'Unknown error occurred in KYC operation',
      exception.stack || exception.message || exception,
      `${request.method} ${request.url}`,
    );

    const errorResponse = {
      success: false,
      message: 'An unexpected error occurred. Please try again',
      errorCode: KYCErrorCode.INTERNAL_SERVER_ERROR,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
    };

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(errorResponse);
  }

  private isNetworkError(exception: any): boolean {
    return (
      exception.code === 'ECONNREFUSED' ||
      exception.code === 'ENOTFOUND' ||
      exception.code === 'ETIMEDOUT' ||
      exception.code === 'ECONNRESET' ||
      exception.code === 'EPIPE'
    );
  }

  private isValidationError(exception: any): boolean {
    return (
      exception.name === 'ValidationError' ||
      (exception.message &&
        (exception.message.includes('validation') ||
          exception.message.includes('invalid') ||
          Array.isArray(exception.message)))
    );
  }
}
