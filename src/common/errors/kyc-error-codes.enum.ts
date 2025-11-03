/**
 * Standardized KYC error codes for consistent error handling
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */
export enum KYCErrorCode {
  // Token validation errors
  INVALID_TOKEN = 'INVALID_TOKEN',
  EXPIRED_TOKEN = 'EXPIRED_TOKEN',
  TOKEN_NOT_FOUND = 'TOKEN_NOT_FOUND',
  TOKEN_DEACTIVATED = 'TOKEN_DEACTIVATED',

  // Property-related errors
  PROPERTY_NOT_FOUND = 'PROPERTY_NOT_FOUND',
  PROPERTY_OCCUPIED = 'PROPERTY_OCCUPIED',
  PROPERTY_UNAVAILABLE = 'PROPERTY_UNAVAILABLE',
  UNAUTHORIZED_PROPERTY_ACCESS = 'UNAUTHORIZED_PROPERTY_ACCESS',

  // Application submission errors
  DUPLICATE_APPLICATION = 'DUPLICATE_APPLICATION',
  INVALID_APPLICATION_DATA = 'INVALID_APPLICATION_DATA',
  APPLICATION_NOT_FOUND = 'APPLICATION_NOT_FOUND',
  APPLICATION_ALREADY_PROCESSED = 'APPLICATION_ALREADY_PROCESSED',

  // WhatsApp integration errors
  WHATSAPP_RATE_LIMITED = 'WHATSAPP_RATE_LIMITED',
  WHATSAPP_INVALID_PHONE = 'WHATSAPP_INVALID_PHONE',
  WHATSAPP_SERVICE_UNAVAILABLE = 'WHATSAPP_SERVICE_UNAVAILABLE',
  WHATSAPP_NETWORK_ERROR = 'WHATSAPP_NETWORK_ERROR',
  WHATSAPP_AUTH_ERROR = 'WHATSAPP_AUTH_ERROR',
  WHATSAPP_UNKNOWN_ERROR = 'WHATSAPP_UNKNOWN_ERROR',

  // Tenant attachment errors
  TENANT_ALREADY_ATTACHED = 'TENANT_ALREADY_ATTACHED',
  INVALID_TENANCY_DETAILS = 'INVALID_TENANCY_DETAILS',
  TENANCY_CREATION_FAILED = 'TENANCY_CREATION_FAILED',

  // Validation errors
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  MISSING_REQUIRED_FIELDS = 'MISSING_REQUIRED_FIELDS',
  INVALID_FIELD_FORMAT = 'INVALID_FIELD_FORMAT',

  // System errors
  DATABASE_ERROR = 'DATABASE_ERROR',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
}

/**
 * User-friendly error messages mapped to error codes
 */
export const KYC_ERROR_MESSAGES: Record<KYCErrorCode, string> = {
  // Token validation errors
  [KYCErrorCode.INVALID_TOKEN]: 'This KYC form link is invalid',
  [KYCErrorCode.EXPIRED_TOKEN]: 'This KYC form has expired',
  [KYCErrorCode.TOKEN_NOT_FOUND]: 'This KYC form is no longer available',
  [KYCErrorCode.TOKEN_DEACTIVATED]: 'This KYC form has been deactivated',

  // Property-related errors
  [KYCErrorCode.PROPERTY_NOT_FOUND]: 'Property not found',
  [KYCErrorCode.PROPERTY_OCCUPIED]:
    'Cannot generate link. Property already has an active tenant',
  [KYCErrorCode.PROPERTY_UNAVAILABLE]: 'This property is no longer available',
  [KYCErrorCode.UNAUTHORIZED_PROPERTY_ACCESS]:
    "You don't have permission to access this property",

  // Application submission errors
  [KYCErrorCode.DUPLICATE_APPLICATION]:
    'You have already submitted an application for this property',
  [KYCErrorCode.INVALID_APPLICATION_DATA]:
    'Please check your form data and try again',
  [KYCErrorCode.APPLICATION_NOT_FOUND]: 'KYC application not found',
  [KYCErrorCode.APPLICATION_ALREADY_PROCESSED]:
    'This application has already been processed',

  // WhatsApp integration errors
  [KYCErrorCode.WHATSAPP_RATE_LIMITED]:
    'Too many messages sent. Please wait before trying again',
  [KYCErrorCode.WHATSAPP_INVALID_PHONE]:
    'Enter a valid phone number to send via WhatsApp',
  [KYCErrorCode.WHATSAPP_SERVICE_UNAVAILABLE]:
    'WhatsApp service is temporarily unavailable. Please try again later',
  [KYCErrorCode.WHATSAPP_NETWORK_ERROR]:
    'Network error occurred. Please check your connection and try again',
  [KYCErrorCode.WHATSAPP_AUTH_ERROR]:
    'WhatsApp service authentication failed. Please contact support',
  [KYCErrorCode.WHATSAPP_UNKNOWN_ERROR]:
    'Failed to send link. Please try again or copy manually',

  // Tenant attachment errors
  [KYCErrorCode.TENANT_ALREADY_ATTACHED]:
    'This applicant has already been attached to a property',
  [KYCErrorCode.INVALID_TENANCY_DETAILS]:
    'Please check all required tenancy fields and try again',
  [KYCErrorCode.TENANCY_CREATION_FAILED]:
    'Failed to create tenancy. Please try again',

  // Validation errors
  [KYCErrorCode.VALIDATION_FAILED]:
    'Please check all required fields and try again',
  [KYCErrorCode.MISSING_REQUIRED_FIELDS]: 'Missing required fields',
  [KYCErrorCode.INVALID_FIELD_FORMAT]: 'Invalid field format provided',

  // System errors
  [KYCErrorCode.DATABASE_ERROR]: 'Database error occurred. Please try again',
  [KYCErrorCode.INTERNAL_SERVER_ERROR]:
    'An unexpected error occurred. Please try again',
  [KYCErrorCode.SERVICE_UNAVAILABLE]:
    'Service is temporarily unavailable. Please try again later',
  [KYCErrorCode.NETWORK_ERROR]:
    'Network error. Please check your connection and try again',
  [KYCErrorCode.TIMEOUT_ERROR]: 'Request timed out. Please try again',
};
