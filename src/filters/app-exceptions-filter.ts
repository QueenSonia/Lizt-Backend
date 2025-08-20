import {
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

/** Catches and handles all exceptions thrown within the app, including validation errors and maintains consistency in the type of error message by ensuring all error messages, whether objects or arrays are transformed into a string type */
@Catch()
export class AppExceptionsFilter extends BaseExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;

    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let message =
      status === HttpStatus.TOO_MANY_REQUESTS
        ? 'Too many requests, try again later'
        : status === HttpStatus.REQUEST_TIMEOUT
          ? 'Request timed out. Try again'
          : 'Something unexpected happened'; // Just making a placeholder message first considering different exception status

    if (isHttp) {
      const data = exception.getResponse();

      if (typeof data === 'string') {
        message =
          status === HttpStatus.TOO_MANY_REQUESTS // Note to Ajiri: Throttling will be implemented so I'm taking account of such case with a more friendly message here
            ? 'Too many requests, try again later'
            : data;
      }

      if (typeof data === 'object' && data !== null && 'message' in data) {
        const errorMessage = data.message;

        if (typeof errorMessage === 'string') message = errorMessage;

        if (Array.isArray(errorMessage)) {
          if (errorMessage.every((item) => typeof item === 'string')) {
            message = errorMessage.join(', ');
          } else if (
            errorMessage.every(
              (item) =>
                typeof item === 'object' &&
                item !== null &&
                'message' in item &&
                typeof item.message === 'string',
            )
          ) {
            message = errorMessage.map((item) => item.message).join(', ');
          } else {
            message = 'An unknown error occurred';
          }
        }
      }
    }

    if (exception instanceof QueryFailedError) {
      const driverError = (exception as any)?.driverError;

      switch (driverError?.code) {
        case '23505': // unique violation. I'm handling this here just in case at any point we forget to check for existing document before inserting so as to get a more friendly error message
          message = 'Duplicate entry';
          break;
        case '23503': // foreign key violation
          message = 'Invalid reference';
          break;
        case '23502': // not null violation
          message = 'Missing required field';
          break;
        default:
          message = driverError?.message || 'Database error';
          break;
      }
    }

    const errorResponse = {
      success: false,
      message,
      statusCode: status,
      path: request.url,
    };

    response.status(status).json(errorResponse);

    super.catch(exception, host);
  }
}
