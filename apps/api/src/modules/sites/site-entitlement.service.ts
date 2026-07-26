import {
  calculateSiteEntitlementSummary,
  type SiteEntitlementSummary,
} from '@ks-os/contracts';
import {
  getDatabase,
  platformPlanEntitlements,
  platformPlans,
  platformPlanVersions,
  sitePages,
  tenantEntitlementOverrides,
  tenantPlanAssignments,
} from '@ks-os/database';
import { and, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';

type Database = ReturnType<typeof getDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type SiteDatabaseExecutor = Database | Transaction;

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

export class SiteEntitlementService {
  constructor(private readonly db = getDatabase()) {}

  async forVersion(
    tenantId: string,
    siteId: string,
    versionId: string,
    now = new Date(),
    executor: SiteDatabaseExecutor = this.db,
  ): Promise<SiteEntitlementSummary> {
    const [assignment] = await executor
      .select({
        planKey: platformPlans.key,
      })
      .from(tenantPlanAssignments)
      .innerJoin(
        platformPlanVersions,
        eq(tenantPlanAssignments.planVersionId, platformPlanVersions.id),
      )
      .innerJoin(platformPlans, eq(platformPlanVersions.planId, platformPlans.id))
      .where(and(
        eq(tenantPlanAssignments.tenantId, tenantId),
        eq(tenantPlanAssignments.status, 'ACTIVE'),
        lte(tenantPlanAssignments.startsAt, now),
        or(
          isNull(tenantPlanAssignments.endsAt),
          gt(tenantPlanAssignments.endsAt, now),
        ),
      ))
      .orderBy(sql`${tenantPlanAssignments.startsAt} DESC`)
      .limit(1);

    if (!assignment || !['CORE', 'GROWTH', 'SCALE'].includes(assignment.planKey)) {
      throw fail(
        409,
        'SITE_PLAN_ASSIGNMENT_REQUIRED',
        'An active Core, Growth or Scale plan assignment is required.',
      );
    }

    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const [usage] = await executor
      .select({
        initialUsed: sql<number>`
          count(*) filter (
            where ${sitePages.entitlementKind} = 'MARKETING'
              and ${sitePages.allocation} = 'INITIAL'
              and ${sitePages.archivedAt} is null
          )::int
        `,
        monthlyUsed: sql<number>`
          count(*) filter (
            where ${sitePages.entitlementKind} = 'MARKETING'
              and ${sitePages.allocation} = 'MONTHLY'
              and ${sitePages.createdAt} >= ${periodStart}
              and ${sitePages.createdAt} < ${periodEnd}
              and ${sitePages.archivedAt} is null
          )::int
        `,
      })
      .from(sitePages)
      .where(and(
        eq(sitePages.tenantId, tenantId),
        eq(sitePages.siteId, siteId),
        eq(sitePages.versionId, versionId),
      ));

    return calculateSiteEntitlementSummary({
      planKey: assignment.planKey as 'CORE' | 'GROWTH' | 'SCALE',
      initialMarketingPagesUsed: Number(usage?.initialUsed || 0),
      monthlyMarketingPagesUsed: Number(usage?.monthlyUsed || 0),
      now,
    });
  }

  async activePlanAssignment(
    tenantId: string,
    now = new Date(),
    executor: SiteDatabaseExecutor = this.db,
  ) {
    const [assignment] = await executor
      .select({
        id: tenantPlanAssignments.id,
        planKey: platformPlans.key,
      })
      .from(tenantPlanAssignments)
      .innerJoin(
        platformPlanVersions,
        eq(tenantPlanAssignments.planVersionId, platformPlanVersions.id),
      )
      .innerJoin(platformPlans, eq(platformPlanVersions.planId, platformPlans.id))
      .where(and(
        eq(tenantPlanAssignments.tenantId, tenantId),
        eq(tenantPlanAssignments.status, 'ACTIVE'),
        lte(tenantPlanAssignments.startsAt, now),
        or(
          isNull(tenantPlanAssignments.endsAt),
          gt(tenantPlanAssignments.endsAt, now),
        ),
      ))
      .orderBy(sql`${tenantPlanAssignments.startsAt} DESC`)
      .limit(1);

    if (!assignment || !['CORE', 'GROWTH', 'SCALE'].includes(assignment.planKey)) {
      throw fail(
        409,
        'SITE_PLAN_ASSIGNMENT_REQUIRED',
        'An active Core, Growth or Scale plan assignment is required.',
      );
    }
    return {
      id: assignment.id,
      planKey: assignment.planKey as 'CORE' | 'GROWTH' | 'SCALE',
    };
  }

  async blueprintMarketingAllowance(
    tenantId: string,
    now = new Date(),
    executor: SiteDatabaseExecutor = this.db,
  ) {
    const assignment = await this.activePlanAssignment(tenantId, now, executor);
    const [entitlement] = await executor
      .select({ value: platformPlanEntitlements.valueJson })
      .from(tenantPlanAssignments)
      .innerJoin(
        platformPlanEntitlements,
        eq(
          platformPlanEntitlements.planVersionId,
          tenantPlanAssignments.planVersionId,
        ),
      )
      .where(and(
        eq(tenantPlanAssignments.id, assignment.id),
        eq(
          platformPlanEntitlements.entitlementKey,
          'sites.initial_marketing_pages',
        ),
      ))
      .limit(1);
    const baseValue = entitlement?.value as { limit?: unknown } | undefined;
    const baseLimit = Number(baseValue?.limit);
    if (!Number.isInteger(baseLimit) || baseLimit < 0 || baseLimit > 10_000) {
      throw fail(
        409,
        'SITE_BLUEPRINT_ENTITLEMENT_REQUIRED',
        'The active plan has no valid initial marketing-page entitlement.',
      );
    }
    const [override] = await executor
      .select({ value: tenantEntitlementOverrides.valueJson })
      .from(tenantEntitlementOverrides)
      .where(and(
        eq(tenantEntitlementOverrides.tenantId, tenantId),
        eq(
          tenantEntitlementOverrides.entitlementKey,
          'sites.initial_marketing_pages',
        ),
        lte(tenantEntitlementOverrides.startsAt, now),
        gt(tenantEntitlementOverrides.expiresAt, now),
        isNull(tenantEntitlementOverrides.revokedAt),
      ))
      .orderBy(desc(tenantEntitlementOverrides.createdAt))
      .limit(1);
    const overrideValue = override?.value as { limit?: unknown } | undefined;
    const overrideLimit = Number(overrideValue?.limit);
    const overrideApplied = Boolean(
      override
      && Number.isInteger(overrideLimit)
      && overrideLimit >= 0
      && overrideLimit <= 10_000,
    );
    return {
      ...assignment,
      marketingPageLimit: overrideApplied ? overrideLimit : baseLimit,
      overrideApplied,
    };
  }
}
