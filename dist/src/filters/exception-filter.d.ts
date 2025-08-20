import { ArgumentsHost, ExceptionFilter, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
export declare class HttpExceptionFilter implements ExceptionFilter {
    reflector: Reflector;
    constructor(reflector: Reflector);
    catch(exception: HttpException, host: ArgumentsHost): void;
}
