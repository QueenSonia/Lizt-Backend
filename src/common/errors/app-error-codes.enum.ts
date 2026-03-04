/**
 * General-purpose, machine-readable error codes.
 * Domain-specific modules (KYC, payments, etc.) keep their own enums;
 * this enum covers system-level and cross-cutting concerns.
 */
export enum AppErrorCode {
    // --- System ---
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    DATABASE_ERROR = 'DATABASE_ERROR',
    NETWORK_ERROR = 'NETWORK_ERROR',
    TIMEOUT = 'TIMEOUT',
    SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',

    // --- Auth ---
    UNAUTHORIZED = 'UNAUTHORIZED',
    FORBIDDEN = 'FORBIDDEN',
    SESSION_EXPIRED = 'SESSION_EXPIRED',

    // --- Validation ---
    VALIDATION_FAILED = 'VALIDATION_FAILED',
    NOT_FOUND = 'NOT_FOUND',
    DUPLICATE_ENTRY = 'DUPLICATE_ENTRY',
    INVALID_INPUT = 'INVALID_INPUT',

    // --- Rate limiting ---
    RATE_LIMITED = 'RATE_LIMITED',

    // --- External services ---
    EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
}

/** Default user-friendly messages per error code. */
export const APP_ERROR_MESSAGES: Record<AppErrorCode, string> = {
    [AppErrorCode.INTERNAL_ERROR]:
        'An unexpected error occurred. Please try again',
    [AppErrorCode.DATABASE_ERROR]: 'Database error occurred. Please try again',
    [AppErrorCode.NETWORK_ERROR]:
        'Network error. Please check your connection and try again',
    [AppErrorCode.TIMEOUT]: 'Request timed out. Please try again',
    [AppErrorCode.SERVICE_UNAVAILABLE]:
        'Service is temporarily unavailable. Please try again later',
    [AppErrorCode.UNAUTHORIZED]: 'Authentication required',
    [AppErrorCode.FORBIDDEN]:
        "You don't have permission to perform this action",
    [AppErrorCode.SESSION_EXPIRED]:
        'Your session has expired. Please sign in again',
    [AppErrorCode.VALIDATION_FAILED]:
        'Please check your input and try again',
    [AppErrorCode.NOT_FOUND]: 'The requested resource was not found',
    [AppErrorCode.DUPLICATE_ENTRY]: 'This entry already exists',
    [AppErrorCode.INVALID_INPUT]: 'Invalid input provided',
    [AppErrorCode.RATE_LIMITED]:
        'Too many requests. Please wait before trying again',
    [AppErrorCode.EXTERNAL_SERVICE_ERROR]:
        'An external service encountered an error. Please try again later',
};
