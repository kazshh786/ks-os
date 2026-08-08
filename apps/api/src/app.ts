import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import registerSecurity from './plugins/security.js';
import registerRequestContext from './plugins/request-context.js';
import registerErrorHandler from './plugins/error-handler.js';
import registerPublicServiceCatalogOrder from './plugins/public-service-catalog-order.js';
import registerRoutes from './routes/health.js';
import authPlugin from './plugins/auth.js';
import sessionRoutes from './routes/session.js';
import workspaceRoutes from './routes/workspace.js';
import servicesRoutes from './routes/services.js';
import staffRoutes from './routes/staff.js';
import bookingsRoutes from './modules/bookings/booking.routes.js';
import dashboardRoutes from './routes/dashboard.js';
import publicBookingRoutes from './routes/public/booking.js';
import publicAvailabilitySummaryRoutes from './routes/public/availability-summary.js';
import clientsRoutes from './routes/clients.js';
import posModuleRoutes from './modules/pos/index.js';
import fastifyRawBody from 'fastify-raw-body';
import { stripeRoutes, stripeAdminRoutes } from './modules/integrations/stripe/stripe.routes.js';
import { stripeWebhookRoutes } from './modules/webhooks/stripe/stripe-webhook.routes.js';
import { paymentRoutes } from './modules/payments/payments.routes.js';
import { financeRoutes } from './modules/finance/finance.routes.js';
import { resendWebhookRoutes } from './modules/webhooks/resend/resend-webhook.routes.js';
import { metaWebhookRoutes } from './modules/webhooks/meta/meta-webhook.routes.js';
import { emailRoutes } from './modules/email/email.routes.js';
import { automationActionRoutes, automationRoutes, automationRunRoutes, automationWorkerRoutes } from './modules/automations/automation.routes.js';
import formbody from '@fastify/formbody';
import { smsRoutes } from './modules/sms/sms.routes.js';
import { twilioWebhookRoutes } from './modules/webhooks/twilio/twilio-webhook.routes.js';
import { formAssignmentRoutes, formSubmissionRoutes, formsRoutes, publicFormRoutes, relatedFormAssignmentRoutes } from './modules/forms/forms.routes.js';
import { teamInvitationAcceptanceRoutes, teamRoutes } from './modules/team/team.routes.js';
import reportsRoutes from './modules/reports/reports.routes.js';
import { teamOperationsRoutes } from './modules/team-operations/team-operations.routes.js';
import { operationsReconciliationRoutes, operationsRoutes } from './modules/operations/operations.routes.js';
import { conversationRoutes } from './modules/conversations/conversation.routes.js';
import { reportingRoutes, reportingWorkerRoutes } from './modules/reporting/reporting.routes.js';
import advancedAnalyticsRoutes from './modules/analytics/advanced-analytics.routes.js';
import { taskRoutes, taskWorkerRoutes } from './modules/tasks/task.routes.js';
import { customerPortalRoutes } from './modules/customer-portal/customer-portal.routes.js';
import { customerBookingPolicyRoutes } from './modules/customer-portal/customer-booking-policy.routes.js';
import { customerReviewInvitationRoutes, publicReputationRoutes, reputationRoutes, reviewOauthCallbackRoutes } from './modules/reputation/reputation.routes.js';
import { agencyRoutes, agencyWorkerRoutes, goCardlessWebhookRoutes, managedServiceTenantRoutes } from './modules/agency/agency.routes.js';
import { authenticationRoutes } from './modules/authentication/authentication.routes.js';
import { env } from './config/env.js';
import { complianceRoutes, complianceWorkerRoutes } from './modules/agency/compliance.routes.js';
import { externalApiRoutes, integrationRoutes, publicCalendarRoutes } from './modules/integrations/integrations.routes.js';
import { bookingPageSettingsRoutes } from './modules/bookings/booking-page.routes.js';
import { agencySiteRoutes } from './modules/sites/site.routes.js';
import { agencyTemplateIntelligenceRoutes } from './modules/sites/template-intelligence.routes.js';
import { agencyDesignLibraryRoutes } from './modules/sites/design-library.routes.js';
import { agencySiteBlueprintRoutes } from './modules/sites/site-blueprint.routes.js';
import { agencySiteJobRoutes } from './modules/sites/site-job.routes.js';
import { agencyKnowledgePackRoutes } from './modules/sites/knowledge-pack.routes.js';
import { agencySiteGenerationRoutes } from './modules/sites/site-generation.routes.js';
import { agencySiteReviewRoutes } from './modules/sites/site-review.routes.js';
import { publicSiteReviewRoutes } from './routes/public/site-review.js';
import { publicFactFindingRoutes } from './routes/public/fact-finding.js';
import { agencyFactFindingRoutes } from './modules/provisioning/fact-finding.routes.js';
import { agencyProvisioningRoutes } from './modules/provisioning/provisioning.routes.js';
import { agencySiteStudioRoutes } from './modules/sites/site-studio.routes.js';
import { agencySiteQualityRoutes } from './modules/sites/site-quality.routes.js';
import { agencySitePublicationRoutes } from './modules/sites/site-publication.routes.js';
import { agencyProductionBriefRoutes } from './modules/provisioning/production-brief.routes.js';
import { platformErrorLogRoutes } from './modules/errors/platform-error-log.routes.js';
import { agencyDeploymentRoutes } from './modules/deployments/deployment.routes.js';

