import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FormEditorPage from './FormEditorPage.js';

const {
  getForm,
  createForm,
  updateForm,
  publishForm,
  fetchWithAuth,
} = vi.hoisted(() => ({
  getForm: vi.fn(),
  createForm: vi.fn(),
  updateForm: vi.fn(),
  publishForm: vi.fn(),
  fetchWithAuth: vi.fn(),
}));

vi.mock('../data/data-provider.js', () => ({
  getDataProvider: () => ({ getForm, createForm, updateForm, publishForm }),
}));

vi.mock('../api/client.js', () => ({ fetchWithAuth }));

vi.mock('../context/WorkspaceContext.js', () => ({
  useWorkspace: () => ({
    activeTenant: {
      id: 'tenant-1',
      name: 'Test salon',
      subdomain: 'test-salon',
    },
  }),
}));

Object.defineProperty(Element.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
});

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
    mutedColor: '#64748b',
    errorColor: '#b91c1c',
    radius: 'large',
    density: 'comfortable',
    progressStyle: 'BAR',
  },
  settings: {
    showIntroduction: true,
    showReview: true,
    termsAndConditionsText: '',
    completionMessage: 'Thank you.',
    autosave: true,
  },
};

const incompleteConsentSchema = {
  ...schema,
  fields: [{
    ...schema.fields[0],
    key: 'treatment_consent',
    type: 'CONSENT_CHECKBOX',
    label: 'Treatment consent',
    description: undefined,
    sensitiveClassification: 'CONSENT',
  }],
};

function apiResponse(status = 'DRAFT') {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      data: {
        formId,
        publicSlug: 'consultation-consent',
        workspaceSlug: 'test-salon',
        path: '/form/consultation-consent',
        status,
      },
    }),
  };
}

function renderExistingForm() {
  return render(
    <MemoryRouter initialEntries={[`/app/forms/${formId}/edit`]}>
      <Routes>
        <Route path="/app/forms/:formId/edit" element={<FormEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('visual consent form builder', () => {
  beforeEach(() => {
    getForm.mockReset();
    createForm.mockReset();
    updateForm.mockReset();
    publishForm.mockReset();
    fetchWithAuth.mockReset();
    getForm.mockResolvedValue({
      id: formId,
      title: 'Consultation consent',
      description: 'Please complete this before your appointment.',
      acknowledgementText: 'I confirm that this information is accurate.',
      fieldsJson: schema,
      draftRevision: 1,
      status: 'DRAFT',
    });
    updateForm.mockResolvedValue({ id: formId, draftRevision: 2 });
    publishForm.mockResolvedValue({ id: 'version-1' });
    fetchWithAuth.mockResolvedValue(apiResponse());
  });

  it('renders the customer controls directly on the canvas without a preview interaction', async () => {
    const user = userEvent.setup();
    renderExistingForm();

    expect(await screen.findByLabelText('Full name')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Preview/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Email.*Validated email address/i }));

    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByText('2 fields')).toBeInTheDocument();
  });

  it('saves the selected primary and accent colours with the form', async () => {
    const user = userEvent.setup();
    renderExistingForm();

    await screen.findByLabelText('Full name');
    fireEvent.change(screen.getByLabelText('Primary colour'), { target: { value: '#112233' } });
    fireEvent.change(screen.getByLabelText('Accent colour'), { target: { value: '#445566' } });
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(updateForm).toHaveBeenCalledWith(formId, expect.objectContaining({
      schema: expect.objectContaining({
        theme: expect.objectContaining({
          primaryColor: '#112233',
          mutedColor: '#445566',
        }),
      }),
    })));
  });

  it('saves dedicated terms and acknowledgement page content', async () => {
  const user = userEvent.setup();
  renderExistingForm();

  await screen.findByLabelText('Full name');
  await user.type(screen.getByLabelText('Terms and conditions page content'), 'Appointments must be cancelled with 24 hours notice.');
  await user.clear(screen.getByLabelText('Consent acknowledgement page content'));
  await user.type(screen.getByLabelText('Consent acknowledgement page content'), 'I confirm that I understand and accept the information provided.');
  await user.click(screen.getByRole('button', { name: 'Save draft' }));

  await waitFor(() => expect(updateForm).toHaveBeenCalledWith(formId, expect.objectContaining({
    acknowledgementText: 'I confirm that I understand and accept the information provided.',
    schema: expect.objectContaining({
      settings: expect.objectContaining({
        termsAndConditionsText: 'Appointments must be cancelled with 24 hours notice.',
      }),
    }),
  })));
});

  it('saves an incomplete consent form as a draft', async () => {
    getForm.mockResolvedValue({
      id: formId,
      title: 'Treatment consent',
      description: '',
      acknowledgementText: '',
      fieldsJson: incompleteConsentSchema,
      draftRevision: 1,
      status: 'DRAFT',
    });
    const user = userEvent.setup();
    renderExistingForm();

    await screen.findByText('Treatment consent');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(updateForm).toHaveBeenCalledWith(formId, expect.objectContaining({
      acknowledgementText: '',
      schema: expect.objectContaining({
        fields: expect.arrayContaining([expect.objectContaining({ type: 'CONSENT_CHECKBOX', description: undefined })]),
      }),
    })));
    expect(await screen.findByText('Draft saved')).toBeInTheDocument();
    expect(publishForm).not.toHaveBeenCalled();
  });

  it('saves first and shows exact publish blockers instead of losing incomplete work', async () => {
    getForm.mockResolvedValue({
      id: formId,
      title: 'Treatment consent',
      description: '',
      acknowledgementText: '',
      fieldsJson: incompleteConsentSchema,
      draftRevision: 1,
      status: 'DRAFT',
    });
    const user = userEvent.setup();
    renderExistingForm();

    await screen.findByText('Treatment consent');
    await user.click(screen.getByRole('button', { name: 'Save and publish' }));

    await waitFor(() => expect(updateForm).toHaveBeenCalled());
    expect(publishForm).not.toHaveBeenCalled();
    expect(await screen.findByText('Draft saved — finish these before publishing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /needs the consent wording/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add the final acknowledgement/i })).toBeInTheDocument();
  });

  it('saves the draft, publishes it, and exposes the final tenant form URL', async () => {
    fetchWithAuth
      .mockResolvedValueOnce(apiResponse('DRAFT'))
      .mockResolvedValueOnce(apiResponse('PUBLISHED'));
    const user = userEvent.setup();
    renderExistingForm();

    await screen.findByLabelText('Full name');
    await user.click(screen.getByRole('button', { name: 'Save and publish' }));

    await waitFor(() => expect(updateForm).toHaveBeenCalledWith(formId, expect.objectContaining({
      title: 'Consultation consent',
      formType: 'CONSENT',
      acknowledgementText: 'I confirm that this information is accurate.',
      schema: expect.objectContaining({ fields: expect.arrayContaining([expect.objectContaining({ key: 'full_name' })]) }),
    })));
    expect(publishForm).toHaveBeenCalledWith(formId);
    expect(await screen.findByText('Published')).toBeInTheDocument();
    expect(screen.getByText('https://test-salon.kasimshah.com/form/consultation-consent')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open live' })).toHaveAttribute('href', 'https://test-salon.kasimshah.com/form/consultation-consent');
  });
});
