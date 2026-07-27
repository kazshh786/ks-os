/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  FileText, ClipboardCheck, Plus, Trash2, ArrowRight, CheckCircle2, AlertCircle, 
  HelpCircle, Sparkles, Star, MessageSquare, Laptop, ShieldAlert, ShieldCheck, 
  Settings, Users, Share2, Copy, RefreshCw, Layers, CheckSquare, AlignLeft, 
  CheckCircle, PenTool, Database, Radio, ToggleLeft, ArrowUpDown, GripVertical, 
  Zap, Mail, Sparkle, Info, ArrowRightLeft, FileUp, Percent, Award, Eye, Heart, Lock
} from 'lucide-react';
import { BusinessTenant, ClientProfile } from '../data/types.js';
import { getDataProvider } from '../data/data-provider.js';


interface ConsentFormBuilderProps {
  tenant: BusinessTenant;
}

export interface FormQuestion {
  id: string;
  label: string;
  type: 'text' | 'checkbox' | 'radio' | 'signature' | 'rating' | 'email' | 'phone' | 'fileupload';
  options?: string[];
  required: boolean;
  placeholder?: string;
  conditionalOn?: string;
  conditionalValue?: string;
}

const DEFAULT_TEMPLATES = [
  {
    id: 'tpl-dermal',
    title: 'Dermal and Aesthetics Consent Form',
    category: 'Consultation and Consent',
    description: 'Perfect for skin clinics, filler injectables, aesthetics and lash extensions.',
    questions: [
      { id: 'q-d-1', label: 'Do you have any skin disorders or severe allergies?', type: 'radio', options: ['Yes', 'No', 'Unsure'], required: true },
      { id: 'q-d-2', label: 'Please list any medical conditions or active prescription creams', type: 'text', placeholder: 'e.g. Roaccutane, Vitamin A...', required: false, conditionalOn: 'q-d-1', conditionalValue: 'Yes' },
      { id: 'q-d-3', label: 'I authorize treatment and confirm a patch test was completed safely', type: 'checkbox', required: true },
      { id: 'q-d-4', label: 'Confirm your formal digital signature below', type: 'signature', required: true }
    ]
  },
  {
    id: 'tpl-signup',
    title: 'Bloomed Flower Shop Email Signup Form',
    category: 'Signup Forms',
    description: 'For newsletter subscriptions, seasonal offers, and getting 15% discount vouchers.',
    questions: [
      { id: 'q-s-1', label: 'What is your full legal name?', type: 'text', placeholder: 'John Doe', required: true },
      { id: 'q-s-2', label: 'Enter your preferred email address (We will send a 15% off coupon!)', type: 'email', placeholder: 'you@example.com', required: true },
      { id: 'q-s-3', label: 'What kind of flowers do you prefer most?', type: 'radio', options: ['Pink Peonies', 'Red Roses', 'White Lilies', 'Wildflowers'], required: false },
      { id: 'q-s-4', label: 'I agree to receive weekly floral design ideas and exclusive VIP sale notifications', type: 'checkbox', required: true }
    ]
  },
  {
    id: 'tpl-feedback',
    title: 'Roll Bicycles Experience and Rating Feedback',
    category: 'Feedback Forms',
    description: 'Collect post-purchase rankings and reviews of road bikes, gear, or workshop tune-ups.',
    questions: [
      { id: 'q-f-1', label: 'How would you rate your overall experience with our service?', type: 'rating', required: true },
      { id: 'q-f-2', label: 'Which bike did you purchase or have serviced?', type: 'radio', options: ['Road Bike', 'Mountain Bike', 'Electric Commuter', 'Gravel Rig'], required: true },
      { id: 'q-f-3', label: 'Tell us what you loved or how we can improve our mechanical setup', type: 'text', placeholder: 'Your constructive feedback matters...', required: false },
      { id: 'q-f-4', label: 'May we share this feedback anonymously on our social channels?', type: 'checkbox', required: true }
    ]
  },
  {
    id: 'tpl-hair',
    title: 'Glossy Locks Hair Care and Consultation',
    category: 'Order and Consultation',
    description: 'Customize product selection for Glossy Locks shampoos, smoothers, serums, and hair masks.',
    questions: [
      { id: 'q-h-1', label: 'Select your hair concerns', type: 'radio', options: ['Dry and Damaged', 'Frizz Control', 'Thinning / Volume Boost', 'Color Protection'], required: true },
      { id: 'q-h-2', label: 'Choose your desired Glossy Locks premium products', type: 'radio', options: ['Shampoo + Smoother Combo', 'Nourishing Serum', 'Deep Hydration Mask', 'Full Restructuring Bundle'], required: true },
      { id: 'q-h-3', label: 'Upload a picture of your current hair for our lead stylist to review', type: 'fileupload', required: false },
      { id: 'q-h-4', label: 'I authorize standard shipping and billing processing fees', type: 'checkbox', required: true }
    ]
  }
];

