#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const DEFAULT_REPOSITORY = process.env.KS_OS_GITHUB_REPOSITORY || 'kazshh786/ks-os';
const DEFAULT_WORKFLOW = process.env.KS_OS_GITHUB_DEPLOY_WORKFLOW || 'deploy-production.yml';
const POLL_INTERVAL_MS = 4_000;

function usage() {
  console.log(`KS OS production deployment

Usage:
  pnpm deploy:production [options]

Options:
  --target <both|vps|cloudflare>  Deployment type (default: both)
  --ref <git-ref>                 Git ref to deploy (default: main)
  --migrations                    Apply reviewed database migrations on the VPS
  --no-watch                      Trigger the workflow without waiting for completion
  --repo <owner/name>             GitHub repository override
  --workflow <file>               Workflow file override
  --help                          Show this help

The CLI stays quiet while a deployment is healthy. If it fails, only failed
GitHub Actions step logs are printed.`);
}

function fail(message, details) {
  console.error(`Deployment error: ${message}`);
  if (details) console.error(details.trim());
  process.exit(1);
}

function parseArguments(argv) {
  const options = {
    target: 'both',
    ref: 'main',
    applyMigrations: false,
    watch: true,
    repository: DEFAULT_REPOSITORY,
    workflow: DEFAULT_WORKFLOW,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      usage();
      process.exit(0);
    }
    if (argument === '--migrations') {
      options.applyMigrations = true;
      continue;
    }
    if (argument === '--no-watch') {
      options.watch = false;
      continue;
    }

    const nextValue = argv[index + 1];
    if (['--target', '--ref', '--repo', '--workflow'].includes(argument)) {
      if (!nextValue || nextValue.startsWith('--')) fail(`${argument} requires a value.`);
      index += 1;
      if (argument === '--target') options.target = nextValue;
      if (argument === '--ref') options.ref = nextValue;
      if (argument === '--repo') options.repository = nextValue;
      if (argument === '--workflow') options.workflow = nextValue;
      continue;
    }

    fail(`Unknown option: ${argument}`);
  }

  if (!['both', 'vps', 'cloudflare'].includes(options.target)) {
    fail(`Unsupported target "${options.target}". Use both, vps, or cloudflare.`);
  }
  if (!/^[A-Za-z0-9._/-]{1,255}$/.test(options.ref)) fail('The Git ref contains unsupported characters.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)) fail('The repository must use owner/name format.');
  if (!/^[A-Za-z0-9_.-]+\.ya?ml$/.test(options.workflow)) fail('The workflow must be a YAML file name.');

  return options;
}

function gh(args, { allowFailure = false, inherit = false } = {}) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });

  if (result.error?.code === 'ENOENT') {
    fail('GitHub CLI is not installed. Install gh and run gh auth login first.');
  }
  if (!allowFailure && result.status !== 0) {
    fail(`gh ${args[0]} failed.`, result.stderr || result.stdout);
  }
  return result;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function findWorkflowRun(options, requestId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = gh([
      'run', 'list',
      '--repo', options.repository,
      '--workflow', options.workflow,
      '--event', 'workflow_dispatch',
      '--limit', '30',
      '--json', 'databaseId,displayTitle,status,conclusion,url,createdAt',
    ]);
    const runs = JSON.parse(result.stdout || '[]');
    const match = runs.find(run => run.displayTitle?.includes(requestId));
    if (match) return match;
    await sleep(1_000);
  }
  fail('The workflow was triggered, but its run could not be located. Check GitHub Actions directly.');
}

async function watchWorkflowRun(options, initialRun) {
  let run = initialRun;
  while (run.status !== 'completed') {
    await sleep(POLL_INTERVAL_MS);
    const result = gh([
      'run', 'view', String(run.databaseId),
      '--repo', options.repository,
      '--json', 'databaseId,displayTitle,status,conclusion,url',
    ]);
    run = JSON.parse(result.stdout);
  }

  if (run.conclusion === 'success') {
    console.log(`Deployment completed successfully: ${run.url}`);
    return;
  }

  console.error(`Deployment ${run.conclusion || 'failed'}: ${run.url}`);
  const failedLogs = gh([
    'run', 'view', String(run.databaseId),
    '--repo', options.repository,
    '--log-failed',
  ], { allowFailure: true });

  const output = [failedLogs.stdout, failedLogs.stderr].filter(Boolean).join('\n').trim();
  if (output) console.error(output);
  process.exit(1);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  gh(['auth', 'status']);

  const requestId = `cli-${Date.now()}-${randomUUID().slice(0, 8)}`;
  gh([
    'workflow', 'run', options.workflow,
    '--repo', options.repository,
    '--ref', 'main',
    '-f', `target=${options.target}`,
    '-f', `ref=${options.ref}`,
    '-f', `apply_migrations=${options.applyMigrations}`,
    '-f', `request_id=${requestId}`,
  ]);

  const run = await findWorkflowRun(options, requestId);
  console.log(`Deployment started (${options.target}): ${run.url}`);
  if (options.watch) await watchWorkflowRun(options, run);
}

main().catch(error => fail(error instanceof Error ? error.message : String(error)));
