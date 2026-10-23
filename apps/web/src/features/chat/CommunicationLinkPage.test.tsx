import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import CommunicationLinkPage from './CommunicationLinkPage';

const mocks = vi.hoisted(() => ({ request: vi.fn(), select: vi.fn() }));
vi.mock('../../api/client', () => ({ requestJson: mocks.request }));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ isLoading: false, businessReference: 'business', memberships: [], selectWorkspace: mocks.select }) }));
const tenant = '11111111-1111-4111-8111-111111111111', conversation = '22222222-2222-4222-8222-222222222222';
const query = `?kind=CONVERSATION&tenantId=${tenant}&conversationId=${conversation}`;
function mount(search = query) { return render(<MemoryRouter initialEntries={['/open' + search]}><Routes><Route path="/open" element={<CommunicationLinkPage/>}/><Route path="/app/chat/:id" element={<h1>Authorised conversation</h1>}/></Routes></MemoryRouter>); }
describe('secure communication link fallback', () => {
  beforeEach(() => vi.clearAllMocks());
  it('checks the shared API before entering the destination', async () => {
    mocks.request.mockResolvedValue({ data: { webPath: '/app/chat/' + conversation } }); mount();
    await screen.findByRole('heading', { name: 'Authorised conversation' });
    expect(mocks.request).toHaveBeenCalledWith('/api/v1/communications/conversations/links/resolve', expect.objectContaining({ authContext: 'TENANT', method: 'POST' }));
  });
  it('shows recovery without accepting a provider URL as a route', async () => {
    mocks.request.mockResolvedValue({ data: { webPath: 'https://evil.example.test' } }); mount();
    await screen.findByRole('alert'); expect(screen.queryByText('Authorised conversation')).toBeNull();
  });
  it('does not query resources for malformed references', async () => {
    mount('?kind=CONVERSATION&tenantId=invalid'); await screen.findByRole('alert'); expect(mocks.request).not.toHaveBeenCalled();
  });
  it('clears a late resolution when the page is closed', async () => {
    let finish!: (value: unknown) => void; mocks.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = mount(); await waitFor(() => expect(mocks.request).toHaveBeenCalled()); view.unmount();
    expect(mocks.request.mock.calls[0][1].signal.aborted).toBe(true); finish({ data: { webPath: '/app/chat/' + conversation } });
  });
});