export default function ConsentFormBuilder({ tenant }: ConsentFormBuilderProps) {
  // Persistence key
  const TEMPLATE_STORAGE_KEY = `ks_form_template_${tenant.id}`;
  const SUBMISSIONS_STORAGE_KEY = `ks_form_submissions_${tenant.id}`;

  const [formTitle, setFormTitle] = useState('Dermal Treatment Consent Form');
  const [formTrigger, setFormTrigger] = useState<'booking' | 'before_24h' | 'after_visit'>('booking');
  const [formQuestions, setFormQuestions] = useState<FormQuestion[]>([
    { id: 'q-1', label: 'Are you currently pregnant or breastfeeding?', type: 'radio', options: ['Yes', 'No'], required: true },
    { id: 'q-2', label: 'Please specify any skin allergies or medical concerns', type: 'text', placeholder: 'e.g. skin rashes, active acne', required: false, conditionalOn: 'q-1', conditionalValue: 'Yes' },
    { id: 'q-3', label: 'I authorize treatment and confirm a patch test was completed safely', type: 'checkbox', required: true },
    { id: 'q-4', label: 'Digital Signature and Full Legal Agreement', type: 'signature', required: true }
  ]);

  // Active question selected for styling/editing details in sidebar
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>('q-1');

  // Drag and Drop active status
  const [draggedType, setDraggedType] = useState<string | null>(null);
  const [draggedQuestionIndex, setDraggedQuestionIndex] = useState<number | null>(null);

  // Success state for design compile
  const [notif, setNotif] = useState('');

  // Interactive Live preview states
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, any>>({});
  const [liveIsSigned, setLiveIsSigned] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submittedBy, setSubmittedBy] = useState('Sarah Jenkins (Walk-in)');

  // Form analytics simulation
  const [formViews, setFormViews] = useState(1402);
  const [formSubmissionsCount, setFormSubmissionsCount] = useState(240);

  // Active sub-navigation inside the form builder workspace
  const [builderTab, setBuilderTab] = useState<'build' | 'templates' | 'submissions' | 'integrations'>('build');

  // Form Submissions Log
  const [submissionsList, setSubmissionsList] = useState<Array<{
    id: string;
    clientName: string;
    formTitle: string;
    date: string;
    answers: Record<string, string>;
    status: 'Completed' | 'Pending';
  }>>([]);

  const [activeClients, setActiveClients] = useState<ClientProfile[]>([]);

  useEffect(() => {
    const loadConsentData = async () => {
      const provider = getDataProvider();
      
      // Load active clients
      const clientsList = await provider.getClients(tenant.id);
      setActiveClients(clientsList);
      
      // Load local template via provider
      const templates = await provider.getConsentTemplates(tenant.id);
      if (templates.length > 0) {
        const parsed = templates[0]; // Active template
        setFormTitle(parsed.title || 'Dermal Treatment Consent Form');
        setFormTrigger(parsed.trigger || 'booking');
        if (parsed.questions && Array.isArray(parsed.questions)) {
          setFormQuestions(parsed.questions);
          if (parsed.questions.length > 0) {
            setSelectedQuestionId(parsed.questions[0].id);
          }
        }
      }

      // Load submissions via provider
      const submissions = await provider.getConsentSubmissions(tenant.id);
      if (submissions.length > 0) {
        setSubmissionsList(submissions);
      } else {
        await seedInitialSubmissions();
      }
    };

    loadConsentData();
  }, [tenant]);

  const seedInitialSubmissions = async () => {
    const defaultSubs = [
      {
        id: 'sub-1',
        clientName: 'Chloe Bennett',
        formTitle: 'Dermal Treatment Consent Form',
        date: '2026-07-16 10:25 AM',
        answers: {
          'q-1': 'No',
          'q-2': 'None',
          'q-3': 'true',
          'q-4': 'Signed John Doe'
        },
        status: 'Completed' as const
      },
      {
        id: 'sub-2',
        clientName: 'Marcus Sterling',
        formTitle: 'Dermal Treatment Consent Form',
        date: '2026-07-15 03:40 PM',
        answers: {
          'q-1': 'Yes',
          'q-2': 'Suffers from standard dry skin/latex irritation',
          'q-3': 'true',
          'q-4': 'Signed M. Sterling'
        },
        status: 'Completed' as const
      }
    ];
    setSubmissionsList(defaultSubs);
    const provider = getDataProvider();
    await provider.saveConsentSubmissions(tenant.id, defaultSubs);
  };

  const triggerNotif = (msg: string) => {
    setNotif(msg);
    setTimeout(() => setNotif(''), 4000);
  };

  const saveFormToStorage = async (updatedQuestions: FormQuestion[], title = formTitle, trigger = formTrigger) => {
    const data = { title, trigger, questions: updatedQuestions };
    const provider = getDataProvider();
    await provider.saveConsentTemplates(tenant.id, [data]);
  };

  // Drag and drop handlers for NEW question elements
  const handleTypeDragStart = (e: React.DragEvent, type: string) => {
    setDraggedType(type);
    setDraggedQuestionIndex(null);
    e.dataTransfer.setData('text/plain', type);
  };

  // Drag and drop handlers for RE-ORDERING existing questions
  const handleQuestionDragStart = (e: React.DragEvent, index: number) => {
    setDraggedQuestionIndex(index);
    setDraggedType(null);
    e.dataTransfer.setData('text/plain', `reorder-${index}`);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDropOnCanvas = (e: React.DragEvent, targetIndex?: number) => {
    e.preventDefault();
    const dropData = e.dataTransfer.getData('text/plain');

    if (draggedType) {
      // Adding a new question type
      const newId = `q-${Date.now()}`;
      let label = 'Untitled Question';
      let options: string[] | undefined = undefined;
      let placeholder = '';

      switch (draggedType) {
        case 'text':
          label = 'Explain any relevant health conditions / symptoms';
          placeholder = 'Type details here...';
          break;
        case 'checkbox':
          label = 'I agree to the cancellation policy and general liability terms';
          break;
        case 'radio':
          label = 'Do you have skin sensitivities or high blood pressure?';
          options = ['Yes', 'No', 'Unsure'];
          break;
        case 'signature':
          label = 'Digital Legal Signature and Authorization';
          break;
        case 'rating':
          label = 'Rate your treatment satisfaction level';
          break;
        case 'email':
          label = 'Provide your alternative contact email';
          placeholder = 'client@example.com';
          break;
        case 'phone':
          label = 'SMS reminder mobile number';
          placeholder = '+44 7...';
          break;
        case 'fileupload':
          label = 'Attach previous allergy patch test results or styling references';
          break;
      }

      const newQ: FormQuestion = {
        id: newId,
        label,
        type: draggedType as any,
        options,
        required: true,
        placeholder
      };

      let updated = [...formQuestions];
      if (typeof targetIndex === 'number') {
        updated.splice(targetIndex, 0, newQ);
      } else {
        updated.push(newQ);
      }

      setFormQuestions(updated);
      setSelectedQuestionId(newId);
      saveFormToStorage(updated);
      setFormSubmissionsCount(formSubmissionsCount + 1);
      triggerNotif(`Added a new ${draggedType.toUpperCase()} element to the drag-and-drop canvas!`);
    } else if (draggedQuestionIndex !== null && typeof targetIndex === 'number') {
      // Reordering existing questions
      const updated = [...formQuestions];
      const [removed] = updated.splice(draggedQuestionIndex, 1);
      updated.splice(targetIndex, 0, removed);
      setFormQuestions(updated);
      saveFormToStorage(updated);
      triggerNotif('Re-ordered form elements successfully.');
    }

    setDraggedType(null);
    setDraggedQuestionIndex(null);
  };

  const removeQuestion = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const updated = formQuestions.filter(q => q.id !== id);
    setFormQuestions(updated);
    if (selectedQuestionId === id) {
      setSelectedQuestionId(updated.length > 0 ? updated[0].id : null);
    }
    saveFormToStorage(updated);
    triggerNotif('Removed question field from builder.');
  };

  const updateSelectedQuestion = (key: keyof FormQuestion, value: any) => {
    if (!selectedQuestionId) return;
    const updated = formQuestions.map(q => {
      if (q.id === selectedQuestionId) {
        return { ...q, [key]: value };
      }
      return q;
    });
    setFormQuestions(updated);
    saveFormToStorage(updated);
  };

  // Add multiple options helper
  const handleAddOption = (optText: string) => {
    if (!selectedQuestionId || !optText.trim()) return;
    const q = formQuestions.find(f => f.id === selectedQuestionId);
    if (!q) return;
    const currentOpts = q.options || [];
    if (currentOpts.includes(optText.trim())) return;
    const updatedOpts = [...currentOpts, optText.trim()];
    updateSelectedQuestion('options', updatedOpts);
  };

  const handleRemoveOption = (optIndex: number) => {
    if (!selectedQuestionId) return;
    const q = formQuestions.find(f => f.id === selectedQuestionId);
    if (!q || !q.options) return;
    const updatedOpts = q.options.filter((_, idx) => idx !== optIndex);
    updateSelectedQuestion('options', updatedOpts);
  };

  // Deploy reusable template
  const handleDeployTemplate = () => {
    saveFormToStorage(formQuestions, formTitle, formTrigger);
    triggerNotif(`Successfully compiled and activated live form template "${formTitle}" for all clients!`);
  };

  // Fast-create with template
  const applyPreloadedTemplate = (tpl: typeof DEFAULT_TEMPLATES[0]) => {
    setFormTitle(tpl.title);
    setFormQuestions(tpl.questions as any);
    if (tpl.questions.length > 0) {
      setSelectedQuestionId(tpl.questions[0].id);
    }
    saveFormToStorage(tpl.questions as any, tpl.title);
    setBuilderTab('build');
    triggerNotif(`Applied pre-made "${tpl.title}" template.`);
  };

  // Submit mock client entry from live preview
  const handleClientSubmitMock = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitSuccess(true);
    
    // Add to submissions list
    const answers: Record<string, string> = {};
    formQuestions.forEach(q => {
      answers[q.id] = String(previewAnswers[q.id] || 'Not answered');
    });

    const newSub = {
      id: `sub-${Date.now()}`,
      clientName: submittedBy,
      formTitle: formTitle,
      date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      answers,
      status: 'Completed' as const
    };

    const updatedSubs = [newSub, ...submissionsList];
    setSubmissionsList(updatedSubs);
    
    const provider = getDataProvider();
    await provider.saveConsentSubmissions(tenant.id, updatedSubs);

    // Increase stats
    setFormSubmissionsCount(prev => prev + 1);

    // Event outbound logs simulation via KS-OS Engine
    await provider.triggerEvent(`consent-${Date.now()}`, submittedBy, 'Completed', {
      eventType: 'ConsentFormFilled',
      clientName: submittedBy,
      formTitle: formTitle,
      timestamp: new Date().toISOString()
    });

    setTimeout(() => {
      setSubmitSuccess(false);
      setPreviewAnswers({});
      setLiveIsSigned(false);
    }, 4500);
  };

  return (
    <div className="space-y-6 font-sans text-slate-800">
      
      {/* Title & Introduction Banner */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/60 shadow-sm relative overflow-hidden">
        <div className="absolute right-0 top-0 w-44 h-44 bg-indigo-500/5 rounded-full blur-3xl"></div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="text-[10px] tracking-widest uppercase bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full font-black border border-indigo-100 flex items-center gap-1.5 w-fit">
              <Sparkles className="w-3 h-3 text-indigo-600 animate-pulse" /> Drag-and-Drop Editor
            </span>
            <h2 className="text-xl font-black text-slate-900 tracking-tight mt-1.5">
              Simplify form creation with an intuitive form builder
            </h2>
            <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
              Create gorgeous, high-converting checkout questionnaires, electronic medical consent papers, and client satisfaction surveys. With our simple (yet powerful!) online form builder, 95% of our customers collect more data with less effort.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setFormTitle('Dermal and Aesthetics Consent Form');
                setFormQuestions(DEFAULT_TEMPLATES[0].questions as any);
                setSelectedQuestionId('q-d-1');
                triggerNotif('Reset canvas to master aesthetics consent preset.');
              }}
              className="bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 font-extrabold text-xs px-4 py-2.5 rounded-xl transition"
            >
              Reset to Blank
            </button>
            <button
              onClick={handleDeployTemplate}
              className="bg-slate-950 hover:bg-slate-900 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl transition flex items-center gap-1.5 shadow-md"
            >
              <CheckSquare className="w-4 h-4 text-emerald-400" /> Save & Deploy Template
            </button>
          </div>
        </div>

        {/* Builder internal sub-tabs */}
        <div className="flex border-b border-slate-200 mt-6 -mx-6 px-6">
          <div className="flex gap-1.5 text-xs font-bold -mb-px">
            <button
              onClick={() => setBuilderTab('build')}
              className={`pb-3 px-4 transition relative flex items-center gap-1.5 ${builderTab === 'build' ? 'text-slate-950 font-black border-b-2 border-slate-950' : 'text-slate-400 hover:text-slate-700'}`}
            >
              <Laptop className="w-4 h-4" /> Drag & Drop Canvas
            </button>
            <button
              onClick={() => setBuilderTab('templates')}
              className={`pb-3 px-4 transition relative flex items-center gap-1.5 ${builderTab === 'templates' ? 'text-slate-950 font-black border-b-2 border-slate-950' : 'text-slate-400 hover:text-slate-700'}`}
            >
              <Layers className="w-4 h-4" /> 1,500 Templates
              <span className="bg-amber-100 text-amber-800 text-[9px] px-1.5 py-0.2 rounded font-black uppercase">PREMIUM</span>
            </button>
            <button
              onClick={() => setBuilderTab('submissions')}
              className={`pb-3 px-4 transition relative flex items-center gap-1.5 ${builderTab === 'submissions' ? 'text-slate-950 font-black border-b-2 border-slate-950' : 'text-slate-400 hover:text-slate-700'}`}
            >
              <Database className="w-4 h-4" /> Filled Submissions ({submissionsList.length})
            </button>
            <button
              onClick={() => setBuilderTab('integrations')}
              className={`pb-3 px-4 transition relative flex items-center gap-1.5 ${builderTab === 'integrations' ? 'text-slate-950 font-black border-b-2 border-slate-950' : 'text-slate-400 hover:text-slate-700'}`}
            >
              <RefreshCw className="w-4 h-4" /> Connected Apps & APIs
            </button>
          </div>
        </div>
      </div>

      {notif && (
        <div className="bg-slate-900 text-white border border-slate-800 p-4 rounded-2xl text-xs flex gap-2.5 items-center shadow-xl animate-in fade-in duration-300">
          <Sparkle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="font-bold">{notif}</span>
        </div>
      )}

      {/* ================= BUILDER WORKSPACE CANVAS ================= */}
      {builderTab === 'build' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* LEFT RAIL: DRAGGABLE FIELDS (3 cols) */}
          <div className="lg:col-span-3 space-y-4">
            <div className="bg-white rounded-2xl p-4 border border-slate-200/60 shadow-xs">
              <h3 className="text-xs font-black uppercase text-slate-400 tracking-wider mb-3">Draggable Question Types</h3>
              <p className="text-[10px] text-slate-400 mb-3.5 leading-relaxed font-semibold">
                Drag a question type below and drop it anywhere into the center canvas Dropzone.
              </p>

              <div className="space-y-2">
                {[
                  { type: 'text', label: 'Single Line Text', desc: 'Medical detail entry / notes', icon: AlignLeft, color: 'text-blue-500 bg-blue-50 border-blue-200' },
                  { type: 'radio', label: 'Multiple Choice (Radio)', desc: 'Yes / No or options selections', icon: Radio, color: 'text-purple-500 bg-purple-50 border-purple-200' },
                  { type: 'checkbox', label: 'Consent Checkbox', desc: 'Accept terms or privacy waiver', icon: CheckSquare, color: 'text-emerald-500 bg-emerald-50 border-emerald-200' },
                  { type: 'signature', label: 'Legal Digital Signature', desc: 'Authentic touch-to-sign pad', icon: PenTool, color: 'text-indigo-500 bg-indigo-50 border-indigo-200' },
                  { type: 'rating', label: 'Rating and Stars Slider', desc: 'Star rank questions 1-5', icon: Star, color: 'text-amber-500 bg-amber-50 border-amber-200' },
                  { type: 'email', label: 'Verified Email Box', desc: 'Validated address checker', icon: Mail, color: 'text-rose-500 bg-rose-50 border-rose-200' },
                  { type: 'phone', label: 'Verified Phone / SMS', desc: 'Standard mobile formats', icon: Laptop, color: 'text-sky-500 bg-sky-50 border-sky-200' },
                  { type: 'fileupload', label: 'Medical File Upload', desc: 'Attach photos, patch tests, PDFs', icon: FileUp, color: 'text-violet-500 bg-violet-50 border-violet-200' }
                ].map(item => (
                  <div
                    key={item.type}
                    draggable
                    onDragStart={(e) => handleTypeDragStart(e, item.type)}
                    className="p-3 bg-white border border-slate-200 rounded-xl flex items-center gap-3 cursor-grab hover:border-slate-400 active:cursor-grabbing hover:shadow-xs transition group text-left"
                    title="Drag and drop onto the canvas"
                  >
                    <div className={`p-2 rounded-lg border ${item.color.split(' ')[1]} ${item.color.split(' ')[2]} ${item.color.split(' ')[0]}`}>
                      <item.icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-slate-800">{item.label}</p>
                      <p className="text-[9px] text-slate-400 font-semibold truncate mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Stats Overview */}
            <div className="bg-slate-900 rounded-2xl p-4 text-white space-y-3 shadow-sm relative overflow-hidden">
              <div className="absolute right-0 bottom-0 w-20 h-20 bg-indigo-500/10 rounded-full blur-xl"></div>
              <h4 className="text-[10px] font-black uppercase text-indigo-300 tracking-wider">AI Optimization Tips</h4>
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-300 font-medium">Form Views Today</span>
                  <span className="font-mono font-black text-indigo-200">{formViews}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-300 font-medium">Submissions Received</span>
                  <span className="font-mono font-black text-indigo-200">{formSubmissionsCount}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-300 font-medium">Completion Rate</span>
                  <span className="font-mono font-black text-emerald-400">95.4%</span>
                </div>
              </div>
              <div className="pt-2 border-t border-slate-800 text-[10px] text-slate-400 font-semibold leading-relaxed">
                ✓ <span className="text-slate-200 font-black">HIPAA & GDPR-ready protection</span>. Responses are encrypted and saved locally with AES-256.
              </div>
            </div>
          </div>

          {/* CENTER: INTERACTIVE DROPZONE CANVAS (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            
            {/* Form Settings (Title / Trigger) */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200/60 shadow-xs space-y-3">
              <div>
                <label className="text-[9px] font-extrabold text-slate-400 block uppercase tracking-wider mb-1">Form Name / Header</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => { setFormTitle(e.target.value); saveFormToStorage(formQuestions, e.target.value); }}
                  placeholder="e.g. Skin Peeling Consent Agreement"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="text-[9px] font-extrabold text-slate-400 block uppercase tracking-wider mb-1">Auto-Remind & Dispatch Rules</label>
                <select
                  value={formTrigger}
                  onChange={(e) => { setFormTrigger(e.target.value as any); saveFormToStorage(formQuestions, formTitle, e.target.value as any); }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none"
                >
                  <option value="booking">Instantly dispatch via WhatsApp/SMS when booking confirmed</option>
                  <option value="before_24h">SMS reminder 24 hours prior to appointment</option>
                  <option value="after_visit">Dispatched immediately after visit check-out (Feedback review)</option>
                </select>
              </div>
            </div>

            {/* THE DROPZONE CANVAS */}
            <div 
              onDragOver={handleDragOver}
              onDrop={(e) => handleDropOnCanvas(e)}
              className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl p-5 min-h-[460px] relative space-y-3.5 transition hover:border-indigo-400"
            >
              <div className="text-center pb-2 border-b border-slate-200/60">
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Drag & Drop Form Workspace</p>
                <p className="text-[9px] text-slate-400 mt-0.5">Order fields by dragging the grip icon. Click to edit settings.</p>
              </div>

              {formQuestions.map((q, idx) => {
                const isSelected = selectedQuestionId === q.id;

                return (
                  <div
                    key={q.id}
                    draggable
                    onDragStart={(e) => handleQuestionDragStart(e, idx)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDropOnCanvas(e, idx)}
                    onClick={() => setSelectedQuestionId(q.id)}
                    className={`p-4 rounded-2xl bg-white border cursor-pointer transition relative group ${isSelected ? 'border-indigo-500 shadow-md ring-1 ring-indigo-500/20' : 'border-slate-200 hover:border-slate-300 shadow-xs'}`}
                  >
                    {/* Drag Handle indicator */}
                    <div className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition cursor-grab text-slate-400">
                      <GripVertical className="w-4 h-4" />
                    </div>

                    <div className="pl-4 pr-1">
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0">
                          <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                            Q{idx + 1}: {q.type}
                          </span>
                          <h4 className="text-xs font-extrabold text-slate-800 mt-1.5 leading-snug">{q.label}</h4>
                          {q.placeholder && (
                            <p className="text-[10px] text-slate-400 mt-0.5 italic">Placeholder: {q.placeholder}</p>
                          )}
                          {q.options && q.options.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {q.options.map(opt => (
                                <span key={opt} className="text-[9px] bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-md">
                                  {opt}
                                </span>
                              ))}
                            </div>
                          )}
                          {q.conditionalOn && (
                            <div className="mt-1.5 text-[9px] text-amber-600 font-bold flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded-md w-fit">
                              <ShieldAlert className="w-3 h-3" /> Conditionally visible if Q{formQuestions.findIndex(f => f.id === q.conditionalOn) + 1} = "{q.conditionalValue}"
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {q.required && (
                            <span className="text-[9px] text-rose-500 bg-rose-50 border border-rose-100 px-1.5 py-0.2 rounded font-black uppercase">
                              Required
                            </span>
                          )}
                          <button
                            onClick={(e) => removeQuestion(q.id, e)}
                            className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition"
                            title="Delete field"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {formQuestions.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-2">
                  <Laptop className="w-8 h-8 text-slate-300 animate-bounce" />
                  <p className="text-xs font-black text-slate-400 uppercase tracking-wider">Dropzone Canvas is Empty</p>
                  <p className="text-[10px] text-slate-400 max-w-xs font-medium">
                    Drag elements from the left panel and drop them here to start building your consent questions!
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT RAIL: SELECTED FIELD ATTRIBUTES & LIVE PROPERTIES (4 cols) */}
          <div className="lg:col-span-4 space-y-4">
            
            {/* Edit Field Sidebar */}
            {selectedQuestionId ? (() => {
              const q = formQuestions.find(f => f.id === selectedQuestionId);
              if (!q) return <div className="p-4 bg-white rounded-2xl border text-center text-slate-400 text-xs">Select a question to customize.</div>;

              return (
                <div className="bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs space-y-4">
                  <div className="border-b pb-3">
                    <span className="text-[9px] text-slate-400 uppercase font-black tracking-wider block">Question Editor Workspace</span>
                    <h4 className="text-xs font-black text-indigo-700 mt-1 flex items-center gap-1">
                      <Settings className="w-4 h-4 animate-spin" style={{ animationDuration: '6s' }} /> Customize Selected Field
                    </h4>
                  </div>

                  {/* Question label text */}
                  <div>
                    <label className="text-[9px] font-extrabold text-slate-400 block uppercase tracking-wider mb-1">Question Label / Heading</label>
                    <textarea
                      value={q.label}
                      rows={2}
                      onChange={(e) => updateSelectedQuestion('label', e.target.value)}
                      className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-slate-950"
                    />
                  </div>

                  {/* Placeholder */}
                  {q.type === 'text' && (
                    <div>
                      <label className="text-[9px] font-extrabold text-slate-400 block uppercase tracking-wider mb-1">Input Placeholder Tip</label>
                      <input
                        type="text"
                        value={q.placeholder || ''}
                        onChange={(e) => updateSelectedQuestion('placeholder', e.target.value)}
                        placeholder="e.g. Please disclose allergy medications"
                        className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none"
                      />
                    </div>
                  )}

                  {/* Required Toggle */}
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                    <div>
                      <p className="text-xs font-extrabold text-slate-800">Mandatory Response</p>
                      <p className="text-[9px] text-slate-400 font-semibold">User cannot checkout without filling this.</p>
                    </div>
                    <button
                      onClick={() => updateSelectedQuestion('required', !q.required)}
                      className={`w-10 h-6 rounded-full p-1 transition-colors ${q.required ? 'bg-indigo-600' : 'bg-slate-300'} flex items-center`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform ${q.required ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {/* Options builder for Radio Multiple choice */}
                  {q.type === 'radio' && (
                    <div className="space-y-2">
                      <label className="text-[9px] font-extrabold text-slate-400 block uppercase tracking-wider">Multiple Choice Choices</label>
                      <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                        {(q.options || []).map((opt, oIdx) => (
                          <div key={opt} className="flex justify-between items-center p-2 bg-slate-50 rounded-lg border text-xs font-semibold">
                            <span>{opt}</span>
                            <button
                              onClick={() => handleRemoveOption(oIdx)}
                              className="text-rose-500 hover:bg-rose-50 p-1 rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Add option input sub-row */}
                      <form onSubmit={(e) => {
                        e.preventDefault();
                        const f = e.currentTarget.elements.namedItem('optVal') as HTMLInputElement;
                        if (f && f.value.trim()) {
                          handleAddOption(f.value.trim());
                          f.value = '';
                        }
                      }} className="flex gap-1.5">
                        <input
                          type="text"
                          name="optVal"
                          placeholder="e.g. Maybe"
                          className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                        />
                        <button
                          type="submit"
                          className="px-3 bg-indigo-600 text-white font-bold text-xs rounded-lg hover:bg-indigo-500"
                        >
                          Add Option
                        </button>
                      </form>
                    </div>
                  )}

                  {/* Smart Conditional logic (Branching) */}
                  <div className="p-3 bg-indigo-50/40 border border-indigo-100 rounded-2xl space-y-2">
                    <p className="text-[9px] font-black text-indigo-700 uppercase tracking-widest flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5 text-indigo-600 animate-pulse" /> Smart Logic Branching
                    </p>
                    <p className="text-[10px] text-slate-500 leading-normal font-semibold">
                      Make this question visible ONLY if another multiple-choice question has a specific answer.
                    </p>

                    <div>
                      <label className="text-[9px] font-bold text-indigo-700 block uppercase">Conditional On Question</label>
                      <select
                        value={q.conditionalOn || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateSelectedQuestion('conditionalOn', val ? val : undefined);
                        }}
                        className="w-full mt-1 p-1.5 bg-white border rounded text-xs font-semibold"
                      >
                        <option value="">-- Always Visible --</option>
                        {formQuestions
                          .filter(other => other.id !== q.id && other.type === 'radio')
                          .map((other, oIdx) => (
                            <option key={other.id} value={other.id}>Q{oIdx + 1}: {other.label.slice(0, 30)}...</option>
                          ))}
                      </select>
                    </div>

                    {q.conditionalOn && (
                      <div>
                        <label className="text-[9px] font-bold text-indigo-700 block uppercase">If the selected answer is</label>
                        <input
                          type="text"
                          value={q.conditionalValue || ''}
                          onChange={(e) => updateSelectedQuestion('conditionalValue', e.target.value)}
                          placeholder="e.g. Yes"
                          className="w-full mt-1 p-1.5 bg-white border rounded text-xs font-semibold"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })() : (
              <div className="bg-white rounded-2xl p-5 border text-center text-slate-400 text-xs">
                Select a canvas element to configure smart properties and branching options.
              </div>
            )}

            {/* LIVE CUSTOMER PREVIEW & INTERACTIVE TESTING */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200/60 shadow-xs space-y-4">
              <div className="border-b pb-3">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Client View Simulator</span>
                <h4 className="font-extrabold text-slate-800 mt-1 flex items-center gap-1.5">
                  <Eye className="w-4 h-4 text-emerald-500" /> Interactive Form Live View
                </h4>
              </div>

              {submitSuccess ? (
                <div className="text-center py-10 space-y-3.5 bg-emerald-50 rounded-2xl p-4 border border-emerald-100">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto animate-bounce" />
                  <h5 className="font-extrabold text-emerald-950 text-xs">Mock Consent Submitted!</h5>
                  <p className="text-[10px] text-emerald-800 max-w-xs mx-auto leading-relaxed">
                    Form answers securely stored in browser database and synced with {submittedBy}'s legal CRM file.
                  </p>
                  <span className="text-[9px] font-mono font-bold bg-white px-2 py-0.5 rounded border text-emerald-600 shadow-xs inline-block">
                    MD5-SSL SHA-256 Verified
                  </span>
                </div>
              ) : (
                <form onSubmit={handleClientSubmitMock} className="space-y-3.5 text-xs text-slate-600">
                  {/* Mock tester select */}
                  <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center justify-between gap-1.5">
                    <div>
                      <label className="text-[9px] font-extrabold text-slate-400 block uppercase">Test Submitting Client</label>
                      <select
                        value={submittedBy}
                        onChange={(e) => setSubmittedBy(e.target.value)}
                        className="bg-transparent border-0 font-bold text-slate-800 p-0 focus:ring-0 text-xs cursor-pointer focus:outline-none"
                      >
                        {activeClients.map(c => (
                          <option key={c.id} value={c.name}>{c.name}</option>
                        ))}
                        <option value="Anonymous Guest Client">Anonymous Guest Client</option>
                      </select>
                    </div>
                    <span className="text-[8px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-black uppercase">CRM Sync</span>
                  </div>

                  {/* Render simulated questionnaire */}
                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {formQuestions.map((q) => {
                      // Conditional check
                      if (q.conditionalOn) {
                        const parentAns = previewAnswers[q.conditionalOn];
                        if (parentAns !== q.conditionalValue) return null;
                      }

                      return (
                        <div key={q.id} className="p-3 bg-slate-50/70 border border-slate-100 rounded-xl space-y-1.5">
                          <label className="font-extrabold text-slate-800 block text-xs">
                            {q.label} {q.required && <span className="text-rose-500">*</span>}
                          </label>

                          {q.type === 'text' && (
                            <input
                              type="text"
                              required={q.required}
                              value={previewAnswers[q.id] || ''}
                              onChange={(e) => setPreviewAnswers({ ...previewAnswers, [q.id]: e.target.value })}
                              placeholder={q.placeholder || 'Type your details...'}
                              className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs"
                            />
                          )}

                          {q.type === 'email' && (
                            <input
                              type="email"
                              required={q.required}
                              value={previewAnswers[q.id] || ''}
                              onChange={(e) => setPreviewAnswers({ ...previewAnswers, [q.id]: e.target.value })}
                              placeholder="client@gmail.com"
                              className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-mono"
                            />
                          )}

                          {q.type === 'phone' && (
                            <input
                              type="tel"
                              required={q.required}
                              value={previewAnswers[q.id] || ''}
                              onChange={(e) => setPreviewAnswers({ ...previewAnswers, [q.id]: e.target.value })}
                              placeholder="+44 7700 900077"
                              className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-mono"
                            />
                          )}

                          {q.type === 'radio' && (
                            <div className="flex flex-wrap gap-3 mt-1 font-bold text-slate-700">
                              {(q.options || ['Yes', 'No']).map(opt => (
                                <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                                  <input
                                    type="radio"
                                    required={q.required}
                                    name={`preview-${q.id}`}
                                    value={opt}
                                    checked={previewAnswers[q.id] === opt}
                                    onChange={() => setPreviewAnswers({ ...previewAnswers, [q.id]: opt })}
                                    className="text-slate-900 focus:ring-slate-950 w-3.5 h-3.5"
                                  />
                                  <span>{opt}</span>
                                </label>
                              ))}
                            </div>
                          )}

                          {q.type === 'checkbox' && (
                            <label className="flex items-start gap-2 cursor-pointer mt-1 font-bold text-slate-700">
                              <input
                                type="checkbox"
                                required={q.required}
                                checked={!!previewAnswers[q.id]}
                                onChange={(e) => setPreviewAnswers({ ...previewAnswers, [q.id]: e.target.checked })}
                                className="rounded text-slate-950 focus:ring-slate-950 mt-0.5"
                              />
                              <span className="text-[10px] leading-tight text-slate-500">I confirm the accuracy of my statement and authorize the treatment.</span>
                            </label>
                          )}

                          {q.type === 'rating' && (
                            <div className="flex gap-1.5 mt-1">
                              {[1, 2, 3, 4, 5].map(star => (
                                <button
                                  key={star}
                                  type="button"
                                  onClick={() => setPreviewAnswers({ ...previewAnswers, [q.id]: star })}
                                  className="transition"
                                >
                                  <Star className={`w-6 h-6 ${previewAnswers[q.id] >= star ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}`} />
                                </button>
                              ))}
                            </div>
                          )}

                          {q.type === 'fileupload' && (
                            <div className="h-14 bg-white border border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 text-slate-400 transition">
                              <FileUp className="w-4 h-4 text-slate-400" />
                              <span className="text-[9px] text-slate-400 font-bold mt-1">Click or drag photos to upload</span>
                            </div>
                          )}

                          {q.type === 'signature' && (
                            <div className="space-y-1.5">
                              <div
                                onClick={() => {
                                  setLiveIsSigned(true);
                                  setPreviewAnswers({ ...previewAnswers, [q.id]: `Signed by ${submittedBy}` });
                                }}
                                className="h-16 bg-white border border-dashed rounded-lg flex items-center justify-center cursor-pointer hover:bg-slate-50 text-slate-400 transition"
                              >
                                {liveIsSigned ? (
                                  <span className="font-serif italic text-sm font-black text-indigo-700">
                                    {submittedBy} ✓ signed
                                  </span>
                                ) : (
                                  <span className="text-[9px] text-slate-400 font-bold">Tap here to sign digitally</span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-slate-950 hover:bg-slate-900 text-white font-extrabold text-xs py-2.5 rounded-xl transition cursor-pointer"
                  >
                    Submit Test Questionnaire
                  </button>
                </form>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ================= 1,500 TEMPLATES DIRECTORY TAB ================= */}
      {builderTab === 'templates' && (
        <div className="space-y-6">
          <div className="bg-indigo-950 text-white rounded-2xl p-5 border border-indigo-900 flex justify-between gap-4 items-center">
            <div>
              <span className="text-[9px] font-black uppercase text-indigo-300 tracking-wider">Quick Preset Installs</span>
              <h3 className="text-sm font-bold text-white mt-1">Need a fast start? We have a pre-made template for that!</h3>
              <p className="text-[11px] text-indigo-200 mt-1 max-w-xl">
                Choose from our library of 1,500 templates that include both free and premium elements. Click any option to immediately replace your canvas with a fully styled questionnaire.
              </p>
            </div>
            <span className="bg-indigo-900 text-indigo-300 text-xs px-3.5 py-1.5 rounded-full font-bold">
              ✓ 1,500 Templates Ready
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {DEFAULT_TEMPLATES.map(tpl => (
              <div key={tpl.id} className="bg-white border rounded-2xl p-5 flex flex-col justify-between space-y-4 hover:border-slate-400 transition">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-full font-bold uppercase">
                      {tpl.category}
                    </span>
                    <span className="text-[9px] text-slate-400 font-bold uppercase">{tpl.questions.length} Question Fields</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">{tpl.title}</h4>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed">{tpl.description}</p>
                </div>

                <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                  <div className="text-[10px] text-slate-400 font-semibold italic">Includes conditional logic fields</div>
                  <button
                    onClick={() => applyPreloadedTemplate(tpl)}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-xl transition"
                  >
                    Load Preset Template
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= FILLED SUBMISSIONS RECORDS TAB ================= */}
      {builderTab === 'submissions' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs">
            <h3 className="text-xs font-black uppercase text-slate-400 tracking-wider mb-2">Secure Client Response Files</h3>
            <p className="text-[11px] text-slate-400 leading-relaxed font-semibold mb-4">
              Review and audit signed pre-appointment questionnaires filled by your clients online. These response files are automatically linked to their CRM folders.
            </p>

            <div className="space-y-3.5">
              {submissionsList.map(sub => (
                <div key={sub.id} className="p-4 bg-slate-50 border rounded-2xl">
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <h4 className="text-xs font-extrabold text-slate-900">{sub.clientName}</h4>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">Submitted: {sub.date}</p>
                    </div>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-black px-2.5 py-0.5 rounded-full uppercase">
                      ✓ GDPR SECURE
                    </span>
                  </div>

                  <div className="mt-3.5 grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-slate-200/40 pt-3">
                    {Object.entries(sub.answers).map(([qId, ans]) => {
                      const matchedQ = formQuestions.find(f => f.id === qId);
                      const qLabel = matchedQ ? matchedQ.label : `Question ${qId}`;
                      return (
                        <div key={qId} className="bg-white p-2.5 rounded-xl border border-slate-150 text-[11px]">
                          <span className="text-[9px] font-bold text-slate-400 block uppercase mb-1">{qLabel}</span>
                          <span className="font-extrabold text-slate-800">{ans === 'true' ? 'I agree and authorize ✓' : ans}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {submissionsList.length === 0 && (
                <div className="text-center py-20 text-slate-400 text-xs font-medium">No consent submissions on file for {tenant.name}.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= INTEGRATIONS & APIs TAB ================= */}
      {builderTab === 'integrations' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { name: 'Salesforce CRM Sync', desc: 'Instantly push leads, allergy markers, and treatment notes straight to your executive pipeline.', icon: Database, bg: 'bg-blue-50 border-blue-100 text-blue-600' },
              { name: 'Google Sheets Automation', desc: 'Export answers into spreadsheets in real time to build collaborative lists or backup records.', icon: AlignLeft, bg: 'bg-emerald-50 border-emerald-100 text-emerald-600' },
              { name: 'Slack Instant Alerts', desc: 'Notify styling teams immediately when an aesthetics or hair consent waiver is signed.', icon: MessageSquare, bg: 'bg-purple-50 border-purple-100 text-purple-600' },
              { name: 'Zapier Webhook Bridges', desc: 'Connect to 5,000+ other enterprise systems to trigger booking schedules automatically.', icon: Zap, bg: 'bg-orange-50 border-orange-100 text-orange-600' },
              { name: 'Calendly Integration', desc: 'Embed forms on scheduling steps on Calendly on a dark green or custom themed background.', icon: Laptop, bg: 'bg-teal-50 border-teal-100 text-teal-600' }
            ].map((app, idx) => (
              <div key={idx} className="bg-white border rounded-2xl p-5 space-y-4 hover:shadow-md transition">
                <div className="flex gap-3 items-center">
                  <div className={`p-2.5 rounded-xl border ${app.bg}`}>
                    <app.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-slate-900">{app.name}</h4>
                    <span className="text-[9px] bg-slate-100 text-slate-600 px-2 py-0.2 rounded font-bold uppercase">
                      V3 REST API
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed font-semibold">{app.desc}</p>
                <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                  <span className="text-[10px] text-emerald-600 font-bold">● Ready to Auth</span>
                  <button
                    onClick={() => triggerNotif(`Initiated auth handshake with external endpoint: ${app.name}`)}
                    className="text-[10px] bg-slate-950 text-white font-extrabold px-3 py-1.5 rounded-xl"
                  >
                    Configure
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= FOOTER / TRUST SIGNALS ================= */}
      <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200/50 space-y-3.5">
        <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider text-center">
          Trusted by 95% of the Fortune 500 & Compliance Protected
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200/40 text-xs font-semibold flex gap-2.5">
            <ShieldCheck className="w-5 h-5 text-indigo-600 shrink-0" />
            <div>
              <p className="text-slate-800 font-extrabold text-xs">Compliance & Access Control</p>
              <p className="text-[10px] text-slate-400 mt-1">GDPR-ready and HIPAA-compliant forms. Single Sign-On (SSO) secure workspace access.</p>
            </div>
          </div>
          <div className="bg-white p-3.5 rounded-xl border border-slate-200/40 text-xs font-semibold flex gap-2.5">
            <Lock className="w-5 h-5 text-indigo-600 shrink-0" />
            <div>
              <p className="text-slate-800 font-extrabold text-xs">Data Protection</p>
              <p className="text-[10px] text-slate-400 mt-1">Robust data encryption with SHA-256 SSL. Double token authentication safety measures.</p>
            </div>
          </div>
          <div className="bg-white p-3.5 rounded-xl border border-slate-200/40 text-xs font-semibold flex gap-2.5">
            <Info className="w-5 h-5 text-indigo-600 shrink-0" />
            <div>
              <p className="text-slate-800 font-extrabold text-xs">System Reliability</p>
              <p className="text-[10px] text-slate-400 mt-1">Built-in antispam and Google Captcha protection. Automated backup and recovery options.</p>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
