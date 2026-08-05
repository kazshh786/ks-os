import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FormDetailPage from './FormDetailPage.js';

const {
  getForm,
  listFormVersions,
  listFormAssignments,
  createFormAssignment,
  updateForm,
  publishForm,
} = vi.hoisted(() => ({
  getForm: vi.fn(),
  listFormVersions: vi.fn(),
  listFormAssignments: vi.fn(),
  createFormAssignment: vi.fn(),
  updateForm: vi.fn(),
  publishForm: vi.fn(),
}));

vi.mock('../data/data-provider.js', () => ({
  getDataProvider: () => ({
    getForm,
    listFormVersions,
    listFormAssignments,
    createFormAssignment,
    updateForm,
    publishForm,
  }),
}));

vi.mock('../auth/index.js', () => ({ useAuth: () => ({ role: 'owner' }) }));

const formId = '11111111-1111-4111-8111-111111111111';
const fieldId = '22222222-2222-4222-8222-222222222222';
const schema = {
  schemaVersion: 2,
  fields: [{
    id: fieldId,
    key: 'full_name',
    type: 'SHORT_TEXT',
    label: 'Full name',
    required: true,
    readOnly: false,
    hidden: false,
    width: '100',
    validation: {},
    sensitiveClassification: 'PERSONAL',
    translations: {},
    accessibility: {},
  }],
  pages: [],
  sections: [],
  logic: [],
  theme: {
    backgroundColor: '#f1f5f9',
    cardColor: '#ffffff',
    primaryColor: '#4f46e5',
    textColor: '#0f172a',
    mutedColor: '#0ea5e9',
    errorColor: '#b91c1c',
    radius: 'large',
    density: 'comfortable',
    progressStyle: 'BAR',
  },
  settings: {
    showIntroduction: true,
    showReview: true,
    completionMessage: 'Thank you.',
    autosave: true,
  },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/app/forms/${formId}`]}>
      <Routes>
        <Route path="/app/forms/:formId" element={<FormDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('consent form details', () => {
  beforeEach(() => {
    getForm.mockReset();
    listFormVersions.mockReset();
    listFormAssignments.mockReset();
    createFormAssignment.mockReset();
    updateForm.mockReset();
    publishForm.mockReset();

    getForm.mockResolvedValue({
      id: formId,
      title: 'Treatment consent',
      description: 'Complete before your appointment.',
      internalDescription: '',
      formType: 'CONSENT',
      acknowledgementText: 'I consent.',
      defaultLanguage: 'en-GB',
      supportedLanguages: ['en-GB'],
      draftRevision: 1,
      fieldsJson: schema,
    });
    listFormVersions.mockResolvedValue([]);
    listFormAssignments.mockResolvedValue([
      { id: 'a1', clientId: 'c1', clientName: 'Aisha Khan', status: 'SUBMITTED', createdAt: '2026-08-01T10:00:00.000Z', submittedAt: '2026-08-01T11:00:00.000Z', expiresAt: '2026-09-01T10:00:00.000Z' },
      { id: 'a2', clientId: 'c2', clientName: 'Bilal Shah', status: 'OPENED', createdAt: '2026-08-02T10:00:00.000Z', openedAt: '2026-08-02T11:00:00.000Z', expiresAt: '2026-09-02T10:00:00.000Z' },
      { id: 'a3', clientId: 'c3', clientName: 'Fatima Ali', status: 'PENDING', createdAt: '2026-08-03T10:00:00.000Z', expiresAt: '2026-09-03T10:00:00.000Z' },
    ]);
    updateForm.mockResolvedValue({
      id: formId,
      title: 'Treatment consent',
      description: 'Complete before your appointment.',
      acknowledgementText: 'I consent.',
      fieldsJson: schema,
      draftRevision: 2,
    });
    publishForm.mockResolvedValue({ id: 'version-2' });
  });

  it('shows completed and outstanding clients with a completion rate', async () => {
    renderPage();

    expect(await screen.findByText('Aisha Khan')).toBeInTheDocument();
    expect(screen.getByText('Bilal Shah')).toBeInTheDocument();
    expect(screen.getByText('Fatima Ali')).toBeInTheDocument();
    expect(screen.getByText('1', { selector: 'p.text-2xl' })).toBeInTheDocument();
    expect(screen.getByText('2', { selector: 'p.text-2xl' })).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument();
  });

  it('saves and publishes the configured success message and website URL', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Aisha Khan');
    const message = screen.getByLabelText('Success message');
    const website = screen.getByLabelText('Website clients return to');
    await user.clear(message);
    await user.type(message, 'Thank you. Return to our website to book your next visit.');
    await user.type(website, 'https://client.example.com');
    await user.click(screen.getByRole('button', { name: 'Save and publish success page' }));

    await waitFor(() => expect(updateForm).toHaveBeenCalledWith(formId, expect.objectContaining({
      schema: expect.objectContaining({
        settings: expect.objectContaining({
          completionMessage: 'Thank you. Return to our website to book your next visit.',
          completionRedirectUrl: 'https://client.example.com/',
        }),
      }),
    })));
    expect(publishForm).toHaveBeenCalledWith(formId);
    expect(await screen.findByText('Success page settings saved and published for new consent completions.')).toBeInTheDocument();
  });
});
