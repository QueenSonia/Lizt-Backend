"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppExceptionsFilter = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const typeorm_1 = require("typeorm");
let AppExceptionsFilter = class AppExceptionsFilter extends core_1.BaseExceptionFilter {
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        const isHttp = exception instanceof common_1.HttpException;
        const status = isHttp
            ? exception.getStatus()
            : common_1.HttpStatus.INTERNAL_SERVER_ERROR;
        let message = status === common_1.HttpStatus.TOO_MANY_REQUESTS
            ? 'Too many requests, try again later'
            : status === common_1.HttpStatus.REQUEST_TIMEOUT
                ? 'Request timed out. Try again'
                : 'Something unexpected happened';
        if (isHttp) {
            const data = exception.getResponse();
            if (typeof data === 'string') {
                message =
                    status === common_1.HttpStatus.TOO_MANY_REQUESTS
                        ? 'Too many requests, try again later'
                        : data;
            }
            if (typeof data === 'object' && data !== null && 'message' in data) {
                const errorMessage = data.message;
                if (typeof errorMessage === 'string')
                    message = errorMessage;
                if (Array.isArray(errorMessage)) {
                    if (errorMessage.every((item) => typeof item === 'string')) {
                        message = errorMessage.join(', ');
                    }
                    else if (errorMessage.every((item) => typeof item === 'object' &&
                        item !== null &&
                        'message' in item &&
                        typeof item.message === 'string')) {
                        message = errorMessage.map((item) => item.message).join(', ');
                    }
                    else {
                        message = 'An unknown error occurred';
                    }
                }
            }
        }
        if (exception instanceof typeorm_1.QueryFailedError) {
            const driverError = exception?.driverError;
            switch (driverError?.code) {
                case '23505':
                    message = 'Duplicate entry';
                    break;
                case '23503':
                    message = 'Invalid reference';
                    break;
                case '23502':
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
};
exports.AppExceptionsFilter = AppExceptionsFilter;
exports.AppExceptionsFilter = AppExceptionsFilter = __decorate([
    (0, common_1.Catch)()
], AppExceptionsFilter);
//# sourceMappingURL=app-exceptions-filter.js.map