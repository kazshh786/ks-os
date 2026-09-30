import { describe, expect, it } from 'vitest';
import { signInErrorMessage } from './sign-in-error';

describe('sign-in errors', () => {
  const invalid = 'The email or password is incorrect.';

  it('identifies a restricted provider without blaming the password', () => {
    const message = signInErrorMessage({ status: 402 }, invalid);
    expect(message).toContain('authentication service is restricted');
    expect(message).toContain('Your password has not been checked');
    expect(message).not.toBe(invalid);
  });

  it('preserves the neutral invalid-credentials message', () => {
    expect(signInErrorMessage({ status: 400, code: 'invalid_credentials' }, invalid)).toBe(invalid);
  });

  it.each([{ status: 429 }, { code: 'over_request_rate_limit' }])('explains rate limiting: %j', error => {
    expect(signInErrorMessage(error, invalid)).toContain('wait a few minutes');
  });

  it.each([{ status: 503 }, { status: 0, name: 'AuthRetryableFetchError' }, { status: 401 }, null])(
    'does not label service failures or missing sessions as incorrect credentials: %j', error => {
      expect(signInErrorMessage(error, invalid)).toContain('authentication service');
      expect(signInErrorMessage(error, invalid)).not.toBe(invalid);
    },
  );
});
