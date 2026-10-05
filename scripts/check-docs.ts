/**
 * Documentation checks, run in CI:
 *  1. every Mermaid block in README.md and docs/ renders (so a broken diagram fails the build)
 *  2. every relative link and in-page anchor resolves
 *  3. every Markdown file in docs/ is reachable from README.md through relative links
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const failures: string[] = [];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const markdownFiles = ['README.md', ...walk('docs').filter((f) => f.endsWith('.md'))].filter((f) =>
  existsSync(f),
);

/** Removes fenced code blocks so links inside examples are ignored. */
function withoutCode(text: string) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

function slug(heading: string) {
  return heading
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

function anchorsOf(file: string): Set<string> {
  const text = withoutCode(readFileSync(file, 'utf8'));
  return new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1])));
}

// 2 + 3: links and reachability.
const linksFrom = new Map<string, string[]>();
for (const file of markdownFiles) {
  const text = withoutCode(readFileSync(file, 'utf8'));
  const targets: string[] = [];
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = m[1];
    if (/^(https?:|mailto:)/.test(href)) continue;
    const [rawPath, anchor] = href.split('#');
    const target =
      rawPath === ''
        ? file
        : path.normalize(path.join(path.dirname(file), decodeURIComponent(rawPath)));
    if (!existsSync(target)) {
      failures.push(`${file}: broken link to "${href}"`);
      continue;
    }
    if (anchor && target.endsWith('.md') && !anchorsOf(target).has(anchor)) {
      failures.push(`${file}: anchor "#${anchor}" not found in ${target}`);
    }
    if (target.endsWith('.md')) targets.push(target);
  }
  linksFrom.set(file, targets);
}

const reachable = new Set<string>(['README.md']);
const queue = ['README.md'];
while (queue.length) {
  const current = queue.pop()!;
  for (const next of linksFrom.get(current) ?? []) {
    if (!reachable.has(next)) {
      reachable.add(next);
      queue.push(next);
    }
  }
}
for (const file of markdownFiles.filter((f) => f.startsWith('docs'))) {
  if (!reachable.has(file)) failures.push(`${file}: not linked from README.md`);
}

// 1: Mermaid blocks.
type Block = { file: string; index: number; code: string };
const blocks: Block[] = [];
for (const file of markdownFiles) {
  const text = readFileSync(file, 'utf8');
  let i = 0;
  for (const m of text.matchAll(/```mermaid\n([\s\S]*?)```/g))
    blocks.push({ file, index: ++i, code: m[1] });
}

async function checkMermaid() {
  if (blocks.length === 0) return;
  const { chromium } = await import('@playwright/test');
  const work = path.join(tmpdir(), `mermaid-check-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const puppeteerConfig = path.join(work, 'puppeteer.json');
  writeFileSync(
    puppeteerConfig,
    JSON.stringify({
      executablePath: chromium.executablePath(),
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }),
  );
  for (const block of blocks) {
    const input = path.join(work, 'diagram.mmd');
    writeFileSync(input, block.code);
    try {
      execFileSync(
        'npx',
        ['mmdc', '-i', input, '-o', path.join(work, 'out.svg'), '-p', puppeteerConfig, '-q'],
        {
          stdio: 'pipe',
          timeout: 120_000,
        },
      );
    } catch (err) {
      const e = err as { stderr?: Buffer };
      failures.push(
        `${block.file}: Mermaid diagram #${block.index} does not render\n${e.stderr?.toString().trim().split('\n').slice(0, 6).join('\n')}`,
      );
    }
  }
  console.log(`Checked ${blocks.length} Mermaid diagram(s).`);
}

async function main() {
  await checkMermaid();
  if (failures.length) {
    console.error(`\nDocumentation check failed:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log(
    `Documentation OK: ${markdownFiles.length} files, links resolve, every docs page is linked from the README.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
