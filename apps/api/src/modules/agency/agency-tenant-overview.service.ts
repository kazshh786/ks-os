import { and, asc, desc, eq } from 'drizzle-orm';
import {
  getDatabase,
  platformAuditEvents,
  platformFailedJobs,
  platformIncidents,
  tenantOnboarding,
  tenantOnboardingStages,
  tenants,
} from '@ks-os/database';
import type { DashboardOverviewQuery } from '@ks-os/contracts';
import { AnalyticsService } from '../analytics/analytics.service.js';

const percentage = (value: number, total: number) => total > 0
  ? Math.round((value / total) * 1000) / 10
  : null;

export class AgencyTenantOverviewService {
  private db = getDatabase();
  private analytics = new AnalyticsService();

  async overview(tenantId: string, query: DashboardOverviewQuery) {
    const [tenant] = await this.db.select({
      id: tenants.id,
      name: tenants.name,
      subdomain: tenants.subdomain,
      lifecycleStatus: tenants.lifecycleStatus,
      launchedAt: tenants.launchedAt,
      timezone: tenants.timezone,
      currency: tenants.currency,
    }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);

    if (!tenant) {
      throw Object.assign(new Error('Tenant not found.'), {
        statusCode: 404,
        code: 'TENANT_NOT_FOUND',
      });
    }

    const [analytics, onboardingRows, stages, latestErrors, supportCases, recentActivity] = await Promise.all([
      this.analytics.overview(tenantId, query),
      this.db.select({
        status: tenantOnboarding.status,
        completionPercentage: tenantOnboarding.completionPercentage,
        currentStage: tenantOnboarding.currentStage,
        targetLaunchAt: tenantOnboarding.targetLaunchAt,
        nextAction: tenantOnboarding.nextAction,
        updatedAt: tenantOnboarding.updatedAt,
      }).from(tenantOnboarding).where(eq(tenantOnboarding.tenantId, tenantId)).limit(1),
      this.db.select({
        stageKey: tenantOnboardingStages.stageKey,
        sequence: tenantOnboardingStages.sequence,
        status: tenantOnboardingStages.status,
        blockerNote: tenantOnboardingStages.blockerNote,
        dueAt: tenantOnboardingStages.dueAt,
      }).from(tenantOnboardingStages)
        .where(eq(tenantOnboardingStages.tenantId, tenantId))
        .orderBy(asc(tenantOnboardingStages.sequence)),
      this.db.select({
        id: platformFailedJobs.id,
        jobType: platformFailedJobs.jobType,
        failureCode: platformFailedJobs.failureCode,
        status: platformFailedJobs.status,
        attemptCount: platformFailedJobs.attemptCount,
        lastFailedAt: platformFailedJobs.lastFailedAt,
      }).from(platformFailedJobs)
        .where(and(eq(platformFailedJobs.tenantId, tenantId), eq(platformFailedJobs.status, 'FAILED')))
        .orderBy(desc(platformFailedJobs.lastFailedAt))
        .limit(5),
      this.db.select({
        id: platformIncidents.id,
        severity: platformIncidents.severity,
        status: platformIncidents.status,
        title: platformIncidents.title,
        summary: platformIncidents.summary,
        startedAt: platformIncidents.startedAt,
      }).from(platformIncidents)
        .where(and(eq(platformIncidents.tenantId, tenantId), eq(platformIncidents.status, 'OPEN')))
        .orderBy(desc(platformIncidents.startedAt))
        .limit(10),
      this.db.select({
        id: platformAuditEvents.id,
        action: platformAuditEvents.action,
        targetType: platformAuditEvents.targetType,
        outcome: platformAuditEvents.outcome,
        description: platformAuditEvents.description,
        eventCategory: platformAuditEvents.eventCategory,
        occurredAt: platformAuditEvents.occurredAt,
      }).from(platformAuditEvents)
        .where(eq(platformAuditEvents.tenantId, tenantId))
        .orderBy(desc(platformAuditEvents.occurredAt))
        .limit(8),
    ]);

    const totalBookings = analytics.bookings.total.value;
    const completedBookings = analytics.bookings.completed.value;
    const cancelledBookings = analytics.bookings.cancelled.value;
    const noShowBookings = analytics.bookings.noShow.value;
    const otherBookings = Math.max(0, totalBookings - completedBookings - cancelledBookings - noShowBookings);

    return {
      tenant,
      analytics,
      onboarding: {
        ...(onboardingRows[0] ?? {
          status: 'NOT_STARTED',
          completionPercentage: 0,
          currentStage: 'SALE_HANDOVER',
          targetLaunchAt: null,
          nextAction: null,
          updatedAt: null,
        }),
        stages,
        blockers: stages.filter(stage => stage.status === 'BLOCKED' || Boolean(stage.blockerNote)),
      },
      conversionProxy: {
        source: 'BOOKING_OUTCOMES',
        eligibleBookings: totalBookings,
        completedBookings,
        completionRate: percentage(completedBookings, totalBookings),
        dropOffRate: percentage(totalBookings - completedBookings, totalBookings),
        outcomes: [
          { key: 'COMPLETED', label: 'Completed', value: completedBookings, percentage: percentage(completedBookings, totalBookings) },
          { key: 'CANCELLED', label: 'Cancelled', value: cancelledBookings, percentage: percentage(cancelledBookings, totalBookings) },
          { key: 'NO_SHOW', label: 'No-show', value: noShowBookings, percentage: percentage(noShowBookings, totalBookings) },
          { key: 'OPEN_OR_OTHER', label: 'Open or other', value: otherBookings, percentage: percentage(otherBookings, totalBookings) },
        ],
        limitation: 'This is a booking-outcome conversion proxy. Anonymous booking-page views and abandoned booking steps are not yet captured.',
      },
      latestErrors,
      supportCases,
      recentActivity,
      generatedAt: new Date().toISOString(),
    };
  }
}
