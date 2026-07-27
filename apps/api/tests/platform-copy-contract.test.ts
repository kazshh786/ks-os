import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const webRoot = fileURLToPath(new URL('../../web/src/', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const target = path.join(directory, entry);
    return statSync(target).isDirectory()
      ? sourceFiles(target)
      : /\.(tsx?|jsx?)$/.test(entry)
        ? [target]
        : [];
  });
}

const rules = [
  { name: 'Use “Sign in”, not “Log in”.', pattern: /(['"`])[^'"`\n]*\blog in\b[^'"`\n]*\1/gi },
  { name: 'Use “Sign out”, not “Log out”.', pattern: /(['"`])[^'"`\n]*\blog out\b[^'"`\n]*\1/gi },
  { name: 'Use “Sign in”, not the noun “Login”.', pattern: /(['"`])Login\1|>\s*Login\s*</g },
  { name: 'Use “Sign out”, not the noun “Logout”.', pattern: /(['"`])Logout\1|>\s*Logout\s*</g },
  { name: 'Replace vague “Submit” buttons with the result.', pattern: /(['"`])Submit\1|>\s*Submit\s*</g },
  { name: 'Replace “Click here” with the destination or result.', pattern: /(['"`])[^'"`\n]*\bclick here\b[^'"`\n]*\1/gi },
  { name: 'Replace system-focused authentication errors.', pattern: /Invalid credentials|User does not exist(?: in database)?/gi },
  { name: 'Replace database-style empty states.', pattern: /No records found|Create new customer/gi },
  { name: 'Write “and”, not an ampersand, in UI copy.', pattern: /(['"`])[^'"`\n]*\s&\s[^'"`\n]*\1/g },
] as const;

test('user-facing source follows the platform vocabulary contract', () => {
  const violations: Array<{ file: string; line: number; rule: string; found: string }> = [];
  for (const file of sourceFiles(webRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      for (const match of source.matchAll(rule.pattern)) {
        const line = source.slice(0, match.index).split('\n').length;
        violations.push({
          file: path.relative(webRoot, file),
          line,
          rule: rule.name,
          found: match[0],
        });
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `UX writing violations:\n${violations.map(item => `${item.file}:${item.line} — ${item.rule} Found: ${JSON.stringify(item.found)}`).join('\n')}`,
  );
});

test('the writing standard covers actions, inputs, errors and empty states', () => {
  const standard = readFileSync(new URL('../../../docs/ux-writing-standard.md', import.meta.url), 'utf8');
  assert.match(standard, /Write for the person using the product/);
  assert.match(standard, /Make screens easy to scan/);
  assert.match(standard, /Use one term for one concept/);
  assert.match(standard, /Make actions precise/);
  assert.match(standard, /Guide every input/);
  assert.match(standard, /recover from errors/);
  assert.match(standard, /empty state/i);
  assert.match(standard, /destructive actions/);
});
