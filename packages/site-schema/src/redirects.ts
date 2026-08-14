export interface GovernedPathRedirect {
  sourcePath: string;
  targetPath: string;
  active: boolean;
}

export interface PathRedirectGraphFinding {
  code: 'REDIRECT_SELF_REFERENCE' | 'REDIRECT_CHAIN' | 'REDIRECT_CYCLE';
  sourcePath: string;
  message: string;
}

export function validatePathRedirectGraph(
  redirects: readonly GovernedPathRedirect[],
): PathRedirectGraphFinding[] {
  const findings: PathRedirectGraphFinding[] = [];
  const active = redirects.filter(redirect => redirect.active);
  const targetBySource = new Map(active.map(redirect => [redirect.sourcePath, redirect.targetPath]));
  for (const redirect of active) {
    if (redirect.sourcePath === redirect.targetPath) {
      findings.push({
        code: 'REDIRECT_SELF_REFERENCE',
        sourcePath: redirect.sourcePath,
        message: 'A redirect source and target must differ.',
      });
      continue;
    }
    const visited = new Set([redirect.sourcePath]);
    let target = redirect.targetPath;
    let chained = false;
    while (targetBySource.has(target)) {
      chained = true;
      if (visited.has(target)) {
        findings.push({
          code: 'REDIRECT_CYCLE',
          sourcePath: redirect.sourcePath,
          message: 'An active redirect cannot participate in a cycle.',
        });
        break;
      }
      visited.add(target);
      const nextTarget = targetBySource.get(target);
      if (!nextTarget) break;
      target = nextTarget;
    }
    if (chained && !findings.some(finding =>
      finding.sourcePath === redirect.sourcePath && finding.code === 'REDIRECT_CYCLE')) {
      findings.push({
        code: 'REDIRECT_CHAIN',
        sourcePath: redirect.sourcePath,
        message: 'An active redirect target cannot itself be an active redirect source.',
      });
    }
  }
  return findings;
}

export function assertValidPathRedirectGraph(
  redirects: readonly GovernedPathRedirect[],
): void {
  const findings = validatePathRedirectGraph(redirects);
  if (findings.length) throw new Error(findings.map(finding => finding.code).join(','));
}
