import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '@ks-os/contracts';
import { ZodError } from 'zod';
import { CustomerPortalError } from '../modules/customer-portal/customer-portal.errors.js';

type PublicErrorContext = {
  method: string;
  statusCode: number;
  requestId: string;
};

function supportReference(requestId: string) {
  return `Reference: ${requestId}.`;
}

export function publicErrorMessage({ method, statusCode, requestId }: PublicErrorContext): string {
  const reference = supportReference(requestId);

  if (statusCode === 401) return 'Your session has ended. Sign in again.';
  if (statusCode === 403) return 'You do not have permission to do this. Ask a workspace owner for access.';
  if (statusCode === 404) return 'We could not find what you requested. Check the link or return to the previous page.';
  if (statusCode === 409) return 'This changed while you were working. Refresh the page and try again.';
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
  fastify.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request: FastifyRequest, reply: FastifyReply) => {
    // CustomerPortalError carries a domain-specific statusCode and stable code.
    // Log at warn level (not error) because these are expected client errors.
    if (error instanceof CustomerPortalError) {
      fastify.log.warn({ code: error.code, statusCode: error.statusCode }, 'Customer portal domain error');
      const response: ApiError = {
        error: { code: error.code, message: error.message, details: { requestId: request.id } },
      };
      reply.status(error.statusCode).send(response);
      return;
    }

    fastify.log.error({ err: error, requestId: request.id, correlationId: request.correlationId, route: request.routeOptions.url }, 'request failed');

    const isValidation = error instanceof ZodError;
    const statusCode = isValidation ? 400 : (error.statusCode || 500);
    const safeMessage = error.message || publicErrorMessage({ method: request.method, statusCode, requestId: request.id });

    // Never expose an unhandled server error message because it may contain database details or personal data.
    const publicMessage = statusCode >= 500
      ? publicErrorMessage({ method: request.method, statusCode, requestId: request.id })
      : safeMessage;

    const apiErrorResponse: ApiError = {
      error: {
        code: isValidation ? 'FORM_INVALID_SCHEMA' : (error.code || 'INTERNAL_SERVER_ERROR'),
        message: isValidation ? 'Check the information you entered and try again.' : publicMessage,
        details: { requestId: request.id },
      },
    };

    reply.status(statusCode).send(apiErrorResponse);
  });
}
