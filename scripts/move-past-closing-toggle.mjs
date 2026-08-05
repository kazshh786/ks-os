import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const path = 'apps/web/src/features/bookings/CalendarAvailabilityDialog.tsx';
const before = readFileSync(path, 'utf8');
let source = before;

function replaceRequired(search, replacement, description) {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`Could not apply ${description}`);
  source = next;
}

replaceRequired(
  "import type { BookingChannel } from '@ks-os/contracts';",
  "import type { BookingChannel, CustomerBookingPolicySettings } from '@ks-os/contracts';",
  'booking policy type import',
);

replaceRequired(
  "const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];",
  `const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const customerBookingPolicyEndpoint = '/api/v1/settings/booking/customer-management';

async function requestCustomerBookingPolicy(init?: RequestInit) {
  const response = await fetchWithAuth(customerBookingPolicyEndpoint, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || body.error?.code || 'Availability setting could not be saved.');
  return body.data as CustomerBookingPolicySettings;
}`,
  'customer booking policy request',
);

replaceRequired(
  "  const [enabledChannels, setEnabledChannels] = useState<BookingChannel[]>(['in_shop']);\n  const [loading, setLoading] = useState(false);",
  "  const [enabledChannels, setEnabledChannels] = useState<BookingChannel[]>(['in_shop']);\n  const [allowAppointmentsPastClosingTime, setAllowAppointmentsPastClosingTime] = useState(false);\n  const [loading, setLoading] = useState(false);",
  'past-closing state',
);

replaceRequired(
  "    Promise.all([getDataProvider().listTeam(), getDataProvider().getBookingPageSettings()])\n      .then(([team, settings]) => {",
  "    Promise.all([getDataProvider().listTeam(), getDataProvider().getBookingPageSettings(), requestCustomerBookingPolicy()])\n      .then(([team, settings, bookingPolicy]) => {",
  'availability policy loading',
);

replaceRequired(
  "        setEnabledChannels(settings.bookingRules.enabledBookingChannels?.length ? settings.bookingRules.enabledBookingChannels : ['in_shop']);",
  "        setEnabledChannels(settings.bookingRules.enabledBookingChannels?.length ? settings.bookingRules.enabledBookingChannels : ['in_shop']);\n        setAllowAppointmentsPastClosingTime(bookingPolicy.allowAppointmentsPastClosingTime);",
  'loaded past-closing value',
);

replaceRequired(
  "      const updated = await getDataProvider().updateTeamMemberBookingChannels(member.id, { channel, schedule });\n      setMember(updated);\n      setWeeklyState('saved');",
  "      const updated = await getDataProvider().updateTeamMemberBookingChannels(member.id, { channel, schedule });\n      const bookingPolicy = await requestCustomerBookingPolicy({\n        method: 'PATCH',\n        body: JSON.stringify({ allowAppointmentsPastClosingTime }),\n      });\n      setMember(updated);\n      setAllowAppointmentsPastClosingTime(bookingPolicy.allowAppointmentsPastClosingTime);\n      setWeeklyState('saved');",
  'weekly availability policy save',
);

replaceRequired(
  "        {!loading && member && tab === 'weekly' && <div className=\"mt-4\">\n          <div className=\"divide-y divide-slate-100 rounded-2xl border border-slate-200 px-4\">",
  `        {!loading && member && tab === 'weekly' && <div className="mt-4">
          <label className="mb-4 flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4">
            <span><span className="block text-sm font-black text-slate-950">Allow appointments to finish after closing time</span><span className="mt-1 block max-w-2xl text-xs leading-5 text-slate-600">Appointments must still start before the closing time shown below, but their service duration and buffer may continue afterwards. This applies across the business.</span></span>
            <input aria-label="Allow appointments to finish after closing time" type="checkbox" checked={allowAppointmentsPastClosingTime} onChange={event => { setAllowAppointmentsPastClosingTime(event.target.checked); setWeeklyState('idle'); }} className="mt-0.5 h-5 w-5 shrink-0" />
          </label>
          <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 px-4">`,
  'availability modal toggle',
);

replaceRequired(
  "{weeklyState === 'error' && <span role=\"alert\" className=\"font-bold text-rose-700\">Check that every end time is after its start time.</span>}",
  "{weeklyState === 'error' && <span role=\"alert\" className=\"font-bold text-rose-700\">Availability could not be saved. Check the times and try again.</span>}",
  'availability save error copy',
);

writeFileSync(path, source);
rmSync('scripts/move-past-closing-toggle.mjs');
rmSync('.github/workflows/agent-move-past-closing-toggle.yml');
