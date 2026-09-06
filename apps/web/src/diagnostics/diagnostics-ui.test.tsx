import { StrictMode } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useStripeReaderAvailability } from './useStripeReaderAvailability';
import { ReaderDiagnostics } from './ReaderDiagnostics';
import { ApplicationErrorBoundary } from './ApplicationErrorBoundary';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { clearDiagnostics, getDiagnostics } from './store';

const { requestJson } = vi.hoisted(() => ({ requestJson: vi.fn() }));
vi.mock('../api/client', () => ({ requestJson }));
beforeEach(() => { vi.clearAllMocks(); clearDiagnostics(); });
const reader = { id: 'reader-1', online: true, supportsServerDriven: true };

it('reader lookup failure remains distinct from a confirmed empty list and can recover', async () => {
  requestJson.mockRejectedValueOnce(new Error('Reference: req-failed')).mockResolvedValueOnce({ data: [] });
  const { result } = renderHook(() => useStripeReaderAvailability('workspace-a'), { wrapper: StrictMode });
  await act(async () => { await result.current.load(); });
  expect(result.current.error).toContain('req-failed');
  expect(result.current.checkedAt).toBeNull();
  await act(async () => { await result.current.load(); });
  expect(result.current.error).toBe('');
  expect(result.current.checkedAt).not.toBeNull();
  expect(result.current.readers).toEqual([]);
});

it('a superseded response cannot overwrite the current lookup', async () => {
  let first!: (value: unknown) => void;
  requestJson.mockImplementationOnce(() => new Promise(resolve => { first = resolve; })).mockResolvedValueOnce({ data: [reader] });
  const { result } = renderHook(() => useStripeReaderAvailability('workspace-a'));
  let pending!: Promise<unknown>;
  act(() => { pending = result.current.load(); });
  await act(async () => { await result.current.load(); });
  await act(async () => { first({ data: [] }); await pending; });
  expect(result.current.readers).toEqual([reader]);
});

it('switching workspace clears previous reader evidence', async () => {
  requestJson.mockResolvedValue({ data: [reader] });
  const { result, rerender } = renderHook(({ scope }) => useStripeReaderAvailability(scope), { initialProps: { scope: 'a' } });
  await act(async () => { await result.current.load(); });
  rerender({ scope: 'b' });
  expect(result.current.readers).toEqual([]);
  expect(result.current.checkedAt).toBeNull();
});

it('the explanation shows an actual failure rather than claiming no readers exist', () => {
  render(<ReaderDiagnostics enabled loading={false} error="Reader service unavailable" checkedAt={null} total={0} usable={0} />);
  expect(screen.getByText('Availability could not be confirmed.')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Reader service unavailable');
});

it('render failure leaves a recoverable screen and a copyable report', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  function Broken(): never { throw Error('private customer data'); }
  try {
    render(<><DiagnosticsPanel /><ApplicationErrorBoundary><Broken /></ApplicationErrorBoundary></>);
    expect(screen.getByRole('heading', { name: 'This screen could not be displayed' })).toBeInTheDocument();
    expect(getDiagnostics().some(event => event.kind === 'render')).toBe(true);
    expect(JSON.stringify(getDiagnostics())).not.toContain('private customer data');
    fireEvent.click(screen.getByText('Diagnose this screen'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostic report' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe(''));
  } finally { consoleError.mockRestore(); }
});
