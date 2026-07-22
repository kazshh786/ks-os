import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '@ks-os/contracts';
import { ZodError } from 'zod';
import { CustomerPortalError } from '../modules/customer-portal/customer-portal.errors.js';

export default function registerErrorHandler(fastify: FastifyInstance) {
  fastify.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request: FastifyRequest, reply: FastifyReply) => {
    // CustomerPortalError carries a domain-specific statusCode and stable code.
    // Log at warn level (not error) because these are expected client errors.
    if (error instanceof CustomerPortalError) {
      fastify.log.warn({ code: error.code, statusCode: error.statusCode }, 'Customer portal domain error');
      const response: ApiError = {
        error: { code: error.code, message: error.message },
      };
      reply.status(error.statusCode).send(response);
      return;
    }

    fastify.log.error(error);

    const isValidation = error instanceof ZodError;
    const statusCode = isValidation ? 400 : (error.statusCode || 500);
    
    // Hide actual error message on 500 to prevent leaking internal DB schema or PII
    const safeMessage = statusCode >= 500 ? 'An unexpected internal error occurred.' : (error.message || 'An unexpected error occurred.');

    // Stable error contract format
    const apiErrorResponse: ApiError = {
      error: {
        code: isValidation ? 'FORM_INVALID_SCHEMA' : (error.code || 'INTERNAL_SERVER_ERROR'),
        message: isValidation ? 'The request is invalid.' : safeMessage
      }
    };

    reply.status(statusCode).send(apiErrorResponse);
  });
}
