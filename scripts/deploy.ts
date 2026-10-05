/**
 * One command to ship to production:  npm run deploy
 *
 *   --skip-env       do not sync environment variables to Vercel
 *   --skip-migrate   do not apply database migrations
 *   --check          run lint, typecheck and unit tests first
 *
 * It applies migrations, syncs the env vars from .env, stages a copy of the project WITHOUT git metadata
 * (Vercel Hobby blocks deployments that carry a GitHub organisation repo's metadata), makes sure the Vercel project
 * uses the Next.js preset, deploys to production and smoke-checks the result.
 * Needs VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID in .env.
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const PROD_URL = process.env.PRODUCTION_URL ?? 'https://ai-interviewer-cyan-three.vercel.app';
const ENV_NAMES = [
  'OPENROUTER_API_KEY',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
  'ELEVENLABS_AGENT_ID',
  'AGENT_LLM_SECRET',
  'DATABASE_URL',
  'BLOB_READ_WRITE_TOKEN',
  'CRON_SECRET',
  'DEMO_PASSWORD',
  'DEV_MODE',
  'VOICE_TRANSPORT',
  'MAX_CONCURRENT_INTERVIEWS',
  'MAX_SESSION_MINUTES',
  'STORAGE_BUDGET_BYTES',
  'MAX_VIDEO_BYTES',
  'MAX_MONTHLY_UPLOADS',
];

const step = (msg: string) => console.log(`\n▶ ${msg}`);
function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env`);
  return v;
}
function run(
  cmd: string,
  argv: string[],
  opts: { cwd?: string; input?: string; quiet?: boolean } = {},
) {
  const r = spawnSync(cmd, argv, {
    cwd: opts.cwd,
    input: opts.input,
    encoding: 'utf8',
    env: process.env,
    stdio: opts.quiet ? 'pipe' : ['pipe', 'inherit', 'inherit'],
  });
  if (r.status !== 0)
    throw new Error(
      `${cmd} ${argv.join(' ')} failed${r.stderr ? `: ${r.stderr.slice(0, 300)}` : ''}`,
    );
  return r.stdout ?? '';
}

async function main() {
  const token = need('VERCEL_TOKEN');
  const orgId = need('VERCEL_ORG_ID');
  const projectId = need('VERCEL_PROJECT_ID');
  const vercel = (argv: string[], cwd?: string, input?: string, quiet = true) =>
    run('npx', ['--yes', 'vercel', ...argv, '--token', token, '--scope', orgId], {
      cwd,
      input,
      quiet,
    });

  if (args.has('--check')) {
    step('Checks (lint, typecheck, unit tests)');
    run('npm', ['run', 'lint']);
    run('npm', ['run', 'typecheck']);
    run('npm', ['run', 'test:unit']);
  }

  if (!args.has('--skip-migrate')) {
    step('Applying database migrations');
    run('npm', ['run', 'db:migrate']);
  }

  const env = { ...process.env, VERCEL_ORG_ID: orgId, VERCEL_PROJECT_ID: projectId };
  Object.assign(process.env, env);

  if (!args.has('--skip-env')) {
    step('Syncing environment variables to Vercel (production)');
    for (const name of ENV_NAMES) {
      const value = process.env[name];
      if (!value) continue;
      try {
        vercel(['env', 'rm', name, 'production', '--yes']);
      } catch {
        // not set yet
      }
      vercel(['env', 'add', name, 'production'], undefined, value);
      console.log(`  ${name}`);
    }
  }

  step('Making sure the Vercel project uses the Next.js preset');
  await fetch(`https://api.vercel.com/v9/projects/${projectId}?teamId=${orgId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      framework: 'nextjs',
      outputDirectory: null,
      buildCommand: null,
      installCommand: null,
    }),
  });

  step('Staging a git-free copy of the project');
  const stage = mkdtempSync(path.join(tmpdir(), 'ai-interviewer-deploy-'));
  try {
    run('rsync', [
      '-a',
      '--exclude=.git',
      '--exclude=node_modules',
      '--exclude=.next',
      '--exclude=.claude',
      '--exclude=.env',
      '--exclude=.env.local',
      '--exclude=.vercel',
      '--exclude=test-results',
      '--exclude=playwright-report',
      '--exclude=coverage',
      './',
      `${stage}/`,
    ]);
    mkdirSync(path.join(stage, '.vercel'));
    writeFileSync(
      path.join(stage, '.vercel', 'project.json'),
      JSON.stringify({ projectId, orgId }),
    );

    step('Deploying to production (this takes a few minutes)');
    vercel(['deploy', '--prod', '--yes'], stage, undefined, false);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }

  step(`Smoke-checking ${PROD_URL}`);
  const home = await fetch(PROD_URL, { redirect: 'manual' });
  const ok = home.status === 200 || home.status === 307;
  console.log(`  home: ${home.status} ${ok ? 'OK' : 'UNEXPECTED'}`);
  const cron = await fetch(`${PROD_URL}/api/cron/keep-alive`, {
    headers: { Authorization: `Bearer ${need('CRON_SECRET')}` },
  });
  console.log(`  database keep-alive: ${cron.status} ${cron.status === 200 ? 'OK' : 'UNEXPECTED'}`);
  if (!ok || cron.status !== 200) throw new Error('Smoke check failed');
  console.log('\n✔ Deployed.');
}

main().catch((err) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
