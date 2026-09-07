export type WeeklyWindow = { dayOfWeek: number; enabled: boolean; startTime: string; endTime: string };
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function WeeklyScheduleEditor({ value, onChange }: { value: WeeklyWindow[]; onChange: (value: WeeklyWindow[]) => void }) {
  const update = (index: number, patch: Partial<WeeklyWindow>) => onChange(value.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <div>{days.map((day, dayOfWeek) => <fieldset key={day} className="my-3 rounded-lg border p-3">
    <legend>{day}</legend>
    {value.map((row, index) => row.dayOfWeek === dayOfWeek ? <div key={index} className="flex flex-wrap items-center gap-2 py-1">
      <label><input type="checkbox" checked={row.enabled} onChange={event => update(index, { enabled: event.target.checked })} /> Open</label>
      <input aria-label={`${day} shift ${index + 1} start`} type="time" value={row.startTime} onChange={event => update(index, { startTime: event.target.value })} />
      <input aria-label={`${day} shift ${index + 1} end`} type="time" value={row.endTime} onChange={event => update(index, { endTime: event.target.value })} />
      <button type="button" onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove shift</button>
    </div> : null)}
    <button type="button" onClick={() => onChange([...value.filter(row => row.dayOfWeek !== dayOfWeek || row.enabled), { dayOfWeek, enabled: true, startTime: '14:00', endTime: '18:00' }])}>Add {day} shift</button>
  </fieldset>)}</div>;
}
