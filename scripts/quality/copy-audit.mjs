import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const webRoot = path.resolve(process.cwd(), 'apps/web/src');

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

const rules = [
  { name: 'Use “Sign in”, not “Log in”.', pattern: /(['"`])Log in\1|>\s*Log in\s*</gi },
  { name: 'Use “Sign out”, not “Log out”.', pattern: /(['"`])Log out\1|>\s*Log out\s*</gi },
  { name: 'Use “Sign in”, not the noun “Login”.', pattern: /(['"`])Login\1|>\s*Login\s*</g },
  { name: 'Use “Sign out”, not the noun “Logout”.', pattern: /(['"`])Logout\1|>\s*Logout\s*</g },
  { name: 'Replace vague “Submit” buttons with the result.', pattern: /(['"`])Submit\1|>\s*Submit\s*</g },
  { name: 'Replace “Click here” with the destination or result.', pattern: /(['"`])Click here\1|>\s*Click here\s*</gi },
  { name: 'Replace system-focused authentication errors.', pattern: /Invalid credentials|User does not exist(?: in database)?/gi },
  { name: 'Replace database-style empty states.', pattern: /No records found|Create new customer/gi },
  { name: 'Write “and”, not an ampersand, in UI copy.', pattern: /(['"`])[^'"`\n]*\s&\s[^'"`\n]*\1/g },
];

const violations = [];
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

if (violations.length) {
  console.error(`UX writing audit found ${violations.length} violation(s):`);
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line} — ${violation.rule}`);
    console.error(`  ${JSON.stringify(violation.found)}`);
  }
  process.exitCode = 1;
} else {
  console.log('UX writing audit passed.');
}
