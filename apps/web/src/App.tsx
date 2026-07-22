import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { WorkspaceProvider } from './context/WorkspaceContext.js';
import { AuthProvider, useAuth } from './auth';
import { ProtectedRoute, RoleRoute } from './auth';

// Layouts
import PublicBookingLayout from './layouts/PublicBookingLayout.js';
import StaffWorkspaceLayout from './layouts/StaffWorkspaceLayout.js';
import AgencyLayout from './layouts/AgencyLayout.js';

// Pages
import Login from './pages/Login.js';
import BookingWizardPage from './pages/BookingWizardPage.js';
import StaffCalendarPage from './pages/StaffCalendarPage.js';
import ReceptionPage from './pages/ReceptionPage.js';
import ClientCRMPage from './pages/ClientCRMPage.js';
import POSCheckoutPage from './pages/POSCheckoutPage.js';
import ConsentFormsPage from './pages/ConsentFormsPage.js';
import BrandSetupPage from './pages/BrandSetupPage.js';
import NotFoundPage from './pages/NotFoundPage.js';
import { ModuleConnectingState } from './components/ModuleConnectingState.js';
import { Payments } from './pages/settings/Payments.js';
import { StripeReturn } from './pages/settings/StripeReturn.js';
import { StripeRefresh } from './pages/settings/StripeRefresh.js';
import PaymentSuccess from './pages/book/PaymentSuccess.js';
import PaymentCancel from './pages/book/PaymentCancel.js';
import { PaymentHistoryPage } from './pages/payments/PaymentHistoryPage.js';
import { PaymentDetailPage } from './pages/payments/PaymentDetailPage.js';
import { FinanceOverviewPage } from './pages/finance/FinanceOverviewPage.js';
import { PayoutsListPage } from './pages/finance/PayoutsListPage.js';
import { PayoutDetailPage } from './pages/finance/PayoutDetailPage.js';
import { DisputesListPage } from './pages/finance/DisputesListPage.js';
import { DisputeDetailPage } from './pages/finance/DisputeDetailPage.js';
import { Communications } from './pages/settings/Communications.js';
import { EmailHistory } from './pages/settings/EmailHistory.js';
import SaaSDashboardPage from './pages/SaaSDashboardPage.js';
import { SmsSettings } from './pages/settings/SmsSettings.js';
import CustomerBookingManagementSettings from './pages/settings/CustomerBookingManagementSettings.js';
import FormEditorPage from './pages/FormEditorPage.js';
import FormDetailPage from './pages/FormDetailPage.js';
import FormVersionPage from './pages/FormVersionPage.js';
import FormSubmissionPage from './pages/FormSubmissionPage.js';
import PublicFormCompletionPage, { PublicFormSuccessPage } from './pages/PublicFormCompletionPage.js';
import TeamDirectoryPage from './features/team/TeamDirectoryPage.js';import TeamInvitePage from './features/team/TeamInvitePage.js';import TeamMemberPage from './features/team/TeamMemberPage.js';import LegacyInviteAcceptancePage from './features/team/InviteAcceptancePage.js';
import TeamOperationsPage from './features/team/TeamOperationsPage.js';import StaffAccessPage from './features/team/StaffAccessPage.js';
import { AutomationBuilderPage, AutomationDetailPage, AutomationRunPage, AutomationRunsPage, AutomationsPage } from './pages/automations/AutomationsPage.js';
import { ReportPage, ReportsHome } from './features/reports/OperationalReports.js';
import { ReportExportsPage, ReportSchedulesPage } from './features/reports/ReportOperations.js';
import { AdvancedAnalyticsPage } from './features/analytics/AdvancedAnalyticsPage.js';
import { OperationsInboxPage } from './features/operations/OperationsInboxPage.js';
import { OperationIssueDetailPage } from './features/operations/OperationIssueDetailPage.js';
import {TasksPage} from './features/tasks/TasksPage.js';
import {TaskDetailPage} from './features/tasks/TaskDetailPage.js';
import {
  CustomerLoginPage,
  CustomerAuthCallbackPage,
  CustomerClaimPage,
  CustomerPortalLayout,
  CustomerHomePage,
  CustomerBusinessesPage,
  CustomerAppointmentsPage,
  CustomerAppointmentDetailPage,
  CustomerFormsPage,
  CustomerFormPage,
  CustomerPaymentsPage,
  CustomerProfilePage,
} from './features/customer-portal/CustomerPortal.js';
import {
  CustomerCancellationPage,
  CustomerReschedulePage,
  GuestBookingManagementPage,
  GuestCancellationPage,
  GuestReschedulePage,
} from './features/customer-portal/CustomerBookingManagement.js';
import { ExternalReviewsPage, PublicReviewInvitationPage, ReputationInvitationsPage, ReputationOverviewPage, ReviewConnectionsPage } from './features/reputation/ReputationPages.js';
import { AgencyAuthProvider, AgencyGuard, AgencyLoginPage, AgencyMfaPage } from './features/agency/AgencyAuth.js';
import { AccessDeniedPage, AuthCallbackPage, InvitationAcceptancePage, PasswordRecoveryPage, SecuritySettingsPage, SelectBusinessPage, SessionExpiredPage } from './auth/AuthPages.js';
import { AgencyAnalyticsPage, AgencyAuditPage, AgencyFulfilmentPage, AgencyJobsPage, AgencyOverviewPage, AgencyPlanCreatePage, AgencyPlansPage, AgencySupportPage, AgencyTenantBillingPage, AgencyTenantCreatePage, AgencyTenantDetailPageFixed as AgencyTenantDetailPage, AgencyTenantEntitlementsPage, AgencyTenantHealthPage, AgencyTenantsPage, AgencyUserInvitePage, AgencyUsersPage, AgencyWebhooksPage, AgencyWorkQueuePage } from './features/agency/AgencyPages.js';

