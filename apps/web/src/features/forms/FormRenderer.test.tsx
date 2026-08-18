import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormField } from '@ks-os/contracts';
import { FormFieldControl } from './FormRenderer.js';

const yesNoField: FormField = {
  id: '11111111-1111-4111-8111-111111111111',
  key: 'has_allergies',
  type: 'YES_NO',
  label: 'Do you have allergies?',
  required: true,
  readOnly: false,
  hidden: false,
  width: '100',
  validation: {},
  sensitiveClassification: 'MEDICAL',
  translations: {},
  accessibility: {},
};

const consentField: FormField = {
  id: '22222222-2222-4222-8222-222222222222',
  key: 'treatment_consent',
  type: 'CONSENT_CHECKBOX',
  label: 'Treatment consent',
  description: 'I confirm that I understand the treatment, possible risks and aftercare guidance, and I consent to proceed.',
  required: true,
  readOnly: false,
  hidden: false,
  width: '100',
  validation: {},
  sensitiveClassification: 'MEDICAL',
  translations: {},
  accessibility: {},
};

describe('FormFieldControl', () => {
  beforeEach(() => window.history.pushState({}, '', '/'));

  it('emits booleans for Yes and No fields', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FormFieldControl field={yesNoField} value={undefined} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: 'No' }));

    expect(onChange).toHaveBeenNthCalledWith(1, true);
    expect(onChange).toHaveBeenNthCalledWith(2, false);
  });

  it('links a workspace consent checkbox to the consent document', () => {
    window.history.pushState({}, '', '/form/treatment-consent');
    render(<FormFieldControl field={consentField} value={false} onChange={vi.fn()} />);

    expect(screen.getByRole('link', { name: 'Read consent form' })).toHaveAttribute('href', '/form/treatment-consent/acknowledgement');
    expect(screen.getByRole('link', { name: 'Read consent form' })).toHaveAttribute('target', '_blank');
  });

  it('links an assigned consent checkbox to the secure consent document', () => {
    window.history.pushState({}, '', '/forms/complete/secure-token');
    render(<FormFieldControl field={consentField} value={false} onChange={vi.fn()} />);

    expect(screen.getByRole('link', { name: 'Read consent form' })).toHaveAttribute('href', '/forms/complete/secure-token/acknowledgement');
  });

  it('shows the consent document link treatment in the builder preview', () => {
    window.history.pushState({}, '', '/app/forms/11111111-1111-4111-8111-111111111111/edit');
    render(<FormFieldControl field={consentField} value={false} onChange={vi.fn()} builderMode />);

    const link = screen.getByRole('link', { name: 'Read consent form preview' });
    expect(link).toHaveTextContent('Read consent form');
    expect(link).toHaveAttribute('href', '#consent-document-preview');
    expect(link).not.toHaveAttribute('target');
  });
});
