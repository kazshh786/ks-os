type CorsOriginPolicyOptions = {
  exactOrigins?: Array<string | null | undefined>;
  workspaceOrigins?: Array<string | null | undefined>;
  workspaceDomains?: Array<string | null | undefined>;
  allowLocalhost?: boolean;
  inferWorkspaceDomains?: boolean;
};

const SHARED_HOSTING_SUFFIXES = [
  'vercel.app',
  'netlify.app',
  'pages.dev',
  'github.io',
  'workers.dev',
  'herokuapp.com',
  'onrender.com',
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function parseOrigin(value: string) {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return {
      origin: url.origin.toLowerCase(),
      protocol: url.protocol,
      hostname: url.hostname.toLowerCase().replace(/\.$/, ''),
    };
  } catch {
    return null;
  }
}

function normaliseDomain(value: string) {
  const trimmed = value.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!trimmed || trimmed === '*') return null;
  const parsed = parseOrigin(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  return parsed?.hostname || null;
}

function matchesDomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isSharedHostingDomain(domain: string) {
  return SHARED_HOSTING_SUFFIXES.some(suffix => matchesDomain(domain, suffix));
}

function inferWorkspaceDomain(hostname: string) {
  if (LOCAL_HOSTS.has(hostname) || isSharedHostingDomain(hostname)) return null;
  const labels = hostname.split('.').filter(Boolean);
  if (labels.length < 2) return null;
  return labels.length === 2 ? hostname : labels.slice(1).join('.');
}

export function splitCorsConfiguration(value?: string | null) {
  return (value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export function createCorsOriginPolicy(options: CorsOriginPolicyOptions = {}) {
  const exactOrigins = new Set<string>();
  const workspaceHostnames = new Set<string>();

  for (const value of [...(options.workspaceOrigins || []), ...(options.exactOrigins || [])]) {
    if (!value) continue;
    const parsed = parseOrigin(value);
    if (parsed) exactOrigins.add(parsed.origin);
  }

  for (const value of options.workspaceOrigins || []) {
    if (!value) continue;
    const parsed = parseOrigin(value);
    if (parsed) workspaceHostnames.add(parsed.hostname);
  }

  const workspaceDomains = new Set<string>();
  for (const value of options.workspaceDomains || []) {
    if (!value) continue;
    const domain = normaliseDomain(value);
    if (domain && !LOCAL_HOSTS.has(domain) && !isSharedHostingDomain(domain)) workspaceDomains.add(domain);
  }

  if (options.inferWorkspaceDomains !== false) {
    for (const hostname of workspaceHostnames) {
      const domain = inferWorkspaceDomain(hostname);
      if (domain) workspaceDomains.add(domain);
    }
  }

  return (origin?: string | null) => {
    if (!origin) return true;
    const parsed = parseOrigin(origin);
    if (!parsed) return false;
    if (exactOrigins.has(parsed.origin)) return true;
    if (options.allowLocalhost && LOCAL_HOSTS.has(parsed.hostname)) return true;
    if (parsed.protocol !== 'https:') return false;
    return [...workspaceDomains].some(domain => matchesDomain(parsed.hostname, domain));
  };
}
