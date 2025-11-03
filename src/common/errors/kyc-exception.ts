import { HttpException, HttpStatus } from '@nestjs/common';
import { KYCErrorCode, KYC_ERROR_MESSAGES } from './kyc-error-codes.enum';

/**
 * Custom KYC exception class for standardized error handling
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */
export class KYCException extends HttpException {
  public readonly errorCode: KYCErrorCode;
  public readonly retryAfter?: number;
  public readonly details?: any;

  constructor(
    errorCode: KYCErrorCode,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
    customMessage?: string,
    retryAfter?: number,
    details?: any,
  ) {
    const message = customMessage || KYC_ERROR_MESSAGES[errorCode];

    super(
      {
        success: false,
        message,
        errorCode,
        statusCode,
        retryAfter,
        details,
      },
      statusCode,
    );

    this.errorCode = errorCode;
    this.retryAfter = retryAfter;
    this.details = details;
  }

  /**
   * Factory methods for common KYC errors
   */
  static invalidToken(customMessage?: string): KYCException {
    return new KYCException(
      KYCErrorCode.INVALID_TOKEN,
      HttpStatus.BAD_REQUEST,
      customMessage,
    );
  }

  static expiredToken(customMessage?: string): KYCException {
    return new KYCException(
      KYCErrorCode.EXPIRED_TOKEN,
      HttpStatus.GONE,
      customMessage,
    );
  }

  static tokenNotFound(customMessage?: string): KYCException {
    return new KYCException(
      KYCErrorCode.TOKEN_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      customMessage,
    );
  }

  static propertyOccupied(customMessage?: string): KYCException {
    return new KYCException(
      KYCErrorCode.PROPERTY_OCCUPIED,
      HttpStatus.CONFLICT,
      customMessage,
    );
  }

  static propertyNotFound(customMessage?: string): KYCException {
    return new KYCException(
      KYCErrorCode.PROPERTY_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      customMessage,
    );
  }

  static unauthorizedPropertyAccess(customMessage?: string): KYCException {
    return new KYCException(
      KYCErrorCode.UNAUTHORIZED_PROPERTY_ACCESS,
      HttpStatus.FORBIDDEN,
      customMessage,
    );
  }

  static duplicateApplication(customMessage?: string): KYCException {
    return new KYCException(
      KYCErrorCode.DUPLICATE_APPLICATION,
      HttpStatus.CONFLICT,
      customMessage,
    );
  }

  static validationFailed(customMessage?: string, details?: any): KYCException {
    return new KYCException(
      KYCErrorCode.VALIDATION_FAILED,
      HttpStatus.UNPROCESSABLE_ENTITY,
      customMessage,
      undefined,
      details,
    );
  }

  static whatsappRateLimited(
    retryAfter: number = 300,
    customMessage?: string,
  ): KYCException {
    return new KYCException(
      KYCErrorCode.WHATSAPP_RATE_LIMITED,
      HttpStatus.TOO_MANY_REQUESTS,
      customMessage,
      retryAfter,
    );
  }

  static whatsappInvalidPhone(customMessage?: string): KYCException {
    return new KYCException(
      KYCErrorCode.WHATSAPP_INVALID_PHONE,
      HttpStatus.BAD_REQUEST,
      customMessage,
    );
  }

  static whatsappServiceUnavailable(
    retryAfter: number = 60,
    customMessage?: string,
  ): KYCException {
    return new KYCException(
      KYCErrorCode.WHATSAPP_SERVICE_UNAVAILABLE,
      HttpStatus.SERVICE_UNAVAILABLE,
      customMessage,
      retryAfter,
    );
  }

  static databaseError(customMessage?: string, details?: any): KYCException {
    return new KYCException(
      KYCErrorCode.DATABASE_ERROR,
      HttpStatus.INTERNAL_SERVER_ERROR,
      customMessage,
      undefined,
      details,
    );
  }

  static internalServerError(
    customMessage?: string,
    details?: any,
  ): KYCException {
    return new KYCException(
      KYCErrorCode.INTERNAL_SERVER_ERROR,
      HttpStatus.INTERNAL_SERVER_ERROR,
      customMessage,
      undefined,
      details,
    );
  }

  static networkError(customMessage?: string): KYCException {
    return new KYCException(
      KYCErrorCode.NETWORK_ERROR,
      HttpStatus.BAD_GATEWAY,
      customMessage,
    );
  }

  static timeoutError(customMessage?: string): KYCException {
    return new KYCException(
      KYCErrorCode.TIMEOUT_ERROR,
      HttpStatus.REQUEST_TIMEOUT,
      customMessage,
    );
  }
}
