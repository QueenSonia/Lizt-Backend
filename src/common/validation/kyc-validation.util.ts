import { BadRequestException } from '@nestjs/common';
import { KYCException } from '../errors/kyc-exception';
import { KYCErrorCode } from '../errors/kyc-error-codes.enum';

/**
 * Enhanced validation utilities for KYC operations
 * Requirements: 7.4, 7.5
 */
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
  value?: any;
}

export class KYCValidationUtil {
  /**
   * Validate KYC token format
   */
  static validateToken(token: string): ValidationResult {
    const errors: ValidationError[] = [];

    if (!token || typeof token !== 'string') {
      errors.push({
        field: 'token',
        message: 'Token is required',
        code: 'REQUIRED',
      });
    } else {
      const trimmedToken = token.trim();

      if (trimmedToken === '') {
        errors.push({
          field: 'token',
          message: 'Token cannot be empty',
          code: 'EMPTY',
        });
      } else if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          trimmedToken,
        )
      ) {
        errors.push({
          field: 'token',
          message: 'Invalid token format',
          code: 'INVALID_FORMAT',
          value: trimmedToken,
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate phone number with enhanced checks
   */
  static validatePhoneNumber(phoneNumber: string): ValidationResult {
    const errors: ValidationError[] = [];

    if (!phoneNumber || typeof phoneNumber !== 'string') {
      errors.push({
        field: 'phoneNumber',
        message: 'Phone number is required',
        code: 'REQUIRED',
      });
      return { isValid: false, errors };
    }

    const trimmedPhone = phoneNumber.trim();

    if (trimmedPhone === '') {
      errors.push({
        field: 'phoneNumber',
        message: 'Phone number cannot be empty',
        code: 'EMPTY',
      });
      return { isValid: false, errors };
    }

    // Remove all non-digit characters for validation
    const digitsOnly = trimmedPhone.replace(/\D/g, '');

    // Check minimum length
    if (digitsOnly.length < 10) {
      errors.push({
        field: 'phoneNumber',
        message: 'Phone number must contain at least 10 digits',
        code: 'TOO_SHORT',
        value: trimmedPhone,
      });
    }

    // Check maximum length (E.164 standard)
    if (digitsOnly.length > 15) {
      errors.push({
        field: 'phoneNumber',
        message: 'Phone number is too long (maximum 15 digits)',
        code: 'TOO_LONG',
        value: trimmedPhone,
      });
    }

    // Check for valid international format patterns
    const validPatterns = [
      /^\+\d{1,3}\s?\d{3,14}$/, // International format with +
      /^\d{10,15}$/, // Digits only
      /^\d{3,4}[\s-]?\d{3,4}[\s-]?\d{3,4}$/, // Common formatting
    ];

    const hasValidPattern = validPatterns.some((pattern) =>
      pattern.test(trimmedPhone),
    );

    if (!hasValidPattern && errors.length === 0) {
      errors.push({
        field: 'phoneNumber',
        message: 'Invalid phone number format',
        code: 'INVALID_FORMAT',
        value: trimmedPhone,
      });
    }

    // Additional validation for Nigerian numbers (common use case)
    if (trimmedPhone.startsWith('+234') || trimmedPhone.startsWith('234')) {
      const nigerianNumber = trimmedPhone.replace(/^\+?234/, '');
      if (nigerianNumber.length !== 10) {
        errors.push({
          field: 'phoneNumber',
          message:
            'Invalid Nigerian phone number format (should be 10 digits after country code)',
          code: 'INVALID_NIGERIAN_FORMAT',
          value: trimmedPhone,
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate email address
   */
  static validateEmail(email: string): ValidationResult {
    const errors: ValidationError[] = [];

    if (!email || typeof email !== 'string') {
      errors.push({
        field: 'email',
        message: 'Email is required',
        code: 'REQUIRED',
      });
      return { isValid: false, errors };
    }

    const trimmedEmail = email.trim();

    if (trimmedEmail === '') {
      errors.push({
        field: 'email',
        message: 'Email cannot be empty',
        code: 'EMPTY',
      });
      return { isValid: false, errors };
    }

    // Enhanced email validation regex
    const emailRegex =
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

    if (!emailRegex.test(trimmedEmail)) {
      errors.push({
        field: 'email',
        message: 'Invalid email format',
        code: 'INVALID_FORMAT',
        value: trimmedEmail,
      });
    }

    // Check email length
    if (trimmedEmail.length > 254) {
      errors.push({
        field: 'email',
        message: 'Email is too long (maximum 254 characters)',
        code: 'TOO_LONG',
        value: trimmedEmail,
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate required string field
   */
  static validateRequiredString(
    value: any,
    fieldName: string,
    minLength: number = 1,
    maxLength: number = 255,
  ): ValidationResult {
    const errors: ValidationError[] = [];

    if (!value || typeof value !== 'string') {
      errors.push({
        field: fieldName,
        message: `${fieldName} is required`,
        code: 'REQUIRED',
      });
      return { isValid: false, errors };
    }

    const trimmedValue = value.trim();

    if (trimmedValue === '') {
      errors.push({
        field: fieldName,
        message: `${fieldName} cannot be empty`,
        code: 'EMPTY',
      });
      return { isValid: false, errors };
    }

    if (trimmedValue.length < minLength) {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be at least ${minLength} characters long`,
        code: 'TOO_SHORT',
        value: trimmedValue,
      });
    }

    if (trimmedValue.length > maxLength) {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be no more than ${maxLength} characters long`,
        code: 'TOO_LONG',
        value: trimmedValue,
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate date field
   */
  static validateDate(
    value: any,
    fieldName: string,
    required: boolean = true,
  ): ValidationResult {
    const errors: ValidationError[] = [];

    if (!value) {
      if (required) {
        errors.push({
          field: fieldName,
          message: `${fieldName} is required`,
          code: 'REQUIRED',
        });
      }
      return { isValid: !required, errors };
    }

    let date: Date;

    if (value instanceof Date) {
      date = value;
    } else if (typeof value === 'string') {
      date = new Date(value);
    } else {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be a valid date`,
        code: 'INVALID_TYPE',
        value,
      });
      return { isValid: false, errors };
    }

    if (isNaN(date.getTime())) {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be a valid date`,
        code: 'INVALID_DATE',
        value,
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate numeric field
   */
  static validateNumber(
    value: any,
    fieldName: string,
    required: boolean = true,
    min?: number,
    max?: number,
  ): ValidationResult {
    const errors: ValidationError[] = [];

    if (value === null || value === undefined || value === '') {
      if (required) {
        errors.push({
          field: fieldName,
          message: `${fieldName} is required`,
          code: 'REQUIRED',
        });
      }
      return { isValid: !required, errors };
    }

    const numValue = Number(value);

    if (isNaN(numValue)) {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be a valid number`,
        code: 'INVALID_NUMBER',
        value,
      });
      return { isValid: false, errors };
    }

    if (min !== undefined && numValue < min) {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be at least ${min}`,
        code: 'TOO_SMALL',
        value: numValue,
      });
    }

    if (max !== undefined && numValue > max) {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be no more than ${max}`,
        code: 'TOO_LARGE',
        value: numValue,
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate enum field
   */
  static validateEnum<T>(
    value: any,
    fieldName: string,
    enumObject: Record<string, T>,
    required: boolean = true,
  ): ValidationResult {
    const errors: ValidationError[] = [];

    if (!value) {
      if (required) {
        errors.push({
          field: fieldName,
          message: `${fieldName} is required`,
          code: 'REQUIRED',
        });
      }
      return { isValid: !required, errors };
    }

    const validValues = Object.values(enumObject);

    if (!validValues.includes(value)) {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be one of: ${validValues.join(', ')}`,
        code: 'INVALID_ENUM_VALUE',
        value,
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Combine multiple validation results
   */
  static combineValidationResults(
    ...results: ValidationResult[]
  ): ValidationResult {
    const allErrors = results.flatMap((result) => result.errors);

    return {
      isValid: allErrors.length === 0,
      errors: allErrors,
    };
  }

  /**
   * Throw KYC validation exception if validation fails
   */
  static throwIfInvalid(result: ValidationResult): void {
    if (!result.isValid) {
      throw KYCException.validationFailed(
        'Validation failed for one or more fields',
        result.errors,
      );
    }
  }
}
