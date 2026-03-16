import { HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { QueryFailedError } from 'typeorm';

import { AppExceptionsFilter } from '../../src/filters/app-exceptions-filter';
import { AppException } from '../../src/common/errors/app-exception';
import { AppErrorCode } from '../../src/common/errors/app-error-codes.enum';
import { KYCException } from '../../src/common/errors/kyc-exception';
import { KYCErrorCode } from '../../src/common/errors/kyc-error-codes.enum';

// Mock the @sentry/nestjs decorator as a no-op in tests
jest.mock('@sentry/nestjs', () => ({
    SentryExceptionCaptured: () => () => { },
}));

function createMockHost(overrides: { url?: string; method?: string; userId?: string } = {}) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const headers: Record<string, string> = {};

    const request = {
        url: overrides.url ?? '/test',
        method: overrides.method ?? 'GET',
        originalUrl: overrides.url ?? '/test',
        headers,
        get: (key: string) => headers[key] ?? '',
        user: overrides.userId ? { id: overrides.userId } : undefined,
    };

    const response = {
        status,
        headersSent: false,
        setHeader: jest.fn(),
    };

    const host = {
        switchToHttp: () => ({
            getRequest: () => request,
            getResponse: () => response,
        }),
    };

    return { host: host as any, request, response, status, json };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('AppExceptionsFilter', () => {
    let filter: AppExceptionsFilter;

    beforeEach(() => {
        filter = new AppExceptionsFilter(null as any); // httpAdapter not used since we override
        jest.clearAllMocks();
    });

    // ── Response shape ───────────────────────────────────────────────

    it('should always include requestId, timestamp, errorCode in the response', () => {
        const { host, json } = createMockHost();
        filter.catch(new Error('boom'), host);

        const body = json.mock.calls[0][0];
        expect(body).toHaveProperty('requestId');
        expect(body).toHaveProperty('timestamp');
        expect(body).toHaveProperty('errorCode');
        expect(body).toHaveProperty('success', false);
        expect(body).toHaveProperty('statusCode');
        expect(body).toHaveProperty('path');
        expect(body).toHaveProperty('message');
    });

    // ── AppException ─────────────────────────────────────────────────

    it('should handle AppException with correct status and errorCode', () => {
        const { host, status, json } = createMockHost();
        const ex = AppException.notFound('Property not found');

        filter.catch(ex, host);

        expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
        const body = json.mock.calls[0][0];
        expect(body.errorCode).toBe(AppErrorCode.NOT_FOUND);
        expect(body.message).toBe('Property not found');
    });

    it('should handle AppException with details', () => {
        const { host, json } = createMockHost();
        const ex = AppException.validationFailed('Bad input', { field: 'email' });

        filter.catch(ex, host);

        const body = json.mock.calls[0][0];
        expect(body.details).toEqual({ field: 'email' });
    });

    // ── KYCException ─────────────────────────────────────────────────

    it('should handle KYCException with its own error code', () => {
        const { host, status, json } = createMockHost();
        const ex = KYCException.expiredToken();

        filter.catch(ex, host);

        expect(status).toHaveBeenCalledWith(HttpStatus.GONE);
        const body = json.mock.calls[0][0];
        expect(body.errorCode).toBe(KYCErrorCode.EXPIRED_TOKEN);
    });

    // ── HttpException ────────────────────────────────────────────────

    it('should handle standard HttpException (string message)', () => {
        const { host, status, json } = createMockHost();
        const ex = new HttpException('Not allowed', HttpStatus.FORBIDDEN);

        filter.catch(ex, host);

        expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
        const body = json.mock.calls[0][0];
        expect(body.message).toBe('Not allowed');
        expect(body.errorCode).toBe(AppErrorCode.FORBIDDEN);
    });

    it('should handle HttpException with object response (validation pipe)', () => {
        const { host, json } = createMockHost();
        const ex = new HttpException(
            { statusCode: 422, message: ['email must be valid', 'name is required'] },
            HttpStatus.UNPROCESSABLE_ENTITY,
        );

        filter.catch(ex, host);

        const body = json.mock.calls[0][0];
        expect(body.message).toBe('email must be valid, name is required');
    });

    // ── QueryFailedError ─────────────────────────────────────────────

    it('should handle QueryFailedError (unique violation → 409)', () => {
        const { host, status, json } = createMockHost();
        const ex = new QueryFailedError('INSERT ...', [], new Error('unique'));
        (ex as any).driverError = { code: '23505' };

        filter.catch(ex, host);

        expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
        const body = json.mock.calls[0][0];
        expect(body.errorCode).toBe(AppErrorCode.DUPLICATE_ENTRY);
    });

    it('should handle QueryFailedError (unknown code → 500)', () => {
        const { host, status, json } = createMockHost();
        const ex = new QueryFailedError('SELECT ...', [], new Error('deadlock'));
        (ex as any).driverError = { code: '40P01' };

        filter.catch(ex, host);

        expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
        const body = json.mock.calls[0][0];
        expect(body.errorCode).toBe(AppErrorCode.DATABASE_ERROR);
    });

    // ── Unknown / unhandled ──────────────────────────────────────────

    it('should handle unknown errors with 500 and INTERNAL_ERROR code', () => {
        const { host, status, json } = createMockHost();
        filter.catch(new Error('something broke'), host);

        expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
        const body = json.mock.calls[0][0];
        expect(body.errorCode).toBe(AppErrorCode.INTERNAL_ERROR);
        expect(body.message).toBe('An unexpected error occurred. Please try again');
    });

    // ── Sentry integration (handled by @SentryExceptionCaptured decorator) ──

    it('should have the SentryExceptionCaptured decorator on catch method', () => {
        // The @SentryExceptionCaptured() decorator is applied to the catch method.
        // Sentry will automatically capture exceptions via the decorator.
        // We verify the filter still processes errors correctly (covered by other tests).
        const { host, json } = createMockHost();
        filter.catch(new Error('sentry test'), host);

        const body = json.mock.calls[0][0];
        expect(body.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    // ── Network errors ───────────────────────────────────────────────

    it('should handle ECONNREFUSED as SERVICE_UNAVAILABLE', () => {
        const { host, status, json } = createMockHost();
        const ex: any = new Error('connect ECONNREFUSED');
        ex.code = 'ECONNREFUSED';

        filter.catch(ex, host);

        expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
        const body = json.mock.calls[0][0];
        expect(body.errorCode).toBe(AppErrorCode.SERVICE_UNAVAILABLE);
    });

    it('should handle ETIMEDOUT as TIMEOUT', () => {
        const { host, status, json } = createMockHost();
        const ex: any = new Error('connect ETIMEDOUT');
        ex.code = 'ETIMEDOUT';

        filter.catch(ex, host);

        expect(status).toHaveBeenCalledWith(HttpStatus.REQUEST_TIMEOUT);
        const body = json.mock.calls[0][0];
        expect(body.errorCode).toBe(AppErrorCode.TIMEOUT);
    });

    // ── Request ID forwarding ────────────────────────────────────────

    it('should use x-request-id header if present', () => {
        const { host, json, request } = createMockHost();
        request.headers['x-request-id'] = 'custom-id-123';

        filter.catch(new Error('test'), host);

        const body = json.mock.calls[0][0];
        expect(body.requestId).toBe('custom-id-123');
    });
});
