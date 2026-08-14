import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  PageSeoBriefSchema,
  SearchIntelligenceStrategyV2Schema,
  pageSeoBriefDigest,
  searchStrategyDigest,
} from '@ks-os/site-generation';
import { SiteJobExecutionError } from '@ks-os/site-jobs';
import { buildBlueprintSearchIntelligenceDraft } from '../../api/src/modules/sites/search-intelligence-draft.js';
import { loadPinnedSearchIntelligence } from '../src/postgres-generation-executor.js';

const now = '2026-08-14T12:00:00.000Z';
const digest = 'a'.repeat(64);

function governedBundle() {
  const tenantId = randomUUID();
  const siteId = randomUUID();
  const siteReference = randomUUID();
  const blueprintId = randomUUID();
  const blueprintReference = randomUUID();
  const strategyId = randomUUID();
  const agencyUserReference = randomUUID();
  const evidenceReference = randomUUID();
  const blueprintPages = [
    { reference: randomUUID(), pageType: 'HOME', title: 'Home', proposedSlug: '/', sortOrder: 0 },
    { reference: randomUUID(), pageType: 'SERVICE_DETAIL', title: 'Signature Service', proposedSlug: 'signature-service', sortOrder: 1 },
  ];
  const draft = buildBlueprintSearchIntelligenceDraft({
    siteReference,
    blueprintReference,
    blueprintRevision: 3,
    strategyVersion: 1,
    generatedByAgencyUserReference: agencyUserReference,
    generatedAt: now,
    pages: blueprintPages,
  });
  const strategyWithoutDigest = SearchIntelligenceStrategyV2Schema.parse({
    ...draft.strategy,
    status: 'APPROVED',
    serpAnalyses: [{
      reference: randomUUID(),
      evidenceReference,
      query: 'signature service london',
      location: 'London',
      language: 'en-GB',
      device: 'DESKTOP',
      capturedAt: now,
      organicResultTypes: ['Service landing pages'],
      localPackPresent: true,
      aiOverviewObserved: false,
      featuredSnippetObserved: false,
      peopleAlsoAskObserved: true,
      videoResultsObserved: false,
      imageResultsObserved: false,
      shoppingResultsObserved: false,
      discussionResultsObserved: false,
      dominantContentFormats: ['Service landing page'],
      dominantIntent: 'COMMERCIAL_INVESTIGATION',
      commonEntities: ['Example Studio'],
      commonSubtopics: ['Booking'],
      contentDepthPatterns: ['Detailed service explanations'],
      authorityPatterns: ['Named business and clear contact details'],
    }],
    provenance: {
      ...draft.strategy.provenance,
      providerKey: 'governed-search-import',
      modelKey: 'approved-research-v1',
      researchDigestSha256: digest,
      outputDigestSha256: '0'.repeat(64),
      researchEvidenceReferences: [evidenceReference],
    },
    approvedAt: now,
    approvedByAgencyUserReference: agencyUserReference,
  });
  const strategy = SearchIntelligenceStrategyV2Schema.parse({
    ...strategyWithoutDigest,
    provenance: {
      ...strategyWithoutDigest.provenance,
      outputDigestSha256: searchStrategyDigest(strategyWithoutDigest),
    },
  });
  const briefs = draft.briefs.map(value => {
    const briefWithoutDigest = PageSeoBriefSchema.parse({
      ...value,
      status: 'APPROVED',
      provenance: {
        ...value.provenance,
        providerKey: strategy.provenance.providerKey,
        modelKey: strategy.provenance.modelKey,
        researchDigestSha256: strategy.provenance.researchDigestSha256,
        outputDigestSha256: '0'.repeat(64),
        researchEvidenceReferences: [evidenceReference],
        strategyDigestSha256: strategy.provenance.outputDigestSha256,
      },
      approvedAt: now,
      approvedByAgencyUserReference: agencyUserReference,
    });
    return PageSeoBriefSchema.parse({
      ...briefWithoutDigest,
      provenance: {
        ...briefWithoutDigest.provenance,
        outputDigestSha256: pageSeoBriefDigest(briefWithoutDigest),
      },
    });
  });
  const strategyDigestSha256 = searchStrategyDigest(strategy);
  const strategyRow = {
    value: strategy,
    status: 'APPROVED',
    version: 1,
    digestSha256: strategyDigestSha256,
  };
  const evidenceRow = {
    tenantId,
    siteId,
    strategyId,
    reference: evidenceReference,
    providerKey: 'governed-search-import',
    query: 'signature service london',
    market: 'GB',
    locale: 'en-GB',
    location: 'London',
    language: 'en-GB',
    device: 'DESKTOP',
    capturedAt: new Date(now),
    expiresAt: new Date('2026-11-12T12:00:00.000Z'),
    sourceUrl: 'https://research.example.test/signature-service',
    sourceDigestSha256: digest,
    payloadDigestSha256: digest,
    notes: ['Approved governed research evidence.'],
  };
  return {
    run: {
      tenantId,
      siteId,
      blueprintId,
      searchStrategyId: strategyId,
      searchStrategyVersion: 1,
      searchStrategyDigestSha256: strategyDigestSha256,
    },
    pages: blueprintPages.map(page => ({ reference: page.reference, pageType: page.pageType })),
    strategy,
    strategyRow,
    briefRows: briefs.map(value => ({ value })),
    evidenceRow,
  };
}

