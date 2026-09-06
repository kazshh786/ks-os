export type DiagnosticKind = 'request' | 'network' | 'runtime' | 'render' | 'asset' | 'response';
export interface DiagnosticEvent {
  id: string; at: string; kind: DiagnosticKind; operation: string;
  outcome: 'succeeded' | 'failed' | 'cancelled'; status?: number;
  durationMs?: number; requestId?: string; correlationId?: string;
  failureClass?: 'missing_value' | 'missing_symbol' | 'asset_unavailable' | 'network_unavailable' | 'unknown';
  sourceFrames?: string[];
}
let events: readonly DiagnosticEvent[] = [];
const listeners = new Set<() => void>();
function notify() { listeners.forEach(listener => { try { listener(); } catch { /* Evidence must not break the app. */ } }); }
export const getDiagnostics = () => events;
export const subscribeDiagnostics = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function clearDiagnostics() { events = []; notify(); }
export const newDiagnosticId = () => crypto.randomUUID();
export const diagnosticReference = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(value) ? value : undefined;

/** Structural evidence only: never retain payloads, URLs, raw exceptions, or headers. */
export function recordDiagnostic(input: Omit<DiagnosticEvent, 'id' | 'at'>): DiagnosticEvent {
  const event: DiagnosticEvent = {
    id: newDiagnosticId(), at: new Date().toISOString(), kind: input.kind,
    operation: /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(input.operation) ? input.operation : 'browser',
    outcome: input.outcome,
    status: Number.isInteger(input.status) && input.status! >= 0 && input.status! <= 599 ? input.status : undefined,
    durationMs: Number.isFinite(input.durationMs) ? Math.max(0, Math.round(input.durationMs!)) : undefined,
    requestId: diagnosticReference(input.requestId), correlationId: diagnosticReference(input.correlationId),
    failureClass: input.failureClass,
    sourceFrames: input.sourceFrames?.filter(frame => /^[A-Za-z0-9_./-]+\.(?:js|ts|tsx):\d+:\d+$/.test(frame)).slice(0, 5),
  };
  events = [...events, event].slice(-100);
  notify();
  return event;
}
export function exportDiagnostics() { return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), events }, null, 2); }
export function isDeploymentAssetError(message: string) {
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk [\w-]+ failed/i.test(message);
}

/** Keep code locations and a conservative classification, never arbitrary exception text. */
export function recordRuntimeDiagnostic(error: unknown, kind: 'runtime' | 'render' | 'asset' = 'runtime') {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const stack = error instanceof Error ? error.stack || '' : '';
  const failureClass = isDeploymentAssetError(message) ? 'asset_unavailable'
    : /cannot read propert|undefined is not an object|null is not an object/i.test(message) ? 'missing_value'
    : /is not defined/i.test(message) ? 'missing_symbol'
    : /failed to fetch|networkerror/i.test(message) ? 'network_unavailable' : 'unknown';
  const sourceFrames = stack.split('\n').slice(1, 12).flatMap(line => {
    const match = line.match(/\/(assets|src)\/([A-Za-z0-9_./-]+\.(?:js|tsx?)):(\d+):(\d+)/);
    return match ? [match[1] + '/' + match[2] + ':' + match[3] + ':' + match[4]] : [];
  });
  return recordDiagnostic({ kind, operation: 'browser', outcome: 'failed', failureClass, sourceFrames });
}
