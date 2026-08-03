import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Clock3, Pencil, Plus, PoundSterling, Scissors } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useWorkspace } from '../../context/WorkspaceContext';
import { getDataProvider } from '../../data/data-provider';
import type { Service } from '../../data/types';
import { updateServiceRecord } from './services-api';

const emptyDraft = { name: '', description: '', price: '', durationMin: '30', category: 'General' };

const draftFromService = (service: Service) => ({
  name: service.name,
  description: service.description,
  price: service.price.toString(),
  durationMin: service.durationMin.toString(),
  category: service.category,
});

export function ServicesPage({ tenantOverride = null }: { tenantOverride?: import('../../data/types').BusinessTenant | null }) {
  const { activeTenant: workspaceTenant } = useWorkspace();
  const activeTenant = tenantOverride || workspaceTenant;
  const [searchParams, setSearchParams] = useSearchParams();
  const [services, setServices] = useState<Service[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(searchParams.get('add') === '1');
  const nameInput = useRef<HTMLInputElement>(null);
  const locallyCreatedIds = useRef(new Set<string>());
  const isEditing = editingServiceId !== null;

  useEffect(() => {
    let active = true;
    if (!activeTenant) return;
    setLoading(true);
    getDataProvider().getServices(activeTenant.id)
      .then(rows => active && setServices(current => {
        const localRows = current.filter(service => locallyCreatedIds.current.has(service.id));
        const serverIds = new Set(rows.map(service => service.id));
        return [...rows, ...localRows.filter(service => !serverIds.has(service.id))]
          .sort((a, b) => a.name.localeCompare(b.name));
      }))
      .catch(() => active && setError('Could not load services. Please try again.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [activeTenant]);

  const openCreateForm = () => {
    setError('');
    setEditingServiceId(null);
    setDraft(emptyDraft);
    setShowForm(true);
    setSearchParams({ add: '1' }, { replace: true });
    window.setTimeout(() => nameInput.current?.focus(), 0);
  };

  const openEditForm = (service: Service) => {
    setError('');
    setEditingServiceId(service.id);
    setDraft(draftFromService(service));
    setShowForm(true);
    setSearchParams({}, { replace: true });
    window.setTimeout(() => nameInput.current?.focus(), 0);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingServiceId(null);
    setDraft(emptyDraft);
    setSearchParams({}, { replace: true });
  };

  const saveService = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeTenant) return;
    setSaving(true);
    setError('');

    const input = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      price: Number(draft.price),
      durationMin: Number(draft.durationMin),
      category: draft.category.trim() || 'General',
    };

    try {
      if (editingServiceId) {
        const updated = await updateServiceRecord(editingServiceId, input);
        setServices(current => current
          .map(service => service.id === updated.id ? updated : service)
          .sort((a, b) => a.name.localeCompare(b.name)));
      } else {
        const created = await getDataProvider().createService(activeTenant.id, input);
        locallyCreatedIds.current.add(created.id);
        setServices(current => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      }
      closeForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : isEditing ? 'Could not update service' : 'Could not create service');
    } finally {
      setSaving(false);
    }
  };

  return <div className="mx-auto max-w-6xl space-y-6">
    <section className="overflow-hidden rounded-3xl bg-slate-950 text-white shadow-sm">
      <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-300">Service catalog</p>
          <h1 className="mt-2 text-3xl font-black">Your services, all in one place</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">Create and update the treatments and appointments customers can book, with a clear description, duration, and price.</p>
        </div>
        <button type="button" onClick={openCreateForm} className="flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-500 px-5 text-sm font-black text-white hover:bg-indigo-400">
          <Plus aria-hidden="true" className="h-5 w-5" /> Add service
        </button>
      </div>
    </section>

    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">{error}</div>}

    {showForm && <form onSubmit={saveService} className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-black">{isEditing ? 'Edit service' : 'Add a service'}</h2>
          <p className="mt-1 text-sm text-slate-500">{isEditing ? 'Changes will update future booking choices and checkout information.' : 'This will appear in the service list and booking choices.'}</p>
        </div>
        <button type="button" onClick={closeForm} className="text-sm font-bold text-slate-500 hover:text-slate-950">Cancel</button>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-bold text-slate-700">Service name<input ref={nameInput} required value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="e.g. Deep tissue massage" className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
        <label className="text-sm font-bold text-slate-700">Category<input value={draft.category} onChange={event => setDraft(current => ({ ...current, category: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
        <label className="sm:col-span-2 text-sm font-bold text-slate-700">Description<textarea required value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} placeholder="Explain what the service includes and who it is for." rows={3} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
        <label className="text-sm font-bold text-slate-700">Price (£)<input required min="0" step="0.01" type="number" value={draft.price} onChange={event => setDraft(current => ({ ...current, price: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
        <label className="text-sm font-bold text-slate-700">Duration (minutes)<input required min="5" max="1440" step="5" type="number" value={draft.durationMin} onChange={event => setDraft(current => ({ ...current, durationMin: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
      </div>
      <button disabled={saving} className="mt-5 min-h-11 rounded-xl bg-indigo-600 px-5 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60">
        {saving ? isEditing ? 'Saving changes…' : 'Creating service…' : isEditing ? 'Save changes' : 'Create service'}
      </button>
    </form>}

    <section aria-labelledby="service-list-heading">
      <div className="flex items-end justify-between gap-4">
        <div><h2 id="service-list-heading" className="text-xl font-black">Full service list</h2><p className="mt-1 text-sm text-slate-500">{services.length} {services.length === 1 ? 'service' : 'services'} available</p></div>
        {!showForm && <button type="button" onClick={openCreateForm} className="hidden items-center gap-2 text-sm font-black text-indigo-700 sm:flex"><Plus aria-hidden="true" className="h-4 w-4" />Add another</button>}
      </div>
      {loading ? <p className="mt-5 text-sm text-slate-500">Loading services…</p> : services.length === 0 ? <div className="mt-5 rounded-2xl border-2 border-dashed border-slate-200 bg-white p-10 text-center"><Scissors aria-hidden="true" className="mx-auto h-8 w-8 text-slate-400" /><h3 className="mt-3 font-black">No services yet</h3><p className="mt-1 text-sm text-slate-500">Add your first service so customers can start booking.</p><button type="button" onClick={openCreateForm} className="mt-4 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white">Add your first service</button></div> :
        <div className="mt-5 grid gap-4 md:grid-cols-2">{services.map(service => <article key={service.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-indigo-700">{service.category}</span><h3 className="mt-3 text-lg font-black">{service.name}</h3></div>
            <div className="flex flex-col items-end gap-2">
              <span className="text-lg font-black">£{service.price.toFixed(2)}</span>
              <button type="button" onClick={() => openEditForm(service)} aria-label={`Edit ${service.name}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700">
                <Pencil aria-hidden="true" className="h-3.5 w-3.5" /> Edit
              </button>
            </div>
          </div>
          <p className="mt-3 min-h-10 text-sm leading-6 text-slate-600">{service.description || 'No description has been added yet.'}</p>
          <div className="mt-4 flex gap-4 border-t border-slate-100 pt-4 text-xs font-bold text-slate-500"><span className="flex items-center gap-1.5"><Clock3 aria-hidden="true" className="h-4 w-4" />{service.durationMin} minutes</span><span className="flex items-center gap-1.5"><PoundSterling aria-hidden="true" className="h-4 w-4" />{service.price.toFixed(2)}</span></div>
        </article>)}</div>}
    </section>
  </div>;
}
