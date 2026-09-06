import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diagnoseResource, isSafeReadRetry, recoveryFor } from '@ks-os/contracts';
import { clearDiagnostics, exportDiagnostics, getDiagnostics, isDeploymentAssetError, recordDiagnostic } from './store';
import { attachResponseEvidence, readJsonResponse, responseError, tracedFetch } from './http';

beforeEach(clearDiagnostics);
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('recovery advice', () => {
  it('requires reconciliation for an uncertain write and never makes it retryable', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(recoveryFor(method, 503)).toBe('reconcile');
      expect(isSafeReadRetry(method, 503)).toBe(false);
    }
    expect(isSafeReadRetry('GET', 503)).toBe(true);
    expect(recoveryFor('POST', 409)).toBe('refresh');
  });
});

describe('state explanations', () => {
  const input = { enabled: true, loading: false, error: false, total: 0, usable: 0, checkedAt: '2026-09-06T00:00:00Z' };
  it('distinguishes confirmed empty results from failed and unknown lookups', () => {
    expect(diagnoseResource(input).state).toBe('empty');
    expect(diagnoseResource({ ...input, error: true }).state).toBe('failed');
    expect(diagnoseResource({ ...input, checkedAt: null }).state).toBe('unknown');
    expect(diagnoseResource({ ...input, total: 1 }).state).toBe('blocked');
    expect(diagnoseResource({ ...input, total: 1, usable: 1 }).state).toBe('ready');
    expect(diagnoseResource({ ...input, loading: true }).state).toBe('loading');
    expect(diagnoseResource({ ...input, stale: true }).state).toBe('stale');
  });
});

describe('browser evidence', () => {
  it('bounds retention and excludes unrecognised sensitive properties', () => {
    for (let i = 0; i < 105; i++) recordDiagnostic({ kind: 'request', operation: 'GET', outcome: 'failed',
      requestId: 'req-' + i, ...{ password: 'secret-value', url: '/clients/customer@example.com', body: { medical: 'private' } } });
    expect(getDiagnostics()).toHaveLength(100);
    expect(getDiagnostics()[0].requestId).toBe('req-5');
    expect(exportDiagnostics()).not.toMatch(/secret-value|customer@example|medical|private/);
  });
  it('does not classify ordinary network failure as a deployment error', () => {
    expect(isDeploymentAssetError('Failed to fetch')).toBe(false);
    expect(isDeploymentAssetError('Failed to fetch dynamically imported module: /assets/main.js')).toBe(true);
  });
  it('preserves request references and error codes without changing legacy domain messages', () => {
    const response = new Response('{}', { status: 409, headers: { 'x-request-id': 'req-42' } });
    attachResponseEvidence(response, { method: 'POST', correlationId: 'flow-42' });
    const error = responseError(response, 'SLOT_UNAVAILABLE', { error: { code: 'SLOT_UNAVAILABLE' } });
    expect(error.message).toBe('SLOT_UNAVAILABLE');
    expect(error.code).toBe('SLOT_UNAVAILABLE');
    expect(error.requestId).toBe('req-42');
    expect(error.correlationId).toBe('flow-42');
    expect(error.retryable).toBe(false);
  });
  it('records failed requests without consuming their response bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"code":"UNAVAILABLE"}}', { status: 503 })));
    const response = await tracedFetch('/api/v1/clients?secret=private', {}, 'flow-1');
    expect(await response.json()).toEqual({ error: { code: 'UNAVAILABLE' } });
    expect(getDiagnostics()[0]).toMatchObject({ kind: 'request', outcome: 'failed', correlationId: 'flow-1' });
    expect(exportDiagnostics()).not.toContain('private');
  });
  it('separates deliberate cancellation from a network outage', async () => {
    const controller = new AbortController(); controller.abort();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')));
    await expect(tracedFetch('/api/v1/clients', { signal: controller.signal }, 'flow-1')).rejects.toMatchObject({ name: 'AbortError' });
    expect(getDiagnostics()[0].outcome).toBe('cancelled');
  });
  it('times out a stalled request without retrying a write', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const request = tracedFetch('/api/v1/pos', { method: 'POST' }, 'flow-2', 10);
    const assertion = expect(request).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', retryable: false, recovery: 'reconcile' });
    await vi.advanceTimersByTimeAsync(11); await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects HTML success responses and keeps response failure evidence', async () => {
    await expect(readJsonResponse(new Response('<html>proxy fallback</html>'))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(getDiagnostics()[0].kind).toBe('response');
  });
});
