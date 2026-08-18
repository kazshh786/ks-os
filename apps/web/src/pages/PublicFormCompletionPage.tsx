import { useLocation, useParams } from 'react-router';
import { AssignedConsentFormSuccessPage } from './ConsentFormSuccessPage.js';
import PublicWorkspaceFormPage, { PublicWorkspaceFormLegalPage } from './PublicWorkspaceFormPage.js';

export default function PublicFormCompletionPage() {
  const { token = '' } = useParams();
  return <PublicWorkspaceFormPage assignmentToken={token} />;
}

export function AssignedConsentFormLegalPage({ documentType = 'acknowledgement' }: { documentType?: 'acknowledgement' | 'terms' }) {
  const location = useLocation();
  const match = location.pathname.match(/^\/forms\/complete\/([^/]+)\/(?:acknowledgement|terms)$/i);
  const token = match?.[1] ? decodeURIComponent(match[1]) : '';
  return <PublicWorkspaceFormLegalPage assignmentToken={token} documentType={documentType} />;
}

export function PublicFormSuccessPage() {
  return <AssignedConsentFormSuccessPage />;
}
