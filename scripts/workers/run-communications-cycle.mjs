const origin = (process.env.API_INTERNAL_ORIGIN || 'http://127.0.0.1:5000').replace(/\/$/, '');
const emailSecret = process.env.EMAIL_OUTBOX_WORKER_SECRET;
const automationSecret = process.env.AUTOMATION_WORKER_SECRET;

if (!emailSecret || emailSecret.length < 32) throw new Error('EMAIL_OUTBOX_WORKER_SECRET is not configured');
if (!automationSecret || automationSecret.length < 32) throw new Error('AUTOMATION_WORKER_SECRET is not configured');

async function run(path, secret) {
  const response = await fetch(origin + path, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + secret, accept: 'application/json' },
    signal: AbortSignal.timeout(55_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(path + ' failed with HTTP ' + response.status);
  return body;
}

const results = {};
results.schedules = await run('/api/v1/internal/automation-worker/schedules', automationSecret);
results.events = await run('/api/v1/internal/automation-worker/events', automationSecret);
results.actions = await run('/api/v1/internal/automation-worker/actions', automationSecret);
results.email = await run('/api/v1/communications/worker/run', emailSecret);

process.stdout.write(JSON.stringify({ ok: true, results }) + '\n');
