const root = document.getElementById('root');

if (!root) {
  throw new Error('Application root element was not found.');
}

const path = window.location.pathname.replace(/\/+$/, '') || '/';
const isMarketingPage = path === '/' || path === '/services' || path.startsWith('/services/');
const entryName = isMarketingPage ? 'marketing' : 'application';
const retryKey = `ks-os-entry-retry:${entryName}`;

function cleanRetryParameter() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('_ks_retry')) return;

  url.searchParams.delete('_ks_retry');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function showLoadingState() {
  root.innerHTML = `
    <div role="status" aria-live="polite" style="min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#0f172a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px">
      <div style="display:grid;justify-items:center;gap:16px;text-align:center">
        <div aria-hidden="true" style="height:36px;width:36px;border:3px solid #e2e8f0;border-top-color:#4f46e5;border-radius:9999px;animation:ks-os-spin .8s linear infinite"></div>
        <div>
          <p style="margin:0;font-size:15px;font-weight:800">Loading ${isMarketingPage ? 'Kasim Shah' : 'KS OS'}</p>
          <p style="margin:6px 0 0;font-size:13px;color:#64748b">Preparing the page…</p>
        </div>
      </div>
    </div>
  `;
}

function showRecoveryState(error: unknown) {
  console.error('KS OS entry failed to load', error);
  root.innerHTML = `
    <div role="alert" style="min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#0f172a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px">
      <div style="width:min(100%,460px);border:1px solid #e2e8f0;border-radius:16px;background:#fff;padding:28px;box-shadow:0 20px 60px rgba(15,23,42,.10);text-align:center">
        <div style="margin:0 auto 18px;display:grid;height:44px;width:44px;place-items:center;border-radius:12px;background:#eef2ff;color:#4338ca;font-weight:900">KS</div>
        <h1 style="margin:0;font-size:22px;line-height:1.25">This page did not load correctly</h1>
        <p style="margin:12px 0 0;color:#64748b;font-size:14px;line-height:1.6">The site could not finish loading. Refresh once to request the latest application files.</p>
        <button id="ks-os-reload" type="button" style="margin-top:22px;width:100%;min-height:44px;border:0;border-radius:12px;background:#4f46e5;color:#fff;font-size:14px;font-weight:800;cursor:pointer">Reload page</button>
      </div>
    </div>
  `;

  document.getElementById('ks-os-reload')?.addEventListener('click', () => window.location.reload());
}

async function loadEntry() {
  showLoadingState();

  try {
    if (isMarketingPage) {
      await import('./marketing.tsx');
    } else {
      await import('./main.tsx');
    }

    window.sessionStorage.removeItem(retryKey);
    cleanRetryParameter();
  } catch (error) {
    const hasRetried = window.sessionStorage.getItem(retryKey) === '1';

    if (!hasRetried) {
      window.sessionStorage.setItem(retryKey, '1');
      const url = new URL(window.location.href);
      url.searchParams.set('_ks_retry', Date.now().toString());
      window.location.replace(url.toString());
      return;
    }

    window.sessionStorage.removeItem(retryKey);
    showRecoveryState(error);
  }
}

void loadEntry();
