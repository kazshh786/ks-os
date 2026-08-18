import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import PublicFormCompletionPage, { PublicFormSuccessPage } from '../../pages/PublicFormCompletionPage.js';

const token = 'tokenvalue123456789012345678901234567890123';
const formData = {
  salon: { name: 'Test Salon', primaryColor: '#111111', secondaryColor: '#333333', accentColor: '#555555' },
  form: {
    title: 'Consultation',
    description: 'Before treatment',
    acknowledgementText: 'I confirm the details are accurate.',
    schema: {
      fields: [{ id: '11111111-1111-4111-8111-111111111111', type: 'SHORT_TEXT', label: 'Notes', required: true }],
      settings: { termsAndConditionsText: 'Treatment terms' },
    },
  },
  expiresAt: '2026-08-21T00:00:00Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function renderAssignedForm() {
  return render(
    <MemoryRouter initialEntries={[`/forms/complete/${token}`]}>
      <Routes>
        <Route path="/forms/complete/:token" element={<PublicFormCompletionPage />} />
        <Route path="/forms/complete/:token/success" element={<PublicFormSuccessPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

test('emailed assignments use the canonical consent design and their private form endpoint', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: formData }) });
  vi.stubGlobal('fetch', fetchMock);

  renderAssignedForm();

  expect(await screen.findByText('Secure digital consent')).toBeInTheDocument();
  expect(screen.getByText('Encrypted and private')).toBeInTheDocument();
  expect(screen.getByLabelText(/Notes/)).toBeInTheDocument();
  expect(screen.queryByText(/tenantId|clientId|assignmentId/)).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(`/api/v1/public/forms/${token}`);
  expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/workspace/'));
});

test('emailed assignments keep secure acknowledgement, terms and submission URLs', async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
    if (input.endsWith('/analytics')) return { ok: true, json: async () => ({}) };
    if (init?.method === 'POST') return { ok: true, json: async () => ({ data: { id: 'submission-id' } }) };
    return { ok: true, json: async () => ({ data: formData }) };
  });
  vi.stubGlobal('fetch', fetchMock);

  renderAssignedForm();
  await user.type(await screen.findByLabelText(/Notes/), 'No concerns');
  await user.click(screen.getByRole('button', { name: 'Review answers' }));

  expect(screen.getByRole('link', { name: /Consent acknowledgement/ })).toHaveAttribute('href', `/forms/complete/${token}/acknowledgement`);
  expect(screen.getByRole('link', { name: /Terms and conditions/ })).toHaveAttribute('href', `/forms/complete/${token}/terms`);

  await user.click(screen.getByRole('checkbox'));
  await user.type(screen.getByLabelText('Full legal name'), 'Test Customer');
  await user.click(screen.getByRole('button', { name: 'Submit consent form' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    `/api/v1/public/forms/${token}/submissions`,
    expect.objectContaining({ method: 'POST' }),
  ));
  expect(await screen.findByText('Form submitted')).toBeInTheDocument();
});

test('success state is explicit and safe', () => {
  render(<PublicFormSuccessPage />);
  expect(screen.getByText('Form submitted')).toBeInTheDocument();
});