const ReputationRoute: React.FC<{ children: React.ReactNode; ownerOnly?: boolean }> = ({ children, ownerOnly = false }) => {
  const { role, permissions } = useAuth();
  const allowed = role === 'owner' || (!ownerOnly && permissions?.includes('REPUTATION_VIEW' as any));
  return allowed ? <>{children}</> : <Navigate to="/app/calendar" replace />;
};

const AppContent: React.FC = () => {
  const { authUserId, role } = useAuth();

  return (
    <BrowserRouter>
      {/* Dev auth banner notice */}
      {import.meta.env.DEV && (
        <div className="bg-amber-500 text-slate-950 text-xs px-6 py-2 flex items-center justify-between font-bold shadow-xs select-none">
          <div className="flex items-center gap-2">
            <span className="bg-slate-950 text-amber-400 text-[9px] font-black uppercase px-2 py-0.5 rounded">
              DEV MODE ACTIVE
            </span>
            <span>
              Supabase connected. Live API queries active. Current user role: <span className="underline">{authUserId ? role : 'None (Unauthenticated)'}</span>
            </span>
          </div>
          {!authUserId && (
            <span className="text-[10px] text-slate-900 font-mono">
              {window.location.pathname.startsWith('/agency') ? 'Agency identity required' : 'Tenant identity required'}
            </span>
          )}
        </div>
      )}

      <Routes>
        {/* Core Entry / Session login */}
        <Route path="/login" element={<Login />} />
        <Route path="/agency/login" element={<AgencyLoginPage />} />
        <Route path="/forgot-password" element={<PasswordRecoveryPage context="TENANT" mode="request" />} />
        <Route path="/reset-password" element={<PasswordRecoveryPage context="TENANT" mode="reset" />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/accept-invite" element={<InvitationAcceptancePage context="TENANT" />} />
        <Route path="/select-business" element={<SelectBusinessPage />} />
        <Route path="/session-expired" element={<SessionExpiredPage />} />
        <Route path="/access-denied" element={<AccessDeniedPage />} />
        <Route path="/agency/forgot-password" element={<PasswordRecoveryPage context="AGENCY" mode="request" />} />
        <Route path="/agency/reset-password" element={<PasswordRecoveryPage context="AGENCY" mode="reset" />} />
        <Route path="/agency/accept-invite" element={<InvitationAcceptancePage context="AGENCY" />} />
        <Route path="/agency/mfa/enrol" element={<AgencyMfaPage mode="enrol" />} />
        <Route path="/agency/mfa/challenge" element={<AgencyMfaPage mode="challenge" />} />
        <Route path="/auth/invite" element={<LegacyInviteAcceptancePage />} />
        <Route path="/forms/complete/:token" element={<PublicFormCompletionPage />} />
        <Route path="/forms/complete/:token/success" element={<PublicFormSuccessPage />} />
        <Route path="/review/:token" element={<PublicReviewInvitationPage />} />

        {/* Public Booking Widgets */}
        <Route element={<PublicBookingLayout />}>
          <Route path="/book/:subdomain" element={<BookingWizardPage />} />
          <Route path="/book/:subdomain/manage/:reference" element={<BookingWizardPage />} />
          <Route path="/book/:subdomain/payment/success" element={<PaymentSuccess />} />
          <Route path="/book/:subdomain/payment/cancel" element={<PaymentCancel />} />
        </Route>

        {/* Staff Operations Workspace */}
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <StaffWorkspaceLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to={role === 'owner' ? '/app/dashboard' : '/app/calendar'} replace />} />
          <Route path="dashboard" element={<RoleRoute allowedRoles={['owner']}><SaaSDashboardPage /></RoleRoute>} />
          <Route path="reports" element={<RoleRoute allowedRoles={['owner']}><ReportsHome /></RoleRoute>} />
          <Route path="reports/exports" element={<RoleRoute allowedRoles={['owner']}><ReportExportsPage /></RoleRoute>} />
          <Route path="reports/schedules" element={<RoleRoute allowedRoles={['owner']}><ReportSchedulesPage /></RoleRoute>} />
          <Route path="reports/:reportKey" element={<RoleRoute allowedRoles={['owner']}><ReportPage /></RoleRoute>} />
          <Route path="analytics" element={<RoleRoute allowedRoles={['owner']}><AdvancedAnalyticsPage /></RoleRoute>} />
          <Route path="reputation" element={<ReputationRoute><ReputationOverviewPage /></ReputationRoute>} />
          <Route path="reputation/reviews" element={<ReputationRoute><ExternalReviewsPage /></ReputationRoute>} />
          <Route path="reputation/invitations" element={<ReputationRoute><ReputationInvitationsPage /></ReputationRoute>} />
          <Route path="settings/integrations/reviews" element={<ReputationRoute ownerOnly><ReviewConnectionsPage /></ReputationRoute>} />
          <Route path="calendar" element={<RoleRoute allowedRoles={['owner', 'staff']}><StaffCalendarPage /></RoleRoute>} />
          
          {/* Phase 3: Reception Desk is now connected */}
          <Route path="reception" element={<RoleRoute allowedRoles={['owner', 'staff']}><ReceptionPage /></RoleRoute>} />
          <Route path="clients/*" element={<RoleRoute allowedRoles={['owner', 'staff']}><ClientCRMPage /></RoleRoute>} />
          <Route path="pos" element={<ModuleConnectingState title="POS Checkout" />} />
          <Route path="forms" element={<RoleRoute allowedRoles={['owner', 'staff']}><ConsentFormsPage /></RoleRoute>} />
          <Route path="forms/new" element={<RoleRoute allowedRoles={['owner']}><FormEditorPage /></RoleRoute>} />
          <Route path="forms/:formId" element={<RoleRoute allowedRoles={['owner', 'staff']}><FormDetailPage /></RoleRoute>} />
          <Route path="forms/:formId/edit" element={<RoleRoute allowedRoles={['owner']}><FormEditorPage /></RoleRoute>} />
          <Route path="forms/:formId/versions/:versionId" element={<RoleRoute allowedRoles={['owner', 'staff']}><FormVersionPage /></RoleRoute>} />
          <Route path="form-submissions/:submissionId" element={<RoleRoute allowedRoles={['owner', 'staff']}><FormSubmissionPage /></RoleRoute>} />
          <Route path="payments" element={<RoleRoute allowedRoles={['owner']}><PaymentHistoryPage /></RoleRoute>} />
          <Route path="payments/:transactionId" element={<RoleRoute allowedRoles={['owner']}><PaymentDetailPage /></RoleRoute>} />
          <Route path="settings" element={<RoleRoute allowedRoles={['owner']}><BrandSetupPage /></RoleRoute>} />
          <Route path="settings/team" element={<RoleRoute allowedRoles={['owner']}><TeamDirectoryPage /></RoleRoute>} />
          <Route path="settings/team/invite" element={<RoleRoute allowedRoles={['owner']}><TeamInvitePage /></RoleRoute>} />
          <Route path="settings/team/:staffUserId" element={<RoleRoute allowedRoles={['owner']}><TeamMemberPage /></RoleRoute>} />
          <Route path="settings/team/:staffUserId/access" element={<RoleRoute allowedRoles={['owner']}><StaffAccessPage /></RoleRoute>} />
          <Route path="settings/team/time-off" element={<RoleRoute allowedRoles={['owner']}><TeamOperationsPage /></RoleRoute>} />
          <Route path="settings/team/performance" element={<RoleRoute allowedRoles={['owner']}><TeamOperationsPage /></RoleRoute>} />
          <Route path="settings/team/commission" element={<RoleRoute allowedRoles={['owner']}><TeamOperationsPage /></RoleRoute>} />
          <Route path="settings/locations" element={<RoleRoute allowedRoles={['owner']}><TeamOperationsPage /></RoleRoute>} />
          <Route path="settings/resources" element={<RoleRoute allowedRoles={['owner']}><TeamOperationsPage /></RoleRoute>} />
          <Route path="settings/payments" element={<RoleRoute allowedRoles={['owner']}><Payments /></RoleRoute>} />
          <Route path="settings/payments/return" element={<RoleRoute allowedRoles={['owner']}><StripeReturn /></RoleRoute>} />
          <Route path="settings/payments/refresh" element={<RoleRoute allowedRoles={['owner']}><StripeRefresh /></RoleRoute>} />
          <Route path="settings/communications" element={<RoleRoute allowedRoles={['owner']}><Communications /></RoleRoute>} />
          <Route path="settings/email-history" element={<RoleRoute allowedRoles={['owner']}><EmailHistory /></RoleRoute>} />
          <Route path="settings/communications/sms" element={<RoleRoute allowedRoles={['owner']}><SmsSettings /></RoleRoute>} />
          <Route path="settings/booking/customer-management" element={<RoleRoute allowedRoles={['owner']}><CustomerBookingManagementSettings /></RoleRoute>} />
          <Route path="settings/security" element={<SecuritySettingsPage context="TENANT" />} />
          <Route path="automations" element={<RoleRoute allowedRoles={['owner']}><AutomationsPage /></RoleRoute>} />
          <Route path="automations/new" element={<RoleRoute allowedRoles={['owner']}><AutomationBuilderPage /></RoleRoute>} />
          <Route path="automations/:id" element={<RoleRoute allowedRoles={['owner']}><AutomationDetailPage /></RoleRoute>} />
          <Route path="automations/:id/edit" element={<RoleRoute allowedRoles={['owner']}><AutomationBuilderPage /></RoleRoute>} />
          <Route path="automations/:id/runs" element={<RoleRoute allowedRoles={['owner']}><AutomationRunsPage /></RoleRoute>} />
          <Route path="automation-runs/:runId" element={<RoleRoute allowedRoles={['owner']}><AutomationRunPage /></RoleRoute>} />
          <Route path="operations" element={<RoleRoute allowedRoles={['owner','staff']}><OperationsInboxPage /></RoleRoute>} />
          <Route path="operations/:issueId" element={<RoleRoute allowedRoles={['owner','staff']}><OperationIssueDetailPage /></RoleRoute>} />
          <Route path="tasks" element={<RoleRoute allowedRoles={['owner','staff']}><TasksPage /></RoleRoute>} />
          <Route path="tasks/my" element={<RoleRoute allowedRoles={['owner','staff']}><TasksPage /></RoleRoute>} />
          <Route path="tasks/:taskId" element={<RoleRoute allowedRoles={['owner','staff']}><TaskDetailPage /></RoleRoute>} />
          
          {/* Finance Routes */}
          <Route path="finance" element={<RoleRoute allowedRoles={['owner']}><FinanceOverviewPage /></RoleRoute>} />
          <Route path="finance/payouts" element={<RoleRoute allowedRoles={['owner']}><PayoutsListPage /></RoleRoute>} />
          <Route path="finance/payouts/:payoutId" element={<RoleRoute allowedRoles={['owner']}><PayoutDetailPage /></RoleRoute>} />
          <Route path="finance/disputes" element={<RoleRoute allowedRoles={['owner']}><DisputesListPage /></RoleRoute>} />
          <Route path="finance/disputes/:disputeId" element={<RoleRoute allowedRoles={['owner']}><DisputeDetailPage /></RoleRoute>} />
        </Route>

        {/* Agency Management Control Plane */}
        <Route
          path="/agency"
          element={
            <AgencyGuard>
              <AgencyLayout />
            </AgencyGuard>
          }
        >
          <Route index element={<Navigate to="/agency/overview" replace />} />
          <Route path="overview" element={<AgencyOverviewPage />} />
          <Route path="tenants" element={<AgencyTenantsPage />} />
          <Route path="tenants/new" element={<AgencyTenantCreatePage />} />
          <Route path="tenants/:tenantId" element={<AgencyTenantDetailPage />} />
          <Route path="tenants/:tenantId/onboarding" element={<AgencyTenantDetailPage />} />
          <Route path="tenants/:tenantId/billing" element={<AgencyTenantBillingPage />} />
          <Route path="tenants/:tenantId/entitlements" element={<AgencyTenantEntitlementsPage />} />
          <Route path="tenants/:tenantId/fulfilment" element={<AgencyTenantDetailPage />} />
          <Route path="tenants/:tenantId/health" element={<AgencyTenantHealthPage />} />
          <Route path="onboarding" element={<AgencyWorkQueuePage mode="ONBOARDING" />} />
          <Route path="billing" element={<AgencyWorkQueuePage mode="BILLING" />} />
          <Route path="plans" element={<AgencyPlansPage />} />
          <Route path="plans/new" element={<AgencyPlanCreatePage />} />
          <Route path="fulfilment" element={<AgencyFulfilmentPage />} />
          <Route path="support" element={<AgencySupportPage />} />
          <Route path="webhooks" element={<AgencyWebhooksPage />} />
          <Route path="jobs" element={<AgencyJobsPage />} />
          <Route path="analytics" element={<AgencyAnalyticsPage />} />
          <Route path="audit" element={<AgencyAuditPage />} />
          <Route path="users" element={<AgencyUsersPage />} />
          <Route path="users/new" element={<AgencyUserInvitePage />} />
          <Route path="settings/security" element={<SecuritySettingsPage context="AGENCY" />} />
        </Route>

        {/* Customer Self-Service Portal — completely separate from staff /app workspace */}
        <Route path="/customer/login" element={<CustomerLoginPage />} />
        <Route path="/customer/auth/callback" element={<CustomerAuthCallbackPage />} />
        <Route path="/customer/claim/:token" element={<CustomerClaimPage />} />
        <Route path="/manage/:token" element={<GuestBookingManagementPage />} />
        <Route path="/manage/:token/reschedule" element={<GuestReschedulePage />} />
        <Route path="/manage/:token/cancel" element={<GuestCancellationPage />} />
        <Route path="/customer" element={<CustomerPortalLayout />}>
          <Route index element={<CustomerHomePage />} />
          <Route path="businesses" element={<CustomerBusinessesPage />} />
          <Route path="appointments" element={<CustomerAppointmentsPage />} />
          <Route path="appointments/:bookingReference" element={<CustomerAppointmentDetailPage />} />
          <Route path="appointments/:bookingReference/reschedule" element={<CustomerReschedulePage />} />
          <Route path="appointments/:bookingReference/cancel" element={<CustomerCancellationPage />} />
          <Route path="forms" element={<CustomerFormsPage />} />
          <Route path="forms/:assignmentReference" element={<CustomerFormPage />} />
          <Route path="payments" element={<CustomerPaymentsPage />} />
          <Route path="profile" element={<CustomerProfilePage />} />
        </Route>

        {/* Global Fallback Redirects */}
        <Route path="/" element={<Navigate to="/app/calendar" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <AgencyAuthProvider>
        <WorkspaceProvider>
          <AppContent />
        </WorkspaceProvider>
      </AgencyAuthProvider>
    </AuthProvider>
  );
};

export default App;