function fakeDatabase(...results: readonly unknown[][]) {
  const pending = [...results];
  return {
    select() {
      const rows = pending.shift();
      if (!rows) throw new Error('Unexpected database query.');
      const query = {
        from() { return query; },
        where() { return query; },
        limit() { return Promise.resolve(rows); },
        then<TResult1 = unknown[], TResult2 = never>(
          onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return Promise.resolve(rows).then(onfulfilled, onrejected);
        },
      };
      return query;
    },
  };
}

async function expectTerminalDataMissing(promise: Promise<unknown>) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof SiteJobExecutionError);
    assert.equal(error.code, 'TERMINAL_DATA_MISSING');
    return true;
  });
}

test('approved worker Search Intelligence preparation loads and preserves governed evidence', async () => {
  const fixture = governedBundle();
  const database = fakeDatabase(
    [fixture.strategyRow],
    fixture.briefRows,
    [fixture.evidenceRow],
  );

  const result = await loadPinnedSearchIntelligence(
    database as never,
    fixture.run,
    fixture.pages,
  );

  assert.equal(result.strategy.reference, fixture.strategy.reference);
  assert.equal(result.briefs.length, fixture.pages.length);
  assert.deepEqual(result.evidence, [{
    reference: fixture.evidenceRow.reference,
    providerKey: fixture.evidenceRow.providerKey,
    query: fixture.evidenceRow.query,
    market: fixture.evidenceRow.market,
    locale: fixture.evidenceRow.locale,
    location: fixture.evidenceRow.location,
    language: fixture.evidenceRow.language,
    device: fixture.evidenceRow.device,
    capturedAt: fixture.evidenceRow.capturedAt.toISOString(),
    expiresAt: fixture.evidenceRow.expiresAt.toISOString(),
    sourceUrl: fixture.evidenceRow.sourceUrl,
    sourceDigestSha256: fixture.evidenceRow.sourceDigestSha256,
    payloadDigestSha256: fixture.evidenceRow.payloadDigestSha256,
    notes: fixture.evidenceRow.notes,
  }]);
});

test('worker Search Intelligence preparation fails when required research evidence is absent', async () => {
  const fixture = governedBundle();
  await expectTerminalDataMissing(loadPinnedSearchIntelligence(
    fakeDatabase([fixture.strategyRow], fixture.briefRows, []) as never,
    fixture.run,
    fixture.pages,
  ));
});

test('evidence from another tenant, site, or strategy cannot satisfy worker validation', async () => {
  for (const ownerKey of ['tenantId', 'siteId', 'strategyId'] as const) {
    const fixture = governedBundle();
    const foreignEvidence = { ...fixture.evidenceRow, [ownerKey]: randomUUID() };
    await expectTerminalDataMissing(loadPinnedSearchIntelligence(
      fakeDatabase([fixture.strategyRow], fixture.briefRows, [foreignEvidence]) as never,
      fixture.run,
      fixture.pages,
    ));
  }
});

test('worker preparation retains blueprint-page, brief provenance, and strategy digest checks', async () => {
  const identityFixture = governedBundle();
  const mismatchedBrief = PageSeoBriefSchema.parse({
    ...identityFixture.briefRows[0]!.value,
    blueprintPageReference: randomUUID(),
  });
  await expectTerminalDataMissing(loadPinnedSearchIntelligence(
    fakeDatabase(
      [identityFixture.strategyRow],
      [{ value: mismatchedBrief }, ...identityFixture.briefRows.slice(1)],
      [identityFixture.evidenceRow],
    ) as never,
    identityFixture.run,
    identityFixture.pages,
  ));

  const provenanceFixture = governedBundle();
  const staleBrief = PageSeoBriefSchema.parse({
    ...provenanceFixture.briefRows[0]!.value,
    provenance: {
      ...provenanceFixture.briefRows[0]!.value.provenance,
      strategyDigestSha256: 'b'.repeat(64),
    },
  });
  await expectTerminalDataMissing(loadPinnedSearchIntelligence(
    fakeDatabase(
      [provenanceFixture.strategyRow],
      [{ value: staleBrief }, ...provenanceFixture.briefRows.slice(1)],
      [provenanceFixture.evidenceRow],
    ) as never,
    provenanceFixture.run,
    provenanceFixture.pages,
  ));

  const digestFixture = governedBundle();
  const changedStrategy = SearchIntelligenceStrategyV2Schema.parse({
    ...digestFixture.strategy,
    targetAudience: {
      segments: digestFixture.strategy.targetAudience.segments.map(segment => ({
        ...segment,
        name: `${segment.name} changed`,
      })),
    },
  });
  await expectTerminalDataMissing(loadPinnedSearchIntelligence(
    fakeDatabase(
      [{ ...digestFixture.strategyRow, value: changedStrategy }],
      digestFixture.briefRows,
      [digestFixture.evidenceRow],
    ) as never,
    digestFixture.run,
    digestFixture.pages,
  ));
});
