import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { BUSINESS_TYPES, ProductOnboardingAnswersSchema, resolveBusinessProfile, type ProductOnboardingAnswers } from '@ks-os/contracts';
import { fetchWithAuth } from '../../api/client';
import { useAuth } from '../../auth/useAuth';
import { useBusinessProfile } from '../../auth/useBusinessProfile';

type ChoiceField = 'buying' | 'delivery' | 'resources' | 'payment' | 'manage';
const sections: Array<{key:ChoiceField;title:string;options:Array<[string,string]>}> = [
  {key:'buying',title:'How do customers buy?',options:[['appointments','Appointments'],['quotes','Quotes'],['direct-purchase','Direct purchase'],['recurring-contracts','Recurring contracts'],['subscription','Subscription']]},
  {key:'delivery',title:'How do you deliver work?',options:[['appointments','Appointments'],['jobs','Jobs'],['projects','Projects'],['deliveries','Deliveries'],['classes','Classes'],['orders','Orders']]},
  {key:'resources',title:'What resources do you use?',options:[['staff','Staff'],['vehicles','Vehicles'],['stock','Stock'],['documents','Documents'],['multiple-locations','Multiple locations'],['equipment','Equipment and assets']]},
  {key:'payment',title:'How do customers pay?',options:[['quotes','Quotes'],['invoices','Invoices'],['card','Card payments'],['pos','Point of sale'],['subscription','Subscription']]},
  {key:'manage',title:'What should KSOS help you manage?',options:[['customers','Customers'],['leads','Leads'],['sales','Sales'],['bookings','Bookings'],['jobs','Jobs'],['projects','Projects'],['staff','Staff'],['calendar','Calendar'],['money','Money'],['documents','Documents'],['marketing','Marketing'],['inventory','Inventory'],['support','Support'],['reports','Reports'],['automation','Automation']]},
];

export default function ProductOnboardingPage() {
  const auth = useAuth();
  const profile = useBusinessProfile();
  const navigate = useNavigate();
  const [answers,setAnswers] = useState<ProductOnboardingAnswers>(()=>({
    businessName:auth.tenantName,businessType:profile.businessType ?? '',...profile.onboardingDefaults,
  }));
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  useEffect(()=>{
    let active=true;
    setLoading(true);
    void fetchWithAuth('/api/v1/workspace/product-onboarding').then(async response=>{
      const body=await response.json();
      if(!response.ok) throw new Error(body.error?.message ?? 'Business setup could not be loaded.');
      if(active) setAnswers(body.data.configuration?.answers ?? {
        businessName:body.data.businessName,businessType:body.data.businessType ?? '',
        ...body.data.profile.onboardingDefaults,
      });
    }).catch(cause=>{if(active)setError(cause.message);}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[auth.businessReference]);
  const toggle=(key:ChoiceField,value:string)=>{
    setAnswers(previous=>({...previous,[key]:(previous[key] as string[]).includes(value)
      ? previous[key].filter(item=>item!==value) : [...previous[key],value]}));
  };
  const selectType=(value:string)=>{
    const defaults=resolveBusinessProfile(value).onboardingDefaults;
    setAnswers(previous=>({...previous,...defaults,businessType:value}));
  };
  const save=async(event:FormEvent)=>{
    event.preventDefault();
    const parsed=ProductOnboardingAnswersSchema.safeParse(answers);
    if(!parsed.success){setError('Enter your business details and choose at least one option in each section, except resources.');return;}
    setSaving(true);setError('');
    try {
      const response=await fetchWithAuth('/api/v1/workspace/product-onboarding',{
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(parsed.data),
      });
      const body=await response.json();
      if(!response.ok)throw new Error(body.error?.message ?? 'Business setup could not be saved.');
      await auth.reload();
      navigate('/app/dashboard',{replace:true});
    }catch(cause){setError(cause instanceof Error?cause.message:'Business setup could not be saved.');}
    finally{setSaving(false);}
  };
  if(auth.role!=='owner')return <p>Your business setup is managed by its owner. <Link to="/app">Return to your workspace</Link></p>;
  if(loading)return <p role="status">Loading business setup…</p>;
  return <form onSubmit={save} className="mx-auto max-w-3xl space-y-7 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
    <header><p className="text-sm font-bold text-indigo-600">Business setup</p><h1 className="mt-2 text-3xl font-black">Make KSOS fit your business</h1><p className="mt-3 text-slate-600">Tell us how you work. We will organise your workspace around the tools available today. You can change these answers later.</p></header>
    {error&&<p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-800">{error}</p>}
    <fieldset disabled={saving} className="space-y-5">
      <legend className="text-lg font-bold">Your business</legend>
      <label className="block font-semibold">Business name<input required minLength={2} maxLength={255} value={answers.businessName} onChange={event=>setAnswers({...answers,businessName:event.target.value})} className="mt-2 block w-full rounded-xl border border-slate-300 p-3"/></label>
      <label className="block font-semibold">Business type<select value={answers.businessType} onChange={event=>selectType(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 p-3"><option value="">Choose your business type</option>{!BUSINESS_TYPES.some(type=>type.key===answers.businessType)&&answers.businessType&&<option value={answers.businessType}>{answers.businessType}</option>}{BUSINESS_TYPES.map(type=><option key={type.key} value={type.key}>{type.label}</option>)}</select></label>
      <label className="block font-semibold">Approximate team size<select value={answers.teamSize} onChange={event=>setAnswers({...answers,teamSize:event.target.value as ProductOnboardingAnswers['teamSize']})} className="mt-2 block w-full rounded-xl border border-slate-300 p-3">{ProductOnboardingAnswersSchema.shape.teamSize.options.map(size=><option key={size} value={size}>{size==='1'?'Just me':size+' people'}</option>)}</select></label>
    </fieldset>
    {sections.map(section=><fieldset key={section.key} disabled={saving} className="border-t border-slate-200 pt-5"><legend className="pr-3 text-lg font-bold">{section.title}</legend><p className="mb-3 text-sm text-slate-500">Choose all that apply.</p><div className="grid gap-3 sm:grid-cols-2">{section.options.map(([value,label])=><label key={value} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"><input type="checkbox" checked={(answers[section.key] as string[]).includes(value)} onChange={()=>toggle(section.key,value)} className="h-4 w-4"/>{label}</label>)}</div></fieldset>)}
    <p className="text-sm text-slate-600">Some selected needs may need future features. Your plan and access permissions still determine which tools are available.</p>
    <button disabled={saving} className="w-full rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white disabled:opacity-50">{saving?'Saving…':'Save and open my workspace'}</button>
  </form>;
}
