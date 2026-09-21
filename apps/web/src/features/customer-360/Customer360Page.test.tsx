// @vitest-environment jsdom
import React from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { CustomerOverview } from '@ks-os/contracts';
import { Customer360View } from './Customer360Page';

const { fetchWithAuth } = vi.hoisted(() => ({ fetchWithAuth: vi.fn() }));
vi.mock('../../api/client', () => ({ fetchWithAuth, responseError: () => new Error('Request unavailable') }));
const reference = '11111111-1111-4111-8111-111111111111';
const created = '2026-09-01T10:00:00.000Z';
function fixture(): CustomerOverview {
  return { customer: { reference, name: 'Taylor Morgan', email: 'taylor@example.test', phone: null, since: created, terminology: 'Client', workLabel: 'Project', lifecycle: null, owner: null },
    sources: ['crm','tasks'], now: [], attention: [], summary: [], nowHasMore: false, diagnostics: [],
    actions: [{ key: 'ADD_TASK', label: 'Add task', kind: 'ADD_TASK', route: null, source: 'tasks', reference, reason: 'Create a linked task for Taylor Morgan.' }],
    timeline: { entries: [{ key: 'crm:created', reference, source: 'crm', type: 'CUSTOMER_CREATED', title: 'Customer relationship started', occurredAt: created, important: true, route: null }], nextCursor: null, diagnostics: [] } };
}
function respond(data: unknown) { return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })); }
function mount() { return render(<MemoryRouter><Customer360View reference={reference} /></MemoryRouter>); }
beforeEach(() => { fetchWithAuth.mockReset(); });
afterEach(cleanup);
describe('Customer 360', () => {
  it('shows an intentional empty state and only server-authorized actions', async () => {
    fetchWithAuth.mockImplementation(() => respond(fixture())); mount();
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Loading customer');
    await screen.findByRole('heading', { name: 'Taylor Morgan' });
    expect(screen.getByText('Nothing is active for this customer yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Take payment' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Needs attention' })).toBeNull();
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(fetchWithAuth.mock.calls[0][0]).not.toContain('tenant');
  });
  it('supports keyboard creation with focus restoration and no browser-supplied client or tenant IDs', async () => {
    fetchWithAuth.mockImplementation((_url:string,options?:RequestInit) => options?.method === 'POST' ? respond({ route: null }) : respond(fixture()));
    const user = userEvent.setup(); mount(); const trigger = await screen.findByRole('button', { name: 'Add task' });
    trigger.focus(); await user.keyboard('{Enter}');
    const input = screen.getByRole('textbox', { name: 'Title' }); expect(document.activeElement).toBe(input);
    await user.type(input, 'Follow up the proposal');
    fireEvent.submit(input.closest('form')!);
    await screen.findByText('Created and linked to this customer.');
    const post = fetchWithAuth.mock.calls.find(call => call[1]?.method === 'POST');
    expect(JSON.parse(post![1].body)).toEqual({ kind: 'ADD_TASK', title: 'Follow up the proposal' });
    expect(document.activeElement).toBe(trigger);
  });
  it('filters history on the server and uses semantic date groups', async () => {
    const data=fixture(); fetchWithAuth.mockImplementation((url:string) => respond(url.includes('/timeline') ? { entries: [], nextCursor: null, diagnostics: [] } : data));
    mount(); await screen.findByText('Customer relationship started');
    expect(screen.getByRole('region', { name: '1 Sept 2026' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Show' }), { target: { value: 'tasks' } });
    await screen.findByText('No activity matches these filters.');
    expect(fetchWithAuth.mock.calls.at(-1)![0]).toContain('source=tasks');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Important only' }));
    await waitFor(() => expect(fetchWithAuth.mock.calls.at(-1)![0]).toContain('importantOnly=true'));
  });
  it('keeps optional failures distinct from an empty relationship and exposes bounded support details',async()=>{
    const data=fixture(); data.diagnostics=[{source:'tasks',code:'CUSTOMER_SOURCE_UNAVAILABLE',message:'Try again',requestId:'request-123'}];
    fetchWithAuth.mockImplementation(()=>respond(data)); mount(); await screen.findByRole('heading',{name:'Taylor Morgan'});
    expect(screen.queryByText('Nothing is active for this customer yet.')).toBeNull();
    expect(screen.getByText('No active items in the available information.')).toBeTruthy();
    expect(screen.getByText('Request: request-123')).toBeTruthy();
  });
  it('preserves the cursor when an optional source fails on a later page',async()=>{
    const data=fixture(); data.timeline.nextCursor='cursor';
    fetchWithAuth.mockImplementation((url:string)=>respond(url.includes('/timeline') ? {entries:[],nextCursor:null,diagnostics:[{source:'tasks',code:'CUSTOMER_SOURCE_UNAVAILABLE',message:'Unavailable',requestId:'r'}]} : data));
    mount(); await screen.findByText('Customer relationship started'); fireEvent.click(screen.getByRole('button',{name:'Load earlier activity'}));
    await screen.findByText('Some history is unavailable. Retry loading more.');
    expect(screen.getByText('Customer relationship started')).toBeTruthy();
    expect(screen.getByRole('button',{name:'Load earlier activity'})).toBeTruthy();
  });
  it('orders mobile and desktop content as identity, Now, attention, summary, timeline',async()=>{
    const data=fixture(); data.attention=[{key:'task:overdue',code:'TASK_OVERDUE',severity:'IMPORTANT',title:'Follow up',reason:'The due date has passed.',source:'tasks',reference,dueAt:created,action:null}];
    fetchWithAuth.mockImplementation(()=>respond(data)); mount(); await screen.findByRole('heading',{name:'Taylor Morgan'});
    const headings=screen.getAllByRole('heading').map(element=>element.textContent);
    expect(headings.indexOf('Taylor Morgan')).toBeLessThan(headings.indexOf('Now'));
    expect(headings.indexOf('Now')).toBeLessThan(headings.indexOf('Needs attention'));
    expect(headings.indexOf('Needs attention')).toBeLessThan(headings.indexOf('The story so far'));
  });
});
