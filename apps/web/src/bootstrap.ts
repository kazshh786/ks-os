import { isPublicSitePath, normalisePublicPath } from './public-route';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Application root element was not found.');
}

const path = normalisePublicPath(window.location.pathname);
const isPublicPage = isPublicSitePath(path);
const entryName = isPublicPage ? 'public-site' : 'application';
const recoveryKey = `ks-os-deployment-recovery:${entryName}`;
let deploymentReloadRequested = false;

function cleanRecoveryParameter() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('_ks_deploy')) return;

  url.searchParams.delete('_ks_deploy');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function requestLatestDeployment(reason: unknown): boolean {
  if (deploymentReloadRequested) return true;

  const hasRetried = window.sessionStorage.getItem(recoveryKey) === '1';
  if (hasRetried) return false;

  deploymentReloadRequested = true;
  window.sessionStorage.setItem(recoveryKey, '1');
  console.warn('KS OS detected a replaced deployment asset and is requesting the latest build.', reason);

  const url = new URL(window.location.href);
  url.searchParams.set('_ks_deploy', Date.now().toString());
  window.location.replace(url.toString());
  return true;
}

window.addEventListener('vite:preloadError', (event: Event) => {
  event.preventDefault();
  requestLatestDeployment('Vite preload error');
});

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  const message = event.reason instanceof Error ? event.reason.message : String(event.reason);
  const isDeploymentAssetError = /dynamically imported module|module script failed|failed to fetch/i.test(message);

  if (isDeploymentAssetError && requestLatestDeployment(message)) {
    event.preventDefault();
  }
});

function showLoadingState() {
  const loadingName = isPublicPage ? 'Kasim Shah' : 'KS OS';
  root.innerHTML = `
    <div role="status" aria-live="polite" style="min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#0f172a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;box-sizing:border-box">
      <div style="display:grid;justify-items:center;gap:16px;text-align:center">
        <div aria-hidden="true" style="height:36px;width:36px;border:3px solid #e2e8f0;border-top-color:#4f46e5;border-radius:9999px;animation:ks-os-spin .8s linear infinite"></div>
        <div>
          <p style="margin:0;font-size:15px;font-weight:800">Loading ${loadingName}</p>
          <p style="margin:6px 0 0;font-size:13px;color:#64748b">Preparing the latest version…</p>
        </div>
      </div>
    </div>
  `;
}

function showRecoveryState(error: unknown) {
  console.error('KS OS entry failed to load after deployment recovery', error);
  window.sessionStorage.removeItem(recoveryKey);

  root.innerHTML = `
    <div role="alert" style="min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#0f172a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;box-sizing:border-box">
      <div style="width:min(100%,460px);border:1px solid #e2e8f0;border-radius:16px;background:#fff;padding:28px;box-shadow:0 20px 60px rgba(15,23,42,.10);text-align:center">
        <div style="margin:0 auto 18px;display:grid;height:44px;width:44px;place-items:center;border-radius:12px;background:#eef2ff;color:#4338ca;font-weight:900">KS</div>
        <h1 style="margin:0;font-size:22px;line-height:1.25">The latest site version could not load</h1>
        <p style="margin:12px 0 0;color:#64748b;font-size:14px;line-height:1.6">The automatic deployment refresh has already been attempted. Use the button below to try the current version again.</p>
        <button id="ks-os-reload" type="button" style="margin-top:22px;width:100%;min-height:44px;border:0;border-radius:12px;background:#4f46e5;color:#fff;font-size:14px;font-weight:800;cursor:pointer">Reload latest version</button>
      </div>
    </div>
  `;

  document.getElementById('ks-os-reload')?.addEventListener('click', () => window.location.reload());
}

async function loadEntry() {
  showLoadingState();

  try {
    if (isPublicPage) {
      await import('./public-site.tsx');
    } else {
      await import('./main.tsx');
    }

    window.sessionStorage.removeItem(recoveryKey);
    cleanRecoveryParameter();
  } catch (error) {
    if (requestLatestDeployment(error)) return;
    showRecoveryState(error);
  }
}

void loadEntry();
