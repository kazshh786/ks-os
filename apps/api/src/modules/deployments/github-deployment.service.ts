export type ProductionDeploymentTarget = 'both' | 'vps' | 'cloudflare';

export interface ProductionDeploymentRequest {
  target: ProductionDeploymentTarget;
  ref: string;
  applyMigrations: boolean;
  requestId: string;
}

export interface ProductionDeploymentRun {
  runId: number;
  requestId?: string;
  status: string;
  conclusion: string | null;
  url: string;
  displayTitle: string;
  headSha: string;
  createdAt: string;
  updatedAt: string;
  failedSteps: Array<{
    job: string;
    step: string;
    jobUrl: string;
  }>;
}

interface GithubWorkflowDispatchResponse {
  workflow_run_id?: number;
  html_url?: string;
}

interface GithubWorkflowRun {
  id: number;
  html_url: string;
  status: string;
  conclusion: string | null;
  display_title: string;
  head_sha: string;
  created_at: string;
  updated_at: string;
}

interface GithubWorkflowRunsResponse {
  workflow_runs: GithubWorkflowRun[];
}

interface GithubJobStep {
  name: string;
  status: string;
  conclusion: string | null;
}

interface GithubJob {
  name: string;
  html_url: string;
  steps?: GithubJobStep[];
}

interface GithubJobsResponse {
  jobs: GithubJob[];
}

export interface GithubDeploymentServiceOptions {
  token: string;
  repository: string;
  workflowFile: string;
  fetchImpl?: typeof fetch;
}

export class GithubDeploymentError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
    readonly code = 'GITHUB_DEPLOYMENT_ERROR',
  ) {
    super(message);
    this.name = 'GithubDeploymentError';
  }
}

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

export class GithubDeploymentService {
  private readonly fetchImpl: typeof fetch;
  private readonly owner: string;
  private readonly repositoryName: string;

  constructor(private readonly options: GithubDeploymentServiceOptions) {
    const [owner, repositoryName, ...extra] = options.repository.split('/');
    if (!owner || !repositoryName || extra.length > 0) {
      throw new GithubDeploymentError(
        'KS_OS_GITHUB_REPOSITORY must use owner/name format.',
        503,
        'DEPLOYMENT_CONFIGURATION_INVALID',
      );
    }
    if (!options.token.trim()) {
      throw new GithubDeploymentError(
        'The production deployment token is not configured.',
        503,
        'DEPLOYMENT_CONFIGURATION_MISSING',
      );
    }
    this.owner = owner;
    this.repositoryName = repositoryName;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async dispatch(input: ProductionDeploymentRequest): Promise<ProductionDeploymentRun> {
    const response = await this.request(
      `/repos/${this.owner}/${this.repositoryName}/actions/workflows/${encodeURIComponent(this.options.workflowFile)}/dispatches`,
      {
        method: 'POST',
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            target: input.target,
            ref: input.ref,
            apply_migrations: String(input.applyMigrations),
            request_id: input.requestId,
          },
        }),
      },
      [200, 204],
    );

    const dispatchBody = await this.readJson<GithubWorkflowDispatchResponse>(response);
    if (dispatchBody?.workflow_run_id) {
      return this.getRun(dispatchBody.workflow_run_id, input.requestId);
    }

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const runs = await this.listRecentRuns();
      const match = runs.find(run => run.display_title.includes(input.requestId));
      if (match) return this.mapRun(match, input.requestId, []);
      await delay(500);
    }

    throw new GithubDeploymentError(
      'GitHub accepted the deployment request, but the workflow run could not be located.',
      502,
      'DEPLOYMENT_RUN_NOT_FOUND',
    );
  }

  async getRun(runId: number, requestId?: string): Promise<ProductionDeploymentRun> {
    const runResponse = await this.request(
      `/repos/${this.owner}/${this.repositoryName}/actions/runs/${runId}`,
      { method: 'GET' },
      [200],
    );
    const run = await this.requireJson<GithubWorkflowRun>(runResponse);
    const failedSteps = run.status === 'completed' && run.conclusion !== 'success'
      ? await this.getFailedSteps(runId)
      : [];
    return this.mapRun(run, requestId, failedSteps);
  }

  private async listRecentRuns() {
    const response = await this.request(
      `/repos/${this.owner}/${this.repositoryName}/actions/workflows/${encodeURIComponent(this.options.workflowFile)}/runs?event=workflow_dispatch&per_page=30`,
      { method: 'GET' },
      [200],
    );
    return (await this.requireJson<GithubWorkflowRunsResponse>(response)).workflow_runs;
  }

  private async getFailedSteps(runId: number) {
    const response = await this.request(
      `/repos/${this.owner}/${this.repositoryName}/actions/runs/${runId}/jobs?filter=latest&per_page=100`,
      { method: 'GET' },
      [200],
    );
    const body = await this.requireJson<GithubJobsResponse>(response);
    return body.jobs.flatMap(job =>
      (job.steps ?? [])
        .filter(step => step.conclusion === 'failure' || step.conclusion === 'cancelled' || step.conclusion === 'timed_out')
        .map(step => ({ job: job.name, step: step.name, jobUrl: job.html_url })),
    );
  }

  private mapRun(
    run: GithubWorkflowRun,
    requestId: string | undefined,
    failedSteps: ProductionDeploymentRun['failedSteps'],
  ): ProductionDeploymentRun {
    return {
      runId: run.id,
      requestId,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url,
      displayTitle: run.display_title,
      headSha: run.head_sha,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      failedSteps,
    };
  }

  private async request(path: string, init: RequestInit, allowedStatuses: number[]) {
    let response: Response;
    try {
      response = await this.fetchImpl(`https://api.github.com${path}`, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.options.token}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...init.headers,
        },
      });
    } catch (cause) {
      throw new GithubDeploymentError(
        cause instanceof Error ? `GitHub could not be reached: ${cause.message}` : 'GitHub could not be reached.',
      );
    }

    if (!allowedStatuses.includes(response.status)) {
      const body = await response.text().catch(() => '');
      const suffix = body ? ` ${body.slice(0, 500)}` : '';
      throw new GithubDeploymentError(
        `GitHub deployment request failed with HTTP ${response.status}.${suffix}`,
        response.status === 401 || response.status === 403 ? 503 : 502,
        response.status === 401 || response.status === 403
          ? 'DEPLOYMENT_TOKEN_REJECTED'
          : 'GITHUB_DEPLOYMENT_ERROR',
      );
    }

    return response;
  }

  private async readJson<T>(response: Response): Promise<T | null> {
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GithubDeploymentError('GitHub returned an unreadable deployment response.');
    }
  }

  private async requireJson<T>(response: Response): Promise<T> {
    const body = await this.readJson<T>(response);
    if (!body) throw new GithubDeploymentError('GitHub returned an empty deployment response.');
    return body;
  }
}
