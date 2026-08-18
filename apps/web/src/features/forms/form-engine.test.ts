import { describe, expect, it } from 'vitest';
import { formatFormAnswer } from './form-engine.js';

const choiceField = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'SINGLE_CHOICE',
  label: 'Treatment area',
  required: false,
  readOnly: false,
  hidden: false,
  width: '100',
  validation: {},
  sensitiveClassification: 'STANDARD',
  translations: {},
  accessibility: {},
  options: [
    { id: '22222222-2222-4222-8222-222222222222', label: 'Face', value: 'face' },
    { id: '33333333-3333-4333-8333-333333333333', label: 'Neck' },
    { id: '44444444-4444-4444-8444-444444444444', label: 'Hands', value: 'hands' },
  ],
} as any;

describe('formatFormAnswer', () => {
  it('shows a single-choice label instead of the stored option value', () => {
    expect(formatFormAnswer(choiceField, 'face')).toBe('Face');
  });

  it('shows a label when the stored value falls back to an option UUID', () => {
    expect(formatFormAnswer(choiceField, '33333333-3333-4333-8333-333333333333')).toBe('Neck');
  });

  it('shows human-readable labels for multiple selected answers', () => {
    expect(formatFormAnswer({ ...choiceField, type: 'MULTIPLE_CHOICE' }, ['face', 'hands'])).toBe('Face, Hands');
  });

  it('keeps boolean answers readable', () => {
    expect(formatFormAnswer({ ...choiceField, options: undefined, type: 'YES_NO' }, false)).toBe('No');
  });
});
