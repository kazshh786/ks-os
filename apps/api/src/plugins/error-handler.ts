import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '@ks-os/contracts';
import { ZodError } from 'zod';
import { CustomerPortalError } from '../modules/customer-portal/customer-portal.errors.js';
import { PlatformErrorLogService } from '../modules/errors/platform-error-log.service.js';

type ErrorWithStatus = Error & { statusCode?: number; code?: string };

type PublicErrorContext = {
  method: string;
  statusCode: number;
  requestId: string;
};

type ApiErrorDetails = Record<string, unknown> & {
  requestId?: string;
  retryable?: boolean;
  statusCode?: number;
};

function supportReference(requestId: string) {
  return `Reference: ${requestId}.`;
}

function retryableForStatus(statusCode: number) {
  return statusCode === 409 || statusCode === 429 || statusCode >= 500;
}

function defaultCodeForStatus(statusCode: number) {
  if (statusCode === 400) return 'INVALID_REQUEST';
  if (statusCode === 401) return 'AUTH_REQUIRED';
  if (statusCode === 403) return 'ACCESS_DENIED';
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 409) return 'CONFLICT';
  if (statusCode === 413) return 'PAYLOAD_TOO_LARGE';
  if (statusCode === 422) return 'VALIDATION_FAILED';
  if (statusCode === 429) return 'RATE_LIMITED';
  if ([502, 503, 504].includes(statusCode)) return 'SERVICE_UNAVAILABLE';
  if (statusCode >= 500) return 'INTERNAL_SERVER_ERROR';
  return `HTTP_${statusCode}`;
}

function withErrorCode(message: string, code: string) {
  if (/\bError code:\s*[A-Z0-9_-]+\.?$/i.test(message)) return message;
  return `${message.replace(/\s+$/, '')} Error code: ${code}.`;
}

function validationReason(error: ZodError) {
  const first = error.issues[0];
  if (!first) return 'Check the information provided and try again.';
  const field = first.path.length ? first.path.join('.') : 'request';
  return `${field}: ${first.message}`;
}

function validationDetails(error: ZodError) {
  return error.issues.map(issue => ({
    field: issue.path.length ? issue.path.join('.') : 'request',
    message: issue.message,
    code: issue.code,
  }));
}

function objectDetails(value: unknown): ApiErrorDetails {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as ApiErrorDetails;
}

export function publicErrorMessage({ method, statusCode, requestId }: PublicErrorContext): string {
  const reference = supportReference(requestId);

  if (statusCode === 400 || statusCode === 422) return 'Check the information provided and try again.';
  if (statusCode === 401) return 'Your session has ended. Sign in again.';
  if (statusCode === 403) return 'You do not have permission to do this. Ask a workspace owner for access.';
  if (statusCode === 404) return 'We could not find what you requested. Check the link or return to the previous page.';
  if (statusCode === 409) return 'This changed while you were working. Refresh the page and try again.';
  if (statusCode === 413) return 'This file is too large. Choose a smaller file and try again.';
  if (statusCode === 429) return 'Too many requests were sent. Wait a moment and try again.';

  if ([502, 503, 504].includes(statusCode)) {
    return `This service is temporarily unavailable. Try again in a few minutes. ${reference}`;
  }

  if (statusCode >= 500) {
    switch (method.toUpperCase()) {
      case 'GET':
      case 'HEAD':
        return `We could not load this information. Refresh the page or try again. ${reference}`;
      case 'DELETE':
        return `We could not delete this item. Check that it still exists, then try again. ${reference}`;
      case 'PUT':
      case 'PATCH':
        return `We could not save your changes. Refresh the page, check the current details and try again. ${reference}`;
      case 'POST':
        return `We could not complete this action. Check the page before trying again. ${reference}`;
      default:
        return `We could not complete this request. Try again. ${reference}`;
    }
  }

  return 'Check the information provided and try again.';
}

export default function registerErrorHandler(fastify: FastifyInstance) {
  const errorLog = new PlatformErrorLogService();

  // Route-level handlers sometimes send their own error payloads instead of throwing.
  // Normalise those responses too so every API error includes a stable code, reason,
  // request reference and retry hint without forcing every route to duplicate boilerplate.
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode < 400 || typeof payload !== 'string') return payload;
    const contentType = String(reply.getHeader('content-type') || '');
    if (!contentType.includes('application/json')) return payload;

    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return payload;

      const existing = parsed.error && typeof parsed.error === 'object' && !Array.isArray(parsed.error)
        ? parsed.error as Record<string, unknown>
        : {};
      const code = typeof existing.code === 'string' && existing.code.trim()
        ? existing.code.trim()
        : typeof parsed.code === 'string' && parsed.code.trim()
          ? parsed.code.trim()
          : defaultCodeForStatus(reply.statusCode);
      const rawMessage = typeof existing.message === 'string' && existing.message.trim()
        ? existing.message.trim()
        : typeof parsed.message === 'string' && parsed.message.trim()
          ? parsed.message.trim()
          : publicErrorMessage({ method: request.method, statusCode: reply.statusCode, requestId: request.id });
      const message = withErrorCode(rawMessage, code);
      const details = {
        ...objectDetails(existing.details),
        requestId: request.id,
        retryable: retryableForStatus(reply.statusCode),
        statusCode: reply.statusCode,
      };

      return JSON.stringify({
        ...parsed,
        error: { ...existing, code, message, details },
      });
    } catch {
      return payload;
    }
  });

  fastify.setErrorHandler(async (error: ErrorWithStatus, request: FastifyRequest, reply: FastifyReply) => {
    const isValidation = error instanceof ZodError;
    const statusCode = isValidation ? 400 : (error.statusCode || 500);
    const errorCode = isValidation ? 'FORM_INVALID_SCHEMA' : (error.code || defaultCodeForStatus(statusCode));
    const retryable = retryableForStatus(statusCode);

    try {
      await errorLog.capture(request, error, statusCode, errorCode, retryable);
    } catch (captureError) {
      fastify.log.error(
        { err: captureError, requestId: request.id, correlationId: request.correlationId },
        'platform error evidence could not be persisted',
      );
    }

    // CustomerPortalError carries a domain-specific statusCode and stable code.
    // Log at warn level (not error) because these are expected client errors.
    if (error instanceof CustomerPortalError) {
      fastify.log.warn({ code: error.code, statusCode: error.statusCode }, 'Customer portal domain error');
      const response: ApiError = {
        error: {
          code: error.code,
          message: error.message,
          details: { requestId: request.id, retryable, statusCode: error.statusCode },
        },
      };
      reply.status(error.statusCode).send(response);
      return;
    }

    fastify.log.error(
      { err: error, requestId: request.id, correlationId: request.correlationId, route: request.routeOptions.url },
      'request failed',
    );

    const hasSafeDomainMessage = statusCode < 500 && Boolean(error.message?.trim());
    const message = isValidation
      ? validationReason(error as ZodError)
      : hasSafeDomainMessage
        ? error.message
        : publicErrorMessage({ method: request.method, statusCode, requestId: request.id });

    const apiErrorResponse: ApiError = {
      error: {
        code: errorCode,
        message,
        details: {
          requestId: request.id,
          retryable,
          statusCode,
          ...(isValidation ? { validationErrors: validationDetails(error as ZodError) } : {}),
        },
      },
    };

    return reply.status(statusCode).send(apiErrorResponse);
  });
}
