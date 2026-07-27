import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '@ks-os/contracts';
import { ZodError } from 'zod';
import { CustomerPortalError } from '../modules/customer-portal/customer-portal.errors.js';

export default function registerErrorHandler(fastify: FastifyInstance) {
  fastify.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request: FastifyRequest, reply: FastifyReply) => {
    // CustomerPortalError carries a domain-specific statusCode and stable code.
    if (error instanceof CustomerPortalError) {
      fastify.log.warn({ code: error.code, statusCode: error.statusCode }, 'Customer portal domain error');
      const response: ApiError = {
        error: { code: error.code, message: error.message, details: { requestId: request.id } },
      };
      reply.status(error.statusCode).send(response);
      return;
    }

    // Malformed JSON SyntaxError or Fastify body parser error handling
    if (error instanceof SyntaxError || error.code?.startsWith('FST_ERR_CTP_')) {
      const code = error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ? 'INVALID_REQUEST' : 'INVALID_REQUEST';
      const statusCode = error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ? 413 : (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ? 415 : 400);
      const message = error.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
        ? 'Request body exceeds maximum allowed size'
        : error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
          ? 'Unsupported content type. Only application/json is supported'
          : 'Malformed JSON or invalid request payload';

      reply.status(statusCode).send({
        error: { code, message }
      });
      return;
    }

    fastify.log.error({ err: error, requestId: request.id, correlationId: request.correlationId, route: request.routeOptions?.url }, 'request failed');

    const isValidation = error instanceof ZodError;
    const statusCode = isValidation ? 400 : (error.statusCode || 500);
    
    // Hide actual error message on 500 to prevent leaking internal DB schema or PII
    const safeMessage = statusCode >= 500 ? 'An unexpected internal error occurred.' : (error.message || 'An unexpected error occurred.');

    const apiErrorResponse: ApiError = {
      error: {
        code: isValidation ? 'INVALID_REQUEST' : (error.code || 'INTERNAL_SERVER_ERROR'),
        message: isValidation ? 'The request is invalid.' : safeMessage,
        details: { requestId: request.id }
      }
    };

    reply.status(statusCode).send(apiErrorResponse);
  });
}
