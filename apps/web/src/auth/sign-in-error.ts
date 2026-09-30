type SignInError = { status?: number; code?: string; name?: string };

/** Do not mistake a provider outage or quota restriction for invalid credentials. */
export function signInErrorMessage(error: SignInError | null, invalidCredentialsMessage: string): string {
  if (error?.status === 402) {
    return 'Sign-in is temporarily unavailable because the authentication service is restricted. Please contact support. Your password has not been checked.';
  }
  if (error?.status === 429 || error?.code === 'over_request_rate_limit') {
    return 'Too many sign-in attempts. Please wait a few minutes before trying again.';
  }
  if (error?.code === 'invalid_credentials') return invalidCredentialsMessage;
  return 'We couldn’t reach or complete sign-in with the authentication service. Please try again in a moment. If this continues, contact support.';
}
