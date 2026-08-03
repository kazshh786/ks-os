export interface ComparableQualityFinding {
  reference: string;
  checkId: string;
  code: string;
  severity: 'INFO' | 'WARNING' | 'BLOCKING';
  status: string;
  pageReference?: string | null;
  fieldPath?: string | null;
}

const key = (finding: ComparableQualityFinding) => [
  finding.checkId,
  finding.code,
  finding.pageReference ?? '',
  finding.fieldPath ?? '',
].join(':');

export function compareQualityRuns(input: {
  left: {
    reference: string;
    tenantReference: string;
    siteReference: string;
    gateStatus: string;
    findings: readonly ComparableQualityFinding[];
  };
  right: {
    reference: string;
    tenantReference: string;
    siteReference: string;
    gateStatus: string;
    findings: readonly ComparableQualityFinding[];
  };
}) {
  if (
    input.left.tenantReference !== input.right.tenantReference
    || input.left.siteReference !== input.right.siteReference
  ) {
    throw Object.assign(
      new Error('Quality runs may only be compared within the same tenant and site.'),
      { code: 'SITE_QUALITY_COMPARISON_SCOPE_INVALID' },
    );
  }
  const left = new Map(input.left.findings.map((finding) => [key(finding), finding]));
  const right = new Map(input.right.findings.map((finding) => [key(finding), finding]));
  const newFindings = [...right].filter(([findingKey]) => !left.has(findingKey))
    .map(([, finding]) => finding);
  const resolvedFindings = [...left].filter(([findingKey]) => !right.has(findingKey))
    .map(([, finding]) => finding);
  const recurringFindings = [...right].filter(([findingKey]) => left.has(findingKey))
    .map(([, finding]) => finding);
  const severityChanges = recurringFindings.flatMap((finding) => {
    const previous = left.get(key(finding));
    return previous && previous.severity !== finding.severity
      ? [{
        findingKey: key(finding),
        from: previous.severity,
        to: finding.severity,
      }]
      : [];
  });
  return {
    leftRunReference: input.left.reference,
    rightRunReference: input.right.reference,
    newFindings,
    resolvedFindings,
    recurringFindings,
    severityChanges,
    publicationReadinessChanged:
      input.left.gateStatus !== input.right.gateStatus,
    fromGateStatus: input.left.gateStatus,
    toGateStatus: input.right.gateStatus,
  };
}
