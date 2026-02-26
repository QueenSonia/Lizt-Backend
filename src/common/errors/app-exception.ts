import { HttpException, HttpStatus } from '@nestjs/common';
import { AppErrorCode, APP_ERROR_MESSAGES } from './app-error-codes.enum';

/**
 * Base exception class for the entire application.
 *
 * Usage:
 *   throw new AppException(AppErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND);
 *   throw AppException.notFound('Property not found');
 *
 * Every AppException carries a machine-readable `errorCode` so clients can
 * react programmatically, and an optional `details` bag for extra context.
 */
export class AppException extends HttpException {
    public readonly errorCode: string;
    public readonly details?: Record<string, any>;

    constructor(
        errorCode: AppErrorCode | string,
        httpStatus: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
        customMessage?: string,
        details?: Record<string, any>,
    ) {
        const message =
            customMessage ||
            (typeof errorCode === 'string' && errorCode in APP_ERROR_MESSAGES
                ? APP_ERROR_MESSAGES[errorCode as AppErrorCode]
                : 'An unexpected error occurred');

        super({ message, errorCode, details }, httpStatus);

        this.errorCode = errorCode;
        this.details = details;
    }

    // ───── Factory helpers for the most common cases ─────

    static internal(message?: string, details?: Record<string, any>) {
        return new AppException(
            AppErrorCode.INTERNAL_ERROR,
            HttpStatus.INTERNAL_SERVER_ERROR,
            message,
            details,
        );
    }

    static notFound(message?: string, details?: Record<string, any>) {
        return new AppException(
            AppErrorCode.NOT_FOUND,
            HttpStatus.NOT_FOUND,
            message,
            details,
        );
    }

    static forbidden(message?: string, details?: Record<string, any>) {
        return new AppException(
            AppErrorCode.FORBIDDEN,
            HttpStatus.FORBIDDEN,
            message,
            details,
        );
    }

    static unauthorized(message?: string, details?: Record<string, any>) {
        return new AppException(
            AppErrorCode.UNAUTHORIZED,
            HttpStatus.UNAUTHORIZED,
            message,
            details,
        );
    }

    static validationFailed(message?: string, details?: Record<string, any>) {
        return new AppException(
            AppErrorCode.VALIDATION_FAILED,
            HttpStatus.UNPROCESSABLE_ENTITY,
            message,
            details,
        );
    }

    static duplicate(message?: string, details?: Record<string, any>) {
        return new AppException(
            AppErrorCode.DUPLICATE_ENTRY,
            HttpStatus.CONFLICT,
            message,
            details,
        );
    }

    static rateLimited(message?: string, details?: Record<string, any>) {
        return new AppException(
            AppErrorCode.RATE_LIMITED,
            HttpStatus.TOO_MANY_REQUESTS,
            message,
            details,
        );
    }

    static databaseError(message?: string, details?: Record<string, any>) {
        return new AppException(
            AppErrorCode.DATABASE_ERROR,
            HttpStatus.INTERNAL_SERVER_ERROR,
            message,
            details,
        );
    }

    static externalServiceError(
        message?: string,
        details?: Record<string, any>,
    ) {
        return new AppException(
            AppErrorCode.EXTERNAL_SERVICE_ERROR,
            HttpStatus.BAD_GATEWAY,
            message,
            details,
        );
    }

    static timeout(message?: string, details?: Record<string, any>) {
        return new AppException(
            AppErrorCode.TIMEOUT,
            HttpStatus.REQUEST_TIMEOUT,
            message,
            details,
        );
    }
}
