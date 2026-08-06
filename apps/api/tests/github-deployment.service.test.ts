import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GithubDeploymentError,
  GithubDeploymentService,
} from '../src/modules/deployments/github-deployment.service.js';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const baseRun = {
  id: 418,
  html_url: 'https://github.com/kazshh786/ks-os/actions/runs/418',
  status: 'in_progress',
  conclusion: null,
  display_title: 'Production deploy • both • main • portal-123',
  head_sha: 'a869bea843a8b0baec1d2f9bfa48937cb7709dac',
  created_at: '2026-08-06T10:00:00Z',
  updated_at: '2026-08-06T10:01:00Z',
};

test('dispatches the unified production workflow and returns its run', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/actions/workflows/deploy-production.yml/dispatches')) {
      return jsonResponse({ workflow_run_id: 418, html_url: baseRun.html_url });
    }
    if (url.endsWith('/actions/runs/418')) return jsonResponse(baseRun);
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const service = new GithubDeploymentService({
    token: 'test-token',
    repository: 'kazshh786/ks-os',
    workflowFile: 'deploy-production.yml',
    fetchImpl,
  });

  const run = await service.dispatch({
    target: 'both',
    ref: 'main',
    applyMigrations: false,
    requestId: 'portal-123',
  });

  assert.equal(run.runId, 418);
  assert.equal(run.status, 'in_progress');
  assert.equal(run.url, baseRun.html_url);
  assert.deepEqual(run.failedSteps, []);

  const dispatch = calls[0];
  assert.equal(dispatch.init?.method, 'POST');
  assert.equal((dispatch.init?.headers as Record<string, string>).Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(String(dispatch.init?.body)), {
    ref: 'main',
    inputs: {
      target: 'both',
      ref: 'main',
      apply_migrations: 'false',
      request_id: 'portal-123',
    },
  });
});

test('returns failed step summaries without exposing full workflow logs', async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/actions/runs/418')) {
      return jsonResponse({
        ...baseRun,
        status: 'completed',
        conclusion: 'failure',
      });
    }
    if (url.includes('/actions/runs/418/jobs')) {
      return jsonResponse({
        jobs: [
          {
            name: 'Deploy production',
            html_url: `${baseRun.html_url}/job/900`,
            steps: [
              { name: 'Run release checks', status: 'completed', conclusion: 'success' },
              { name: 'Deploy Cloudflare release', status: 'completed', conclusion: 'failure' },
            ],
          },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const service = new GithubDeploymentService({
    token: 'test-token',
    repository: 'kazshh786/ks-os',
    workflowFile: 'deploy-production.yml',
    fetchImpl,
  });

  const run = await service.getRun(418);
  assert.equal(run.conclusion, 'failure');
  assert.deepEqual(run.failedSteps, [
    {
      job: 'Deploy production',
      step: 'Deploy Cloudflare release',
      jobUrl: `${baseRun.html_url}/job/900`,
    },
  ]);
});

test('rejects an API service without a deployment token', () => {
  assert.throws(
    () => new GithubDeploymentService({
      token: '',
      repository: 'kazshh786/ks-os',
      workflowFile: 'deploy-production.yml',
    }),
    (error: unknown) => {
      assert.ok(error instanceof GithubDeploymentError);
      assert.equal(error.code, 'DEPLOYMENT_CONFIGURATION_MISSING');
      return true;
    },
  );
});
