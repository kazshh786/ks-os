import { EvidenceBudget } from '../modules/errors/evidence-budget.js';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isSafeReadRetry, recoveryFor, type ApiError } from '@ks-os/contracts';
import { ZodError } from 'zod';
import { CustomerPortalError } from '../modules/customer-portal/customer-portal.errors.js';
import { PlatformErrorLogService, redactErrorText, errorCauseChain, shouldPersistError } from '../modules/errors/platform-error-log.service.js';

type ErrorWithStatus = Error & { statusCode?: number; code?: string };

declare module 'fastify' {
  interface FastifyRequest { errorEvidenceRecorded?: boolean; }
}

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
  const evidenceBudget = new EvidenceBudget();
  fastify.decorateRequest('errorEvidenceRecorded', false);

  // Domain routes sometimes send a failure directly instead of throwing.
  // Preserve their response contract while capturing the same operational evidence.
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode < 400 || request.errorEvidenceRecorded || !shouldPersistError(request, reply.statusCode)) return payload;
    request.errorEvidenceRecorded = true;
    let code = `HTTP_RESPONSE_${reply.statusCode}`;
    let message = 'The route returned a failure response.';
    if (typeof payload === 'string' && payload.length <= 65_536) {
      try {
        const body = JSON.parse(payload);
        if (typeof body?.error?.code === 'string') code = body.error.code;
        if (typeof body?.error?.message === 'string') message = body.error.message;
      } catch { /* Do not store HTML or arbitrary response bodies. */ }
    }
    const error = new Error(message);
    error.name = 'HandledResponseError';
    error.stack = undefined; // The capture site is not the failure's source location.
    const evidenceStatus = await evidenceBudget.run(() => errorLog.capture(request, error, reply.statusCode, code, isSafeReadRetry(request.method, reply.statusCode)));
    if (evidenceStatus !== 'saved') request.log.error({
      event: 'ERROR_EVIDENCE_UNAVAILABLE', evidenceStatus, requestId: request.id,
      correlationId: request.correlationId || request.id, code: redactErrorText(code, 120),
      message: redactErrorText(message, 2_000), statusCode: reply.statusCode,
    }, 'platform error evidence could not be persisted');
    return payload;
  });

  fastify.setErrorHandler(async (error: ErrorWithStatus, request: FastifyRequest, reply: FastifyReply) => {
    request.errorEvidenceRecorded = true;
    const isValidation = error instanceof ZodError;
    const suppliedStatus = error.statusCode;
    const statusCode = isValidation ? 400 : (Number.isInteger(suppliedStatus) && suppliedStatus! >= 400 && suppliedStatus! <= 599 ? suppliedStatus! : 500);
    const errorCode = isValidation ? 'FORM_INVALID_SCHEMA' : (error.code || 'INTERNAL_SERVER_ERROR');
    const retryable = isSafeReadRetry(request.method, statusCode);
    const recovery = recoveryFor(request.method, statusCode);
    const correlationId = request.correlationId || request.id;

    const evidenceStatus = shouldPersistError(request, statusCode)
      ? await evidenceBudget.run(() => errorLog.capture(request, error, statusCode, errorCode, retryable))
      : 'excluded';
    if (evidenceStatus !== 'saved' && evidenceStatus !== 'excluded') {
      fastify.log.error({
        event: 'ERROR_EVIDENCE_UNAVAILABLE', evidenceStatus,
        requestId: request.id, correlationId, errorCode, statusCode,
        message: redactErrorText(error.message, 2_000), stack: redactErrorText(error.stack, 8_000),
        causes: errorCauseChain(error),
      }, 'platform error evidence could not be persisted');
    }

    // CustomerPortalError carries a domain-specific statusCode and stable code.
    // Log at warn level (not error) because these are expected client errors.
    if (error instanceof CustomerPortalError) {
      fastify.log.warn({ code: error.code, statusCode: error.statusCode }, 'Customer portal domain error');
      const response: ApiError = {
        error: {
          code: error.code,
          message: error.message,
          details: { requestId: request.id, correlationId, retryable, recovery, evidenceStatus },
        },
      };
      reply.status(error.statusCode).send(response);
      return;
    }

    fastify.log[statusCode >= 500 ? 'error' : 'warn'](
      { errorCode, message: redactErrorText(error.message, 2_000), stack: redactErrorText(error.stack, 8_000), requestId: request.id, correlationId, route: request.routeOptions.url },
      'request failed',
    );

    const hasSafeDomainMessage = statusCode < 500 && Boolean(error.message?.trim());
    const message = isValidation
      ? 'Check the highlighted fields and try again.'
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
          correlationId,
          recovery,
          evidenceStatus,
        },
      },
    };

    return reply.status(statusCode).send(apiErrorResponse);
  });
}
