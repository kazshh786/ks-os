import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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

describe('FormFieldControl', () => {
  it('emits booleans for Yes and No fields', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FormFieldControl field={yesNoField} value={undefined} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: 'No' }));

    expect(onChange).toHaveBeenNthCalledWith(1, true);
    expect(onChange).toHaveBeenNthCalledWith(2, false);
  });
});
