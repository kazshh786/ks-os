import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
const webRoot = path.resolve(repositoryRoot, 'apps/web/src');
const appsRoot = path.resolve(repositoryRoot, 'apps');
const packagesRoot = path.resolve(repositoryRoot, 'packages');
const offset = Number.parseInt(process.env.COPY_AUDIT_OFFSET || '0', 10);
const limit = Number.parseInt(process.env.COPY_AUDIT_LIMIT || '1000', 10);

function sourceFiles(directory) {
  return readdirSync(directory).flatMap(entry => {
    const target = path.join(directory, entry);
    return statSync(target).isDirectory()
      ? sourceFiles(target)
      : /\.(tsx?|jsx?)$/.test(entry)
        ? [target]
        : [];
  });
}

const webRules = [
  { name: 'Use “Sign in”, not “Log in”.', pattern: /(['"`])[^'"`\n]*\blog in\b[^'"`\n]*\1/gi },
  { name: 'Use “Sign out”, not “Log out”.', pattern: /(['"`])[^'"`\n]*\blog out\b[^'"`\n]*\1/gi },
  { name: 'Use “Sign in”, not the noun “Login”.', pattern: /(['"`])Login\1|>\s*Login\s*</g },
  { name: 'Use “Sign out”, not the noun “Logout”.', pattern: /(['"`])Logout\1|>\s*Logout\s*</g },
  { name: 'Replace vague “Submit” buttons with the result.', pattern: /(['"`])Submit\1|>\s*Submit\s*</g },
  { name: 'Replace “Click here” with the destination or result.', pattern: /(['"`])[^'"`\n]*\bclick here\b[^'"`\n]*\1/gi },
  { name: 'Replace system-focused authentication errors.', pattern: /Invalid credentials|User does not exist(?: in database)?/gi },
  { name: 'Replace database-style empty states.', pattern: /No records found|Create new customer/gi },
  { name: 'Write “and”, not an ampersand, in UI copy.', pattern: /(['"`])[^'"`\n]*\s&\s[^'"`\n]*\1/g },
];

const globalRules = [
  {
    name: 'Replace generic failure copy with the failed action, recovery step and support reference.',
    pattern: /An unexpected internal error occurred\.?|An unexpected error occurred\.?/gi,
  },
];

const audits = [
  { root: webRoot, rules: webRules },
  { root: appsRoot, rules: globalRules },
  { root: packagesRoot, rules: globalRules },
];

const violations = [];
for (const audit of audits) {
  for (const file of sourceFiles(audit.root)) {
    const source = readFileSync(file, 'utf8');
    for (const rule of audit.rules) {
      rule.pattern.lastIndex = 0;
      for (const match of source.matchAll(rule.pattern)) {
        const line = source.slice(0, match.index).split('\n').length;
        violations.push({
          file: path.relative(repositoryRoot, file),
          line,
          rule: rule.name,
          found: match[0],
        });
      }
    }
  }
}

if (violations.length) {
  const selected = violations.slice(offset, offset + limit);
  console.error(`UX writing audit found ${violations.length} violation(s). Showing ${offset + 1}-${Math.min(offset + selected.length, violations.length)}:`);
  for (const violation of selected) {
    console.error(`${violation.file}:${violation.line} — ${violation.rule}`);
    console.error(`  ${JSON.stringify(violation.found)}`);
  }
  process.exitCode = 1;
} else {
  console.log('UX writing audit passed.');
}
