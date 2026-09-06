import { isSafeReadRetry, recoveryFor, type RecoveryAction } from '@ks-os/contracts';
import { diagnosticReference, newDiagnosticId, recordDiagnostic } from './store';

export interface ResponseEvidence { method: string; requestId?: string; correlationId: string; }
const evidence = new WeakMap<Response, ResponseEvidence>();
export class DiagnosticRequestError extends Error {
  readonly name = 'DiagnosticRequestError';
  constructor(message: string, readonly code: string, readonly status: number,
    readonly requestId: string | undefined, readonly correlationId: string | undefined,
    readonly recovery: RecoveryAction, readonly retryable: boolean) {
    // Some existing consumers match legacy domain-code messages exactly.
    const id = requestId || correlationId;
    super(id && !message.includes(id) && !/^[A-Z][A-Z0-9_]+$/.test(message) ? message + ' Reference: ' + id + '.' : message);
  }
}

export function responseError(response: Response, fallback: unknown = 'The request could not be completed.', body?: unknown): DiagnosticRequestError {
  const meta = evidence.get(response);
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const error = data.error && typeof data.error === 'object' ? data.error as Record<string, unknown> : {};
  const details = error.details && typeof error.details === 'object' ? error.details as Record<string, unknown> : {};
  const requestId = diagnosticReference(response.headers.get('x-request-id')) || diagnosticReference(details.requestId) || meta?.requestId;
  const correlationId = diagnosticReference(response.headers.get('x-correlation-id')) || meta?.correlationId;
  const method = meta?.method || 'POST';
  const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,120}$/.test(error.code) ? error.code : response.ok ? 'INVALID_RESPONSE' : 'HTTP_' + response.status;
  return new DiagnosticRequestError(typeof fallback === 'string' ? fallback : 'The request could not be completed.',
    code, response.status, requestId, correlationId, recoveryFor(method, response.status), isSafeReadRetry(method, response.status));
}

export function attachResponseEvidence(response: Response, meta: ResponseEvidence) { evidence.set(response, meta); }
/** Header timeout is configurable; cancellation continues to apply while reading the body. */
export async function tracedFetch(url: string, init: RequestInit, correlationId: string, timeoutMs = 120_000): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const controller = new AbortController();
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const start = performance.now();
  try {
    const response = await fetch(url, { ...init, signal });
    const requestId = diagnosticReference(response.headers.get('x-request-id'));
    attachResponseEvidence(response, { method, requestId, correlationId });
    recordDiagnostic({ kind: 'request', operation: method, outcome: response.ok ? 'succeeded' : 'failed',
      status: response.status, requestId, correlationId, durationMs: performance.now() - start });
    return response;
  } catch (cause) {
    const cancelled = init.signal?.aborted === true;
    recordDiagnostic({ kind: 'network', operation: method, outcome: cancelled ? 'cancelled' : 'failed',
      status: 0, correlationId, durationMs: performance.now() - start });
    if (cancelled) throw cause;
    throw new DiagnosticRequestError(
      timedOut ? 'The service took too long to respond. Check the current state before trying again.' : 'The service could not be reached. Check your connection and the current state.',
      timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_UNAVAILABLE', 0, undefined, correlationId,
      recoveryFor(method, 0), isSafeReadRetry(method, 0));
  } finally { clearTimeout(timer); }
}

export function createCorrelationId(headers?: HeadersInit): string {
  return diagnosticReference(new Headers(headers).get('x-correlation-id')) || newDiagnosticId();
}

/** Public API tracing intentionally carries no authentication or support-session data. */
export function fetchPublicApi(url: string, options: RequestInit = {}): Promise<Response> {
  const correlationId = createCorrelationId(options.headers);
  const headers = new Headers(options.headers);
  headers.set('X-Correlation-ID', correlationId);
  return tracedFetch(url, { ...options, headers }, correlationId);
}

/** Bounded JSON decoding for non-streaming API consumers. Never show a proxy's HTML. */
export async function readJsonResponse(response: Response, timeoutMs = 30_000): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw responseError(response, 'The service returned an empty response.');
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, timeoutMs);
    for (;;) {
      const chunk = await reader.read();
      if (timedOut) throw new Error('Response timeout');
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 8 * 1024 * 1024) throw new Error('Response limit');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch {
    const meta = evidence.get(response);
    recordDiagnostic({ kind: 'response', operation: meta?.method || 'browser', outcome: 'failed',
      status: response.status, requestId: meta?.requestId, correlationId: meta?.correlationId });
    throw responseError(response, 'The service returned an unreadable response. Check the current state before trying again.');
  } finally {
    if (timer) clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}
