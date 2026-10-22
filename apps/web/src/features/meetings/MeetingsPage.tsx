import { useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../../auth/useAuth';
import { callingError } from '../calls/calls.api';
import { meetingsApi, type MeetingsConfig } from './meetings.api';
import { MeetingForm } from './MeetingForm';
import { MeetingDetail, useScheduledMeeting } from './MeetingDetail';
import { MeetingsList } from './MeetingsList';
import './meetings.css';

function DetailRoute({ config }: { config: MeetingsConfig }) { const { id = '' } = useParams(); return <MeetingDetail key={id} id={id} config={config}/>; }
function CreateRoute({ config }: { config: MeetingsConfig }) {
  const navigate = useNavigate(); const [params] = useSearchParams();
  const customerId = params.get('customerId') || config.customers.find(customer => customer.reference === params.get('customerReference'))?.id;
  return <><Link className="meetings-back" to="/app/meetings"><ArrowLeft size={16}/>Meetings</Link><header className="meetings-heading"><div><p className="meetings-eyebrow">{config.branding.name}</p><h1>Create a meeting</h1><p>Choose a time, invite your team and connect the customer.</p></div></header>{config.enabled && config.canCreate ? <MeetingForm config={config} customerId={customerId} saved={meeting => navigate('/app/meetings/' + meeting.id, { replace: true })}/> : <p role="alert">You do not have permission to create meetings, or calling is not enabled for this business.</p>}</>;
}
function EditRoute({ config }: { config: MeetingsConfig }) {
  const { id = '' } = useParams(); const navigate = useNavigate(); const { meeting, error } = useScheduledMeeting(id);
  return <><Link className="meetings-back" to={'/app/meetings/' + id}><ArrowLeft size={16}/>Back to meeting</Link><header className="meetings-heading"><div><h1>Edit or reschedule meeting</h1><p>Rescheduling closes existing guest sessions and replaces invitations. Copy a new link for guests who were invited without email.</p></div></header>{error && <p role="alert" className="meetings-error">{error}</p>}{meeting ? meeting.canManage && meeting.status === 'SCHEDULED' ? <MeetingForm key={meeting.id} config={config} meeting={meeting} saved={value => navigate('/app/meetings/' + value.id, { replace: true })}/> : <p role="alert">This meeting cannot be edited with your current access or status.</p> : !error && <p role="status">Loading meeting…</p>}</>;
}
function MeetingsWorkspace() {
  const [config, setConfig] = useState<MeetingsConfig | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [params] = useSearchParams(); const customerReference = params.get('customerReference') || '';
  useEffect(() => { let active = true; void meetingsApi.config(customerReference).then(value => { if (active) { setConfig(value); setError(''); } }).catch(cause => { if (active) setError(callingError(cause)); }); return () => { active = false; }; }, [retry, customerReference]);
  return <main className="meetings meetings-workspace">{!config ? error ? <div role="alert" className="meetings-error"><h1>Meetings unavailable</h1><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : <p role="status">Loading meetings workspace…</p> : <Routes><Route index element={<MeetingsList config={config}/>}/><Route path="new" element={<CreateRoute config={config}/>}/><Route path=":id" element={<DetailRoute config={config}/>}/><Route path=":id/edit" element={<EditRoute config={config}/>}/><Route path="*" element={<p>Meeting page not found. <Link to="/app/meetings">Open Meetings</Link></p>}/></Routes>}</main>;
}
export default function MeetingsPage() { const { businessReference } = useAuth(); return <MeetingsWorkspace key={businessReference}/>; }
