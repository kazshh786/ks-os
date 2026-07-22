const configuredResetOrigin = import.meta.env.VITE_PASSWORD_RESET_ORIGIN || '';

export function buildPasswordResetRedirect(returnTo: string) {
  const origin = configuredResetOrigin || window.location.origin;
  const url = new URL('/login', origin);
  url.searchParams.set('mode', 'reset');
  url.searchParams.set('returnTo', returnTo);
  return url.toString();
}
