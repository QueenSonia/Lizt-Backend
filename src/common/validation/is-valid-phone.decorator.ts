import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { isValidPhone } from '../../utils/phone-number.transformer';

/**
 * Property decorator: validates that a value is a usable phone number in any
 * country. Replaces `@IsPhoneNumber('NG')`.
 *
 * It delegates to {@link isValidPhone} (libphonenumber-js, default region NG),
 * which accepts a locally-typed Nigerian number (`0803...`), an explicit
 * international number (`+44...`), AND the already-normalized digits-only form
 * (`447911123456`). The last case matters because `@NormalizePhoneNumber()`
 * runs before validation under the global ValidationPipe, so the value reaching
 * this validator may already be stripped of its `+`.
 */
export function IsValidPhoneNumber(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidPhoneNumber',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && isValidPhone(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid phone number (include the country code for non-Nigerian numbers, e.g. +44...)`;
        },
      },
    });
  };
}
