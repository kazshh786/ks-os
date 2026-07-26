import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { getDataProvider } from '../../data/data-provider.js';

export default function TeamDirectoryPage() {
  const [data, setData] = useState<any>();
  const [error, setError] = useState('');
  const load = () => getDataProvider().listTeam().then(setData).catch(() => setError('Team data could not be loaded. No mock data was substituted.'));
  useEffect(() => { void load(); }, []);
  const resend = async (id: string) => { await getDataProvider().resendTeamInvitation(id); await load(); };
  const cancel = async (id: string) => { await getDataProvider().cancelTeamInvitation(id); await load(); };
  return <div className="space-y-6"><div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-black">Team management</h1><p className="text-sm text-slate-500">Staff accounts, services, availability and access.</p></div><div className="flex gap-2"><Link to="/app/settings/availability" className="rounded-xl border bg-white px-4 py-2 font-bold">Manage availability</Link><Link to="/app/settings/team/invite" className="rounded-xl bg-slate-950 px-4 py-2 font-bold text-white">Invite staff</Link></div></div>{error&&<div role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</div>}<section className="rounded-2xl border bg-white"><h2 className="border-b p-4 font-bold">Members</h2>{data?.members.map((m:any)=><Link key={m.userId} to={`/app/settings/team/${m.userId}`} className="grid grid-cols-2 gap-2 border-b p-4 md:grid-cols-6"><strong>{m.name}</strong><span>{m.email}</span><span>{m.role}</span><span>{m.accountStatus}</span><span>{m.bookingEnabled?'Bookable':'Not bookable'}</span><span>{m.futureAppointmentCount} future</span></Link>)}</section><section className="rounded-2xl border bg-white"><h2 className="border-b p-4 font-bold">Invitations</h2>{data?.invitations.map((i:any)=><div key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><strong>{i.name}</strong><p className="text-sm text-slate-500">{i.email} · {i.status}</p></div>{i.status==='PENDING'&&<div className="flex gap-2"><button onClick={()=>resend(i.id)} className="rounded-lg border px-3 py-1">Resend</button><button onClick={()=>cancel(i.id)} className="rounded-lg border px-3 py-1 text-red-700">Cancel</button></div>}</div>)}</section></div>;
}
