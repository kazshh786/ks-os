function hostClass(hostname) {
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) return 'local';
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) {
    return 'private';
  }
  return 'remote';
}

export function assertSafeMigrationTarget({
  appEnvironment,
  apply,
  databaseUrl,
  explicitDevelopmentOptIn,
  explicitProductionOptIn,
  nodeEnvironment,
  remoteDevelopmentOptIn,
  allowedProjectRef,
}) {
  if (!apply) return;
  const environment = (appEnvironment || nodeEnvironment || '').toLowerCase();

  if (['production', 'staging'].includes(environment)) {
    const productionOptIn = explicitProductionOptIn === true || process.env.APPLY_MIGRATIONS === '1';
    if (!productionOptIn) {
      throw new Error(`Migration apply in ${environment} requires APPLY_MIGRATIONS=1.`);
    }
    return;
  }

  if (nodeEnvironment !== 'development' || environment !== 'development') {
    throw new Error('Migration apply requires a designated development environment.');
  }
  if (!explicitDevelopmentOptIn) {
    throw new Error('Migration apply requires --allow-non-prod-apply.');
  }

  const connection = new URL(databaseUrl);
  if (hostClass(connection.hostname) !== 'remote') return;
  const projectRef = decodeURIComponent(connection.username)
    .match(/\.([a-z0-9]{20})$/i)?.[1]
    ?? connection.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/i)?.[1];
  if (
    remoteDevelopmentOptIn !== true
    || !allowedProjectRef
    || projectRef !== allowedProjectRef
    || !(
      connection.hostname.endsWith('.pooler.supabase.com')
      || connection.hostname === `db.${allowedProjectRef}.supabase.co`
    )
    || connection.searchParams.get('sslmode') !== 'require'
  ) {
    throw new Error('Remote migrations require the explicitly designated encrypted development project.');
  }
}