export function buildApp(options: { beforeRegister?: (app: FastifyInstance) => void } = {}) {
  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: [
        'req.headers.authorization',
        'req.headers["x-ks-support-session"]',
        'req.headers["x-site-review-session"]',
        'req.headers["x-fact-finding-session"]',
        'req.headers.cookie',
        'req.headers["set-cookie"]',
        'req.body.client.name',
        'req.body.client.email',
        'req.body.client.phone',
        'req.body.mobileAddress',
        'req.body.internalNote',
        'req.body.purchasedProducts[*].notes',
        'req.body.cardDetails',
        'req.body.password',
        'req.body.newPassword',
        'req.body.confirmPassword',
        'req.body.code',
        'req.body.factorId',
        'req.body.answers',
        'req.body.acknowledgement',
        'req.body.reasonText',
        'req.body.invitationToken',
        'req.params.token',
        'req.url',
        '*.email',
        '*.phone',
        '*.medicalNotes',
        '*.authorization',
        '*.x-ks-support-session',
        '*.x-site-review-session',
        '*.x-fact-finding-session',
        '*.cookie',
        '*.cardDetails',
        '*.password',
        '*.newPassword',
        '*.confirmPassword',
        '*.code',
        '*.factorId',
        '*.qr_code',
        '*.token',
        '*.invitationToken',
        '*.sessionToken',
        '*.previewUrl',
        'res.body'
      ]
    },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1048576
  });

  options.beforeRegister?.(fastify);

  fastify.register(fastifyRawBody, {
    global: false,
    runFirst: true,
    routes: ['/api/v1/webhooks/resend', '/api/v1/webhooks/gocardless', '/api/v1/webhooks/meta'],
    encoding: 'utf8',
  });
  fastify.register(formbody);

  fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute'
  });

  registerErrorHandler(fastify);
  fastify.register(registerSecurity);
  fastify.register(registerRequestContext);
  registerPublicServiceCatalogOrder(fastify);

  fastify.register(publicBookingRoutes, { prefix: '/api/v1/public' });
  fastify.register(publicAvailabilitySummaryRoutes, { prefix: '/api/v1/public' });
  fastify.register(publicCalendarRoutes, { prefix: '/api/v1/public' });
  fastify.register(publicFormRoutes, { prefix: '/api/v1/public/forms' });
  fastify.register(publicReputationRoutes, { prefix: '/api/v1/public/review-invitations' });
  fastify.register(reviewOauthCallbackRoutes, { prefix: '/api/v1/reputation/connections' });
  fastify.register(teamInvitationAcceptanceRoutes, { prefix: '/api/v1/team/invitations' });
  fastify.register(publicSiteReviewRoutes, { prefix: '/api/v1/site-review' });
  fastify.register(publicFactFindingRoutes, { prefix: '/api/v1/fact-finding' });
  fastify.register(metaWebhookRoutes, { prefix: '/api/v1/webhooks/meta' });

  fastify.register(authPlugin);
  fastify.register(authenticationRoutes);

  fastify.register(agencyRoutes, { prefix: '/api/v1/agency' });
  fastify.register(agencyDeploymentRoutes, { prefix: '/api/v1/agency' });
  fastify.register(platformErrorLogRoutes, { prefix: '/api/v1/agency/errors' });
  fastify.register(complianceRoutes, { prefix: '/api/v1/agency' });
  fastify.register(agencySiteRoutes, { prefix: '/api/v1/agency/sites' });
  fastify.register(agencySiteBlueprintRoutes, { prefix: '/api/v1/agency/sites' });
  fastify.register(agencySiteJobRoutes, { prefix: '/api/v1/agency' });
  fastify.register(agencyKnowledgePackRoutes, { prefix: '/api/v1/agency' });
  fastify.register(agencySiteGenerationRoutes, { prefix: '/api/v1/agency/sites' });
  fastify.register(agencySiteReviewRoutes, { prefix: '/api/v1/agency/sites' });
  fastify.register(agencyTemplateIntelligenceRoutes, { prefix: '/api/v1/agency' });
  fastify.register(agencyDesignLibraryRoutes, { prefix: '/api/v1/agency' });
  fastify.register(agencyFactFindingRoutes, { prefix: '/api/v1/agency/fact-finding' });
  fastify.register(agencyProvisioningRoutes, { prefix: '/api/v1/agency' });
  fastify.register(agencySiteStudioRoutes, { prefix: '/api/v1/agency/sites' });
  fastify.register(agencySiteQualityRoutes, { prefix: '/api/v1/agency/sites' });
  fastify.register(agencySitePublicationRoutes, { prefix: '/api/v1/agency/sites' });
  fastify.register(agencyProductionBriefRoutes, { prefix: '/api/v1/agency' });
  fastify.register(goCardlessWebhookRoutes, { prefix: '/api/v1/webhooks/gocardless' });
  fastify.register(managedServiceTenantRoutes, { prefix: '/api/v1/managed-services' });
  fastify.register(agencyWorkerRoutes, { prefix: '/api/v1/internal/agency-worker' });
  fastify.register(complianceWorkerRoutes, { prefix: '/api/v1/internal/privacy-worker' });

  fastify.register(customerPortalRoutes, { prefix: '/api/v1/customer' });
  fastify.register(customerReviewInvitationRoutes, { prefix: '/api/v1/customer/review-invitations' });
  fastify.register(customerBookingPolicyRoutes, { prefix: '/api/v1/settings/booking/customer-management' });

  fastify.register(registerRoutes);
  fastify.register(sessionRoutes);
  fastify.register(workspaceRoutes);
  fastify.register(servicesRoutes);
  fastify.register(staffRoutes);
  fastify.register(bookingsRoutes);
  fastify.register(bookingPageSettingsRoutes);
  fastify.register(dashboardRoutes);
  fastify.register(clientsRoutes);
  fastify.register(posModuleRoutes);
  fastify.register(stripeRoutes, { prefix: '/api/v1/integrations/stripe' });
  fastify.register(stripeAdminRoutes, { prefix: '/api/v1/admin/integrations/stripe' });
  fastify.register(stripeWebhookRoutes, { prefix: '/api/v1/webhooks/stripe' });
  fastify.register(resendWebhookRoutes, { prefix: '/api/v1/webhooks/resend' });
  fastify.register(paymentRoutes, { prefix: '/api/v1/payments' });
  fastify.register(financeRoutes, { prefix: '/api/v1/finance' });
  fastify.register(emailRoutes, { prefix: '/api/v1/communications' });
  fastify.register(automationRoutes, { prefix: '/api/v1/automations' });
  fastify.register(automationRunRoutes, { prefix: '/api/v1/automation-runs' });
  fastify.register(automationActionRoutes, { prefix: '/api/v1/automation-actions' });
  fastify.register(automationWorkerRoutes, { prefix: '/api/v1/internal/automation-worker' });
  fastify.register(smsRoutes, { prefix: '/api/v1/communications/sms' });
  fastify.register(twilioWebhookRoutes, { prefix: '/api/v1/webhooks/twilio' });
  fastify.register(formsRoutes, { prefix: '/api/v1/forms' });
  fastify.register(formAssignmentRoutes, { prefix: '/api/v1/form-assignments' });
  fastify.register(formSubmissionRoutes, { prefix: '/api/v1/form-submissions' });
  fastify.register(relatedFormAssignmentRoutes, { prefix: '/api/v1' });
  fastify.register(teamRoutes, { prefix: '/api/v1/team' });
  fastify.register(reportsRoutes);
  fastify.register(teamOperationsRoutes, { prefix: '/api/v1' });
  fastify.register(operationsRoutes, { prefix: '/api/v1/operations/issues' });
  fastify.register(conversationRoutes, { prefix: '/api/v1/conversations' });
  fastify.register(operationsReconciliationRoutes, { prefix: '/api/v1/internal/operations-reconciliation' });
  fastify.register(reportingRoutes);
  fastify.register(reportingWorkerRoutes, { prefix: '/api/v1/internal/report-worker' });
  fastify.register(advancedAnalyticsRoutes);
  fastify.register(taskRoutes, { prefix: '/api/v1/tasks' });
  fastify.register(taskWorkerRoutes, { prefix: '/api/v1/internal/task-worker' });
  fastify.register(reputationRoutes, { prefix: '/api/v1/reputation' });
  fastify.register(integrationRoutes, { prefix: '/api/v1' });
  fastify.register(externalApiRoutes, { prefix: '/api/external/v1' });

  return fastify;
}
