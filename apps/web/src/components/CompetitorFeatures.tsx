/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  FileText, ClipboardCheck, Users, Percent, Clock, DollarSign, Calendar,
  ShoppingBag, Plus, Trash2, ArrowRight, CheckCircle2, AlertCircle, 
  Send, RefreshCw, QrCode, Share2, Star, MessageSquare, ExternalLink, Copy, HelpCircle, Palette,
  Wallet, Timer, Layers
} from 'lucide-react';
import { BusinessTenant, Staff, Product, Service, Booking, ClientProfile } from '../data/types.js';
import { getDataProvider } from '../data/data-provider.js';


interface CompetitorFeaturesProps {
  tenant: BusinessTenant;
}

export default function CompetitorFeatures({ tenant }: CompetitorFeaturesProps) {
  const [activeTab, setActiveTab] = useState<'forms' | 'team' | 'retail' | 'automations' | 'waitlist' | 'resources'>('forms');
  const [notif, setNotif] = useState('');
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [clients, setClients] = useState<ClientProfile[]>([]);

  const triggerNotif = (msg: string) => {
    setNotif(msg);
    setTimeout(() => setNotif(''), 3000);
  };

  // ---------------------------------------------------------------------------
  // Tab 1: Form Builder State
  // ---------------------------------------------------------------------------
  const [formFields, setFormFields] = useState<Array<{
    id: string;
    label: string;
    type: 'text' | 'checkbox' | 'radio' | 'signature';
    options?: string[];
    required: boolean;
    conditionalOn?: string; // field id it depends on
    conditionalValue?: string; // value required to show
  }>>([
    { id: 'f-1', label: 'Are you currently pregnant or breastfeeding?', type: 'radio', options: ['Yes', 'No'], required: true },
    { id: 'f-2', label: 'Please specify any skin allergies or medical concerns', type: 'text', required: false, conditionalOn: 'f-1', conditionalValue: 'Yes' },
    { id: 'f-3', label: 'I authorize treatment and confirm a patch test was completed', type: 'checkbox', required: true },
    { id: 'f-4', label: 'Digital Signature & Agreement', type: 'signature', required: true }
  ]);

  const [formTitle, setFormTitle] = useState('Dermal Treatment Consent Form');
  const [formTrigger, setFormTrigger] = useState<'booking' | 'before_24h' | 'after_visit'>('booking');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<'text' | 'checkbox' | 'radio' | 'signature'>('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');

  // Filled values for preview
  const [previewValues, setPreviewValues] = useState<Record<string, any>>({});
  const [isSigned, setIsSigned] = useState(false);
  const [formSuccess, setFormSuccess] = useState(false);

  const addField = () => {
    if (!newFieldLabel) return;
    const optionsArray = newFieldOptions ? newFieldOptions.split(',').map(o => o.trim()) : undefined;
    const newF = {
      id: `f-${Date.now()}`,
      label: newFieldLabel,
      type: newFieldType,
      options: optionsArray,
      required: false
    };
    setFormFields([...formFields, newF]);
    setNewFieldLabel('');
    setNewFieldOptions('');
    triggerNotif('Added custom question field to digital template.');
  };

  const removeField = (id: string) => {
    setFormFields(formFields.filter(f => f.id !== id));
  };

  const saveFormTemplate = () => {
    triggerNotif(`Successfully compiled digital template: "${formTitle}"`);
  };

  const handlePreviewSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormSuccess(true);
    setTimeout(() => {
      setFormSuccess(false);
      setPreviewValues({});
      setIsSigned(false);
    }, 4000);
  };

  // ---------------------------------------------------------------------------
  // Tab 2: Team, Commissions, and Timesheets State
  // ---------------------------------------------------------------------------
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [commissionRate, setCommissionRate] = useState(10); // flat rate percent
  const [tieredThreshold, setTieredThreshold] = useState(1500); // tier limit
  const [tieredRate, setTieredRate] = useState(15); // rate if above tier
  const [commissionType, setCommissionType] = useState<'flat' | 'tiered'>('tiered');

  // Pricing override helpers
  const [overrideStaffId, setOverrideStaffId] = useState('');
  const [overrideServiceId, setOverrideServiceId] = useState('');
  const [overridePrice, setOverridePrice] = useState('');

  // Timesheets simulator
  const [timesheets, setTimesheets] = useState<Array<{
    staffId: string;
    staffName: string;
    hoursWorked: number;
    hourlyRate: number;
    salesAmount: number;
  }>>([]);

  useEffect(() => {
    const loadCompetitorData = async () => {
      const provider = getDataProvider();
      const list = await provider.getStaff(tenant.id);
      setStaffList(list);
      setStaff(list);
      
      const srvList = await provider.getServices(tenant.id);
      setServices(srvList);
      
      const pList = await provider.getProducts(tenant.id);
      setProducts(pList);

      const bList = await provider.getBookings();
      setBookings(bList.filter(b => b.tenantId === tenant.id));

      const cList = await provider.getClients(tenant.id);
      setClients(cList);

      if (list.length > 0) {
        setOverrideStaffId(list[0].id);
        setGrpStaffId(list[0].id);
        if (srvList.length > 0) {
          setOverrideServiceId(srvList[0].id);
          setGrpServiceId(srvList[0].id);
        }

        // Generate timesheet entries
        setTimesheets(list.map((s, idx) => ({
          staffId: s.id,
          staffName: s.name,
          hoursWorked: [38, 42, 35, 40][idx % 4],
          hourlyRate: [15, 18, 14, 22][idx % 4],
          salesAmount: [1800, 2450, 950, 3100][idx % 4]
        })));
      }
    };
    loadCompetitorData();
  }, [tenant]);

  const applyPriceOverride = async () => {
    if (!overrideStaffId || !overrideServiceId || !overridePrice) return;
    const updated = staffList.map(s => {
      if (s.id === overrideStaffId) {
        return {
          ...s,
          priceOverrides: {
            ...(s.priceOverrides || {}),
            [overrideServiceId]: parseFloat(overridePrice)
          }
        };
      }
      return s;
    });
    const provider = getDataProvider();
    await provider.saveStaff(tenant.id, updated);
    setStaffList(updated);
    setOverridePrice('');
    triggerNotif('Saved professional custom price override for service.');
  };

  // Calculate commission total
  const getCommissionValue = (sales: number) => {
    if (commissionType === 'flat') {
      return (sales * commissionRate) / 100;
    } else {
      if (sales > tieredThreshold) {
        return (sales * tieredRate) / 100;
      }
      return (sales * commissionRate) / 100;
    }
  };

  // ---------------------------------------------------------------------------
  // Tab 3: Retail & Purchase Orders
  // ---------------------------------------------------------------------------
  const [products, setProducts] = useState<Product[]>([]);
  const [newProdName, setNewProdName] = useState('');
  const [newProdPrice, setNewProdPrice] = useState('');
  const [newProdStock, setNewProdStock] = useState('15');
  const [newProdCategory, setNewProdCategory] = useState('Hair Care');

  // PO builder
  const [poSupplier, setPoSupplier] = useState('L\'Oréal Professional');
  const [poItems, setPoItems] = useState<Array<{ productId: string; qty: number }>>([]);
  const [poSent, setPoSent] = useState(false);

  // Click & Collect Simulation
  const [collectOrders, setCollectOrders] = useState([
    { id: 'CC-101', client: 'Charlotte Jones', item: 'Hydration Shampoo 250ml', qty: 1, status: 'Ready for Pickup', price: 18.50 },
    { id: 'CC-102', client: 'Oliver Smith', item: 'Matte Clay Wax', qty: 2, status: 'Pending Pack', price: 30.00 }
  ]);

  const addProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProdName || !newProdPrice) return;
    const newP: Product = {
      id: `p-${Date.now()}`,
      name: newProdName,
      sku: `SKU-${Date.now().toString().slice(-6)}`,
      price: parseFloat(newProdPrice),
      stock: parseInt(newProdStock),
      category: newProdCategory
    };
    const updated = [...products, newP];
    const provider = getDataProvider();
    await provider.saveProducts(tenant.id, updated);
    setProducts(updated);
    setNewProdName('');
    setNewProdPrice('');
    triggerNotif(`Registered product "${newP.name}" inside inventory database.`);
  };

  const handlePOAdd = (productId: string) => {
    const exist = poItems.find(p => p.productId === productId);
    if (exist) {
      setPoItems(poItems.map(p => p.productId === productId ? { ...p, qty: p.qty + 5 } : p));
    } else {
      setPoItems([...poItems, { productId, qty: 10 }]);
    }
  };

  const submitPurchaseOrder = async () => {
    if (poItems.length === 0) return;
    
    // Simulate restock: add items quantity to inventory
    const updatedProducts = products.map(p => {
      const poMatch = poItems.find(po => po.productId === p.id);
      if (poMatch) {
        return {
          ...p,
          stock: p.stock + poMatch.qty
        };
      }
      return p;
    });

    const provider = getDataProvider();
    await provider.saveProducts(tenant.id, updatedProducts);
    setProducts(updatedProducts);
    setPoSent(true);
    triggerNotif(`Purchase Order dispatched to ${poSupplier}. Stocks reloaded.`);
    setTimeout(() => {
      setPoSent(false);
      setPoItems([]);
    }, 4000);
  };

  const completeClickCollect = (id: string) => {
    setCollectOrders(collectOrders.map(o => o.id === id ? { ...o, status: 'Completed & Collected' } : o));
    triggerNotif('Handover complete! Client loyalty points upgraded.');
  };

  // ---------------------------------------------------------------------------
  // Tab 4: Automations, Marketing, & Marketplace
  // ---------------------------------------------------------------------------
  const [smsTemplate, setSmsTemplate] = useState('Hi {client_name}, your appointment with {business_name} is confirmed for {booking_time}. Please complete your intake forms before arrival.');
  const [reminderHours, setReminderHours] = useState(24);
  const [enableSmartReminders, setEnableSmartReminders] = useState(true);

  // Marketing Tools
  const bookingPageLink = `https://${tenant.subdomain}.fresha-booking.com`;
  const [copiedLink, setCopiedLink] = useState(false);

  const copyLink = () => {
    navigator.clipboard.writeText(bookingPageLink);
    setCopiedLink(true);
    triggerNotif('Direct Booking Link copied to clipboard.');
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // ---------------------------------------------------------------------------
  // Tab 5: Waitlist & Group Bookings State
  // ---------------------------------------------------------------------------
  const [waitlist, setWaitlist] = useState<Array<{
    id: string;
    clientName: string;
    phone: string;
    serviceName: string;
    preferredStaff: string;
    priority: 'high_value' | 'first_in_line' | 'regular';
    dateAdded: string;
  }>>([
    { id: 'WL-1', clientName: 'Olivia Martinez', phone: '+44 7700 900077', serviceName: 'Signature Balayage & Cut', preferredStaff: 'Kasim', priority: 'high_value', dateAdded: '2026-07-16 14:20' },
    { id: 'WL-2', clientName: 'James Anderson', phone: '+44 7700 900124', serviceName: 'Executive Beard Sculpt & Groom', preferredStaff: 'Sarah', priority: 'first_in_line', dateAdded: '2026-07-16 15:10' },
    { id: 'WL-3', clientName: 'Sophia Taylor', phone: '+44 7700 900293', serviceName: 'Dermal Infusion Therapy', preferredStaff: 'Any Specialist', priority: 'regular', dateAdded: '2026-07-16 16:05' }
  ]);

  const [wlClient, setWlClient] = useState('');
  const [wlPhone, setWlPhone] = useState('');
  const [wlService, setWlService] = useState('');
  const [wlStaff, setWlStaff] = useState('Any Specialist');
  const [wlPriority, setWlPriority] = useState<'high_value' | 'first_in_line' | 'regular'>('regular');
  const [wlNotificationStrategy, setWlNotificationStrategy] = useState<'first_in_line' | 'high_value_first' | 'offer_all'>('high_value_first');

  // Group booking state
  const [grpMainClient, setGrpMainClient] = useState('Eleanor Vance');
  const [grpGuests, setGrpGuests] = useState<string[]>(['Theodora Vance', 'Luke Vance']);
  const [grpNewGuest, setGrpNewGuest] = useState('');
  const [grpServiceId, setGrpServiceId] = useState('');
  const [grpStaffId, setGrpStaffId] = useState('');
  const [grpSuccess, setGrpSuccess] = useState(false);

  // Client Wallet Search
  const [walletSearch, setWalletSearch] = useState('');
  const [selectedWalletClient, setSelectedWalletClient] = useState<{
    name: string;
    balance: number;
    giftCardCode: string;
    giftCardBalance: number;
    membership: string;
    savedCard: string;
  } | null>({
    name: 'Eleanor Vance',
    balance: 45.00,
    giftCardCode: 'FRESHA-GIFT-8839',
    giftCardBalance: 100.00,
    membership: 'Gold VIP (10% off all retail)',
    savedCard: 'Visa ending in 4929 (Verified ✓)'
  });

  // ---------------------------------------------------------------------------
  // Tab 6: Resources & Equipment State
  // ---------------------------------------------------------------------------
  const [resources, setResources] = useState<Array<{
    id: string;
    name: string;
    category: 'room' | 'equipment' | 'space';
    capacity: number;
    associatedServiceIds: string[];
    status: 'Available' | 'In Use' | 'Maintenance';
    currentUtilization: number;
  }>>([
    { id: 'R-1', name: 'Private Infrared Sauna Suite', category: 'room', capacity: 2, associatedServiceIds: [], status: 'Available', currentUtilization: 45 },
    { id: 'R-2', name: 'Cryotherapy / Cold Plunge Chamber', category: 'space', capacity: 1, associatedServiceIds: [], status: 'In Use', currentUtilization: 80 },
    { id: 'R-3', name: 'Hydradermabrasion System Laser 3B', category: 'equipment', capacity: 1, associatedServiceIds: [], status: 'Available', currentUtilization: 15 },
    { id: 'R-4', name: 'Deluxe VIP Double Treatment Room', category: 'room', capacity: 4, associatedServiceIds: [], status: 'Available', currentUtilization: 60 }
  ]);

  const [newResName, setNewResName] = useState('');
  const [newResCategory, setNewResCategory] = useState<'room' | 'equipment' | 'space'>('room');
  const [newResCapacity, setNewResCapacity] = useState(1);

  // Action methods
  const addToWaitlist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!wlClient || !wlService) return;
    const newWl = {
      id: `WL-${Date.now().toString().slice(-4)}`,
      clientName: wlClient,
      phone: wlPhone || '+44 7700 900551',
      serviceName: wlService,
      preferredStaff: wlStaff,
      priority: wlPriority,
      dateAdded: new Date().toISOString().replace('T', ' ').slice(0, 16)
    };
    setWaitlist([...waitlist, newWl]);
    setWlClient('');
    setWlPhone('');
    setWlService('');
    setWlStaff('Any Specialist');
    setWlPriority('regular');
    triggerNotif(`Added "${newWl.clientName}" to the intelligent auto-dispatch waitlist.`);
  };

  const matchWaitlistOpening = async (id: string) => {
    const matched = waitlist.find(w => w.id === id);
    if (!matched) return;
    
    // Simulate converting waitlist to active booking
    const svc = services.find(s => s.name.toLowerCase().includes(matched.serviceName.toLowerCase())) || services[0];
    const stf = staff.find(s => s.name.toLowerCase().includes(matched.preferredStaff.toLowerCase())) || staff[0] || { id: 'st-1', name: 'Specialist' };

    const bookingId = `bk-${Date.now()}`;
    const newBooking = {
      id: bookingId,
      tenantId: tenant.id,
      reference: `KS-${Math.floor(1000 + Math.random() * 9000)}-W`,
      clientName: matched.clientName,
      clientEmail: `${matched.clientName.toLowerCase().replace(' ', '')}@freshamarketplace.com`,
      clientPhone: matched.phone,
      visitType: 'Shop' as const,
      serviceId: svc?.id || 's-1',
      staffId: stf?.id || 'st-1',
      date: new Date().toISOString().split('T')[0],
      startTime: '12:00',
      endTime: '12:30',
      duration: 30,
      price: svc?.price || 50,
      paidAmount: 0,
      paymentStatus: 'Unpaid' as const,
      status: 'Confirmed' as const,
      createdAt: new Date().toISOString()
    };

    const provider = getDataProvider();
    const currentBookings = await provider.getBookings();
    const updated = [...currentBookings, newBooking];
    await provider.saveBookings(updated);
    setBookings(updated.filter(b => b.tenantId === tenant.id));
    
    // Dispatch operations log event
    await provider.triggerEvent(bookingId, matched.clientName, 'Created', {
      bookingId,
      client: matched.clientName,
      service: svc?.name || 'Treatment',
      paid: 0
    });

    setWaitlist(waitlist.filter(w => w.id !== id));
    triggerNotif(`🎉 Success! Matched opening. Sent dispatch alert SMS/Email to ${matched.clientName}. Spot secured!`);
  };

  const addGroupGuest = () => {
    if (!grpNewGuest) return;
    setGrpGuests([...grpGuests, grpNewGuest]);
    setGrpNewGuest('');
  };

  const removeGroupGuest = (index: number) => {
    setGrpGuests(grpGuests.filter((_, idx) => idx !== index));
  };

  const submitGroupBooking = async () => {
    if (!grpMainClient) return;
    const svc = services.find(s => s.id === grpServiceId) || services[0];
    const stf = staff.find(s => s.id === grpStaffId) || staff[0];

    // Create group bookings for both main client and guests
    const bookingGroupList = [grpMainClient, ...grpGuests];
    const newBookings: any[] = [];
    const provider = getDataProvider();
    
    for (let idx = 0; idx < bookingGroupList.length; idx++) {
      const client = bookingGroupList[idx];
      const bookingId = `bk-${Date.now()}-${idx}`;
      const newBk = {
        id: bookingId,
        tenantId: tenant.id,
        reference: `KS-${Math.floor(1000 + Math.random() * 9000)}-G`,
        clientName: client,
        clientEmail: `${client.toLowerCase().replace(' ', '')}@fresha-group.com`,
        clientPhone: '+44 7700 900000',
        visitType: 'Shop' as const,
        serviceId: svc?.id || 's-1',
        staffId: stf?.id || 'st-1',
        date: new Date().toISOString().split('T')[0],
        startTime: `14:${idx * 30 === 0 ? '00' : idx * 30}`,
        endTime: `14:${(idx + 1) * 30 === 60 ? '00' : (idx + 1) * 30}`,
        duration: 30,
        price: svc?.price || 50,
        paidAmount: 0,
        paymentStatus: 'Unpaid' as const,
        status: 'Confirmed' as const,
        createdAt: new Date().toISOString()
      };
      newBookings.push(newBk);

      // Trigger operations log event
      await provider.triggerEvent(bookingId, client, 'Created', {
        bookingId,
        client,
        service: svc?.name || 'Treatment',
        paid: 0
      });
    }

    const currentBookings = await provider.getBookings();
    const updated = [...currentBookings, ...newBookings];
    await provider.saveBookings(updated);
    setBookings(updated.filter(b => b.tenantId === tenant.id));

    setGrpSuccess(true);
    triggerNotif(`Group Booking with ${bookingGroupList.length} guests confirmed! Synced aligned slots.`);
    setTimeout(() => {
      setGrpSuccess(false);
      setGrpGuests(['Theodora Vance', 'Luke Vance']);
    }, 4000);
  };

  const addResource = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newResName) return;
    const newR = {
      id: `R-${Date.now().toString().slice(-4)}`,
      name: newResName,
      category: newResCategory,
      capacity: newResCapacity,
      associatedServiceIds: [],
      status: 'Available' as const,
      currentUtilization: 0
    };
    setResources([...resources, newR]);
    setNewResName('');
    setNewResCategory('room');
    setNewResCapacity(1);
    triggerNotif(`Allocated new ${newR.category}: "${newR.name}" to business asset ledger.`);
  };

  const toggleResourceStatus = (id: string) => {
    setResources(resources.map(r => {
      if (r.id === id) {
        const nextStatus = r.status === 'Available' ? 'In Use' : r.status === 'In Use' ? 'Maintenance' : 'Available';
        return {
          ...r,
          status: nextStatus,
          currentUtilization: nextStatus === 'In Use' ? 100 : nextStatus === 'Maintenance' ? 0 : 35
        };
      }
      return r;
    }));
  };

  const simulateStaffFreeBooking = async (resId: string) => {
    const res = resources.find(r => r.id === resId);
    if (!res) return;
    
    const resService = services.find(s => s.name.toLowerCase().includes(res.name.toLowerCase())) || services[0];
    
    const bookingId = `bk-${Date.now()}`;
    const newBooking = {
      id: bookingId,
      tenantId: tenant.id,
      reference: `KS-${Math.floor(1000 + Math.random() * 9000)}-R`,
      clientName: `Self-Service Booking (${res.name})`,
      clientEmail: 'resource-booking@fresha-hub.com',
      clientPhone: '+44 7700 900999',
      visitType: 'Shop' as const,
      serviceId: resService?.id || 's-1',
      staffId: 'resource-only',
      date: new Date().toISOString().split('T')[0],
      startTime: '16:00',
      endTime: '16:30',
      duration: 30,
      price: resService?.price || 40,
      paidAmount: 0,
      paymentStatus: 'Unpaid' as const,
      status: 'Confirmed' as const,
      createdAt: new Date().toISOString()
    };

    const provider = getDataProvider();
    const currentBookings = await provider.getBookings();
    const updated = [...currentBookings, newBooking];
    await provider.saveBookings(updated);
    setBookings(updated.filter(b => b.tenantId === tenant.id));

    await provider.triggerEvent(bookingId, `Self-Service (${res.name})`, 'Created', {
      bookingId,
      client: `Self-Service (${res.name})`,
      service: resService?.name || 'Equipment Block',
      paid: 0
    });

    setResources(resources.map(r => r.id === resId ? { ...r, status: 'In Use', currentUtilization: 100 } : r));
    triggerNotif(`Successfully scheduled staff-free slot for ${res.name}! Active equipment tracker engaged.`);
  };

  const handleWalletSearch = (val: string) => {
    setWalletSearch(val);
    const found = clients.find(c => c.name.toLowerCase().includes(val.toLowerCase()));
    if (found) {
      setSelectedWalletClient({
        name: found.name,
        balance: found.loyaltyPoints * 0.1,
        giftCardCode: `FRESHA-GC-${found.name.slice(0, 3).toUpperCase()}-940`,
        giftCardBalance: Math.floor(found.loyaltyPoints * 1.5),
        membership: found.loyaltyPoints > 150 ? 'Premium Platinum VIP' : 'Classic loyalty member',
        savedCard: 'Visa card ending in ' + Math.floor(1000 + Math.random() * 9000)
      });
    }
  };

  return (
    <div className="bg-slate-50 rounded-3xl p-6 border border-slate-200/50 font-sans">
      
      {/* Title & Core Subtabs */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-5 mb-6">
        <div>
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-indigo-600" /> Competitor Premium Features Hub
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Access advanced custom form builders, tiered commission models, purchase orders, and multi-channel marketing templates matching Fresha & Setmore.
          </p>
        </div>

        <div className="flex flex-wrap gap-1 bg-slate-200/60 p-1 rounded-xl text-xs font-bold w-full md:w-auto">
          <button
            onClick={() => setActiveTab('forms')}
            className={`flex-1 md:flex-none px-3 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${activeTab === 'forms' ? 'bg-slate-950 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <FileText className="w-3.5 h-3.5" /> Forms
          </button>
          <button
            onClick={() => setActiveTab('team')}
            className={`flex-1 md:flex-none px-3 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${activeTab === 'team' ? 'bg-slate-950 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <Users className="w-3.5 h-3.5" /> Team
          </button>
          <button
            onClick={() => setActiveTab('retail')}
            className={`flex-1 md:flex-none px-3 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${activeTab === 'retail' ? 'bg-slate-950 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <ShoppingBag className="w-3.5 h-3.5" /> Retail
          </button>
          <button
            onClick={() => setActiveTab('waitlist')}
            className={`flex-1 md:flex-none px-3 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${activeTab === 'waitlist' ? 'bg-slate-950 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <Timer className="w-3.5 h-3.5" /> Waitlist & Groups
          </button>
          <button
            onClick={() => setActiveTab('resources')}
            className={`flex-1 md:flex-none px-3 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${activeTab === 'resources' ? 'bg-slate-950 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <Layers className="w-3.5 h-3.5" /> Resources & Rooms
          </button>
          <button
            onClick={() => setActiveTab('automations')}
            className={`flex-1 md:flex-none px-3 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${activeTab === 'automations' ? 'bg-slate-950 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <QrCode className="w-3.5 h-3.5" /> Marketing
          </button>
        </div>
      </div>

      {notif && (
        <div className="bg-slate-900 text-white border border-slate-800 p-4 rounded-2xl text-xs flex gap-2.5 items-center mb-6 shadow-xl animate-in fade-in duration-300">
          <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />
          <span className="font-bold">{notif}</span>
        </div>
      )}

      {/* =======================================================================
          TAB 1: DIGITAL CUSTOM FORM BUILDER
          ======================================================================= */}
      {activeTab === 'forms' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Form Template Fields Editor */}
          <div className="xl:col-span-7 bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs flex flex-col space-y-6">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Palette className="w-4 h-4 text-indigo-500" /> Interactive Digital Consent Form Builder
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Build legal medical/cosmetic forms with custom logic triggers. Automatically saves filled submissions to client CRM portfolios.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-400 block mb-1">FORM TEMPLATE TITLE</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-950 focus:outline-none text-xs font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">AUTOMATION DISPATCH TRIGGER</label>
                  <select
                    value={formTrigger}
                    onChange={(e: any) => setFormTrigger(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs font-semibold"
                  >
                    <option value="booking">Immediately upon confirmed booking</option>
                    <option value="before_24h">24 hours before appointment arrival</option>
                    <option value="after_visit">Following visit completion (feedback + care)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">COMPLIANCE STATS</label>
                  <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-2.5 text-[10px] font-bold text-indigo-800 flex items-center gap-2">
                    <ClipboardCheck className="w-4 h-4 text-indigo-600" />
                    <span>88% Client completion rate. 12% Auto-reminded.</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Existing fields in current template */}
            <div className="border border-slate-100 rounded-xl divide-y bg-slate-50/50 max-h-56 overflow-y-auto">
              {formFields.map((field, index) => (
                <div key={field.id} className="p-3 flex justify-between items-center text-xs font-semibold text-slate-700">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-slate-400 font-mono">Q{index + 1}.</span>
                    <div>
                      <p className="text-slate-800 font-bold">{field.label}</p>
                      <p className="text-[10px] text-slate-400 font-medium">
                        Type: <span className="uppercase text-indigo-600">{field.type}</span>
                        {field.conditionalOn && ` (Shows if Q${formFields.findIndex(f => f.id === field.conditionalOn) + 1} = ${field.conditionalValue})`}
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={() => removeField(field.id)}
                    className="p-1 text-rose-500 hover:bg-rose-50 rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add custom field designer */}
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-3.5">
              <h4 className="text-[11px] font-black uppercase text-slate-400 tracking-wider">Add Custom Question Field</h4>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-6">
                  <label className="text-[9px] font-bold text-slate-400 uppercase">Question Label / Instructions</label>
                  <input
                    type="text"
                    placeholder="e.g. Do you suffer from latex allergies?"
                    value={newFieldLabel}
                    onChange={(e) => setNewFieldLabel(e.target.value)}
                    className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="text-[9px] font-bold text-slate-400 uppercase">Field Response Type</label>
                  <select
                    value={newFieldType}
                    onChange={(e: any) => setNewFieldType(e.target.value)}
                    className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:outline-none"
                  >
                    <option value="text">Single Line Text</option>
                    <option value="radio">Multiple Choice (Radio)</option>
                    <option value="checkbox">Consent Checkbox</option>
                    <option value="signature">Digital Signature Box</option>
                  </select>
                </div>
                <div className="md:col-span-3">
                  <label className="text-[9px] font-bold text-slate-400 uppercase">Options (Comma separated)</label>
                  <input
                    type="text"
                    disabled={newFieldType !== 'radio'}
                    placeholder="Yes, No, Unsure"
                    value={newFieldOptions}
                    onChange={(e) => setNewFieldOptions(e.target.value)}
                    className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none disabled:bg-slate-100"
                  />
                </div>
              </div>

              <div className="flex justify-between items-center pt-1 border-t border-slate-200">
                <span className="text-[10px] text-slate-400 font-bold">Need signature? Drag fields or use presets.</span>
                <button
                  onClick={addField}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] px-3 py-1.5 rounded-lg flex items-center gap-1 shadow"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Question to Builder
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={saveFormTemplate}
                className="w-full bg-slate-950 text-white font-black text-xs py-3 rounded-xl hover:opacity-90 transition flex items-center justify-center gap-1.5"
              >
                <ClipboardCheck className="w-4 h-4" /> Deploy & Save Reusable Template
              </button>
            </div>
          </div>

          {/* Live Mobile Client Preview Form */}
          <div className="xl:col-span-5 bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs flex flex-col justify-between h-[580px] overflow-y-auto">
            <div className="border-b pb-3.5 mb-4">
              <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
                Interactive Client Live View
              </span>
              <h4 className="font-extrabold text-slate-800 mt-2">{formTitle}</h4>
              <p className="text-[10px] text-slate-400 mt-0.5">Simulates how clients fill, sign, and submit this form before arrival.</p>
            </div>

            {formSuccess ? (
              <div className="text-center py-16 space-y-4">
                <div className="w-12 h-12 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto shadow-inner animate-bounce">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h5 className="font-black text-slate-900">Consent Form Submitted!</h5>
                <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                  Submission instantly secured. The compiled legal form and client signature has been appended directly to the **Client Files** registry.
                </p>
                <span className="text-[10px] font-mono text-indigo-600 font-bold bg-indigo-50 px-2 py-1 rounded">Ref ID: SEC-CS-93041-X</span>
              </div>
            ) : (
              <form onSubmit={handlePreviewSubmit} className="space-y-4 text-xs font-semibold text-slate-600">
                {formFields.map((field) => {
                  // Check conditional rendering
                  if (field.conditionalOn) {
                    const parentVal = previewValues[field.conditionalOn];
                    if (parentVal !== field.conditionalValue) return null;
                  }

                  return (
                    <div key={field.id} className="space-y-1.5 p-3 bg-slate-50/50 rounded-xl border border-slate-100">
                      <label className="text-slate-800 font-bold block">{field.label}</label>
                      
                      {field.type === 'text' && (
                        <input
                          type="text"
                          required={field.required}
                          value={previewValues[field.id] || ''}
                          onChange={(e) => setPreviewValues({ ...previewValues, [field.id]: e.target.value })}
                          placeholder="Type answer details..."
                          className="w-full p-2 bg-white border rounded-lg text-xs focus:ring-1 focus:ring-slate-950"
                        />
                      )}

                      {field.type === 'radio' && (
                        <div className="flex gap-4">
                          {field.options?.map(opt => (
                            <label key={opt} className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                              <input
                                type="radio"
                                required={field.required}
                                name={field.id}
                                value={opt}
                                checked={previewValues[field.id] === opt}
                                onChange={() => setPreviewValues({ ...previewValues, [field.id]: opt })}
                                className="focus:ring-slate-950 text-slate-950"
                              />
                              <span>{opt}</span>
                            </label>
                          ))}
                        </div>
                      )}

                      {field.type === 'checkbox' && (
                        <label className="flex items-start gap-2 cursor-pointer text-slate-700">
                          <input
                            type="checkbox"
                            required={field.required}
                            checked={previewValues[field.id] || false}
                            onChange={(e) => setPreviewValues({ ...previewValues, [field.id]: e.target.checked })}
                            className="rounded text-slate-950 focus:ring-slate-950 mt-0.5"
                          />
                          <span className="text-[11px] leading-tight text-slate-500">I agree and authorize this.</span>
                        </label>
                      )}

                      {field.type === 'signature' && (
                        <div className="space-y-2">
                          <div 
                            onClick={() => setIsSigned(true)}
                            className="h-20 bg-white border border-dashed rounded-lg flex items-center justify-center cursor-pointer hover:bg-slate-50 text-slate-400 relative"
                          >
                            {isSigned ? (
                              <span className="font-serif italic text-lg font-bold text-indigo-700 tracking-wider">
                                John Doe signed ✓
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400">Click to sign with stylus / digital pad</span>
                            )}
                          </div>
                          {isSigned && (
                            <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider text-right">Signed securely via Fresha SSL</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                <button
                  type="submit"
                  disabled={!isSigned}
                  className="w-full bg-slate-950 text-white text-xs font-bold py-2.5 rounded-xl hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Submit Pre-appointment Form
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* =======================================================================
          TAB 2: TEAM, SHIFTS, COMMISSION & TIMESHEETS
          ======================================================================= */}
      {activeTab === 'team' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Rota Shift & Override Box */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs space-y-4">
              <div>
                <h3 className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center gap-1">
                  <Clock className="w-4 h-4 text-amber-500" /> Professional Service Pricing
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">Customize service prices and durations uniquely per team member.</p>
              </div>

              <div className="space-y-3.5 text-xs font-semibold text-slate-600">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase">Employee</label>
                  <select
                    value={overrideStaffId}
                    onChange={(e) => setOverrideStaffId(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                  >
                    {staffList.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase">Service Offering</label>
                  <select
                    value={overrideServiceId}
                    onChange={(e) => setOverrideServiceId(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                  >
                    {services.map(srv => (
                      <option key={srv.id} value={srv.id}>{srv.name} (Base £{srv.price})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase">Personalised Custom Price (£)</label>
                  <input
                    type="number"
                    placeholder="e.g. 55"
                    value={overridePrice}
                    onChange={(e) => setOverridePrice(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none"
                  />
                </div>

                <button
                  onClick={applyPriceOverride}
                  className="w-full bg-slate-950 text-white font-bold py-2 rounded-xl text-[11px] hover:opacity-90"
                >
                  Apply Master Override
                </button>
              </div>
            </div>

            {/* Commissions Model Engine Config */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs space-y-4 md:col-span-2">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center gap-1">
                    <Percent className="w-4 h-4 text-indigo-500" /> Automated Commissions engine
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">Configure Flat rate or High-Retention Tiered structures to calculate wages dynamically.</p>
                </div>

                <div className="flex bg-slate-100 p-0.5 rounded-lg text-[10px] font-bold">
                  <button 
                    onClick={() => setCommissionType('flat')} 
                    className={`px-3 py-1 rounded transition ${commissionType === 'flat' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                  >
                    Flat Rate
                  </button>
                  <button 
                    onClick={() => setCommissionType('tiered')} 
                    className={`px-3 py-1 rounded transition ${commissionType === 'tiered' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                  >
                    Tiered Bonus
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-semibold text-slate-600">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <label className="text-[9px] font-bold text-slate-400 block uppercase mb-1">Standard Flat Rate</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={commissionRate}
                      onChange={(e) => setCommissionRate(parseInt(e.target.value || '0'))}
                      className="w-12 p-1.5 bg-white border rounded text-xs text-center font-bold"
                    />
                    <span className="font-bold">% commission</span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <label className="text-[9px] font-bold text-slate-400 block uppercase mb-1">Tier 2 Goal Target</label>
                  <div className="flex items-center gap-1">
                    <span className="font-bold">£</span>
                    <input
                      type="number"
                      value={tieredThreshold}
                      onChange={(e) => setTieredThreshold(parseInt(e.target.value || '0'))}
                      className="w-20 p-1.5 bg-white border rounded text-xs text-center font-bold"
                    />
                    <span className="font-bold">target</span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <label className="text-[9px] font-bold text-slate-400 block uppercase mb-1">Tier 2 Bonus Rate</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={tieredRate}
                      onChange={(e) => setTieredRate(parseInt(e.target.value || '0'))}
                      className="w-12 p-1.5 bg-white border rounded text-xs text-center font-bold"
                    />
                    <span className="font-bold">% override</span>
                  </div>
                </div>
              </div>

              <div className="bg-indigo-50 border border-indigo-100 p-3 rounded-xl text-[11px] font-bold text-indigo-900">
                💡 <span className="underline">Active Model Policy:</span> {commissionType === 'tiered' ? (
                  <span>Employee receives <strong>{commissionRate}%</strong> on sales up to £{tieredThreshold}, jumping automatically to <strong>{tieredRate}%</strong> on every penny of sales exceeding the goal. Great for motivation!</span>
                ) : (
                  <span>Employee receives a flat <strong>{commissionRate}%</strong> on all generated services & products checked out.</span>
                )}
              </div>
            </div>

          </div>

          {/* Timesheets, Attendance & Pay Run Summary Table */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs">
            <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider mb-4">Timesheet Ledger & Active Pay Period</h4>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 uppercase tracking-wider text-[10px] font-bold">
                    <th className="pb-3 pl-2">Professional Name</th>
                    <th className="pb-3">Shift Hours</th>
                    <th className="pb-3">Hourly Rate</th>
                    <th className="pb-3">Gross Retail/Serv. Sales</th>
                    <th className="pb-3">Calculated Commission</th>
                    <th className="pb-3">Basic Wage</th>
                    <th className="pb-3 text-right pr-2">Total Settlement Payout</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 font-semibold text-slate-700">
                  {timesheets.map((ts) => {
                    const comm = getCommissionValue(ts.salesAmount);
                    const wage = ts.hoursWorked * ts.hourlyRate;
                    const payout = wage + comm;
                    const exceeds = ts.salesAmount > tieredThreshold;

                    return (
                      <tr key={ts.staffId} className="hover:bg-slate-50/50">
                        <td className="py-3.5 pl-2 font-bold text-slate-900">{ts.staffName}</td>
                        <td className="py-3.5">{ts.hoursWorked} hrs</td>
                        <td className="py-3.5">£{ts.hourlyRate}/hr</td>
                        <td className="py-3.5">
                          <span>£{ts.salesAmount}</span>
                          {commissionType === 'tiered' && exceeds && (
                            <span className="ml-1 text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full font-bold">★ Target Met</span>
                          )}
                        </td>
                        <td className="py-3.5 text-emerald-600 font-bold">£{comm.toFixed(2)}</td>
                        <td className="py-3.5 text-slate-500">£{wage.toFixed(2)}</td>
                        <td className="py-3.5 text-right font-black text-slate-900 pr-2">£{payout.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-100 pt-4 mt-2 flex justify-between items-center">
              <p className="text-[10px] text-slate-400 font-bold">Wages and payroll automatically sync with Xero & QuickBooks integration.</p>
              <button 
                onClick={() => triggerNotif('Pay run generated. Pay slips and banking CSV exported to accounting file.')}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-1 shadow"
              >
                <DollarSign className="w-3.5 h-3.5" /> Execute Monthly Pay Run
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =======================================================================
          TAB 3: RETAIL, STOCK & CLICK-COLLECT
          ======================================================================= */}
      {activeTab === 'retail' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            
            {/* Catalog Controller */}
            <div className="xl:col-span-8 bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs flex flex-col space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Retail Inventory & Stock Levels</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">Control retail products. Out-of-stock items flag automatic supplier ordering alerts.</p>
                </div>
                
                {/* Simple form for rapid product insert */}
                <form onSubmit={addProduct} className="flex gap-2 text-xs font-bold shrink-0">
                  <input
                    type="text"
                    required
                    placeholder="Product Name"
                    value={newProdName}
                    onChange={(e) => setNewProdName(e.target.value)}
                    className="p-1.5 border border-slate-200 rounded-lg text-xs"
                  />
                  <input
                    type="number"
                    required
                    placeholder="Price (£)"
                    value={newProdPrice}
                    onChange={(e) => setNewProdPrice(e.target.value)}
                    className="p-1.5 border border-slate-200 rounded-lg text-xs w-16 text-center"
                  />
                  <button 
                    type="submit"
                    className="bg-slate-950 hover:opacity-90 text-white px-3 rounded-lg text-[10px]"
                  >
                    Quick Add
                  </button>
                </form>
              </div>

              {/* Product inventory table with low-stock alerts and PO builder hook */}
              <div className="overflow-y-auto max-h-[300px] border border-slate-100 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 uppercase tracking-wider text-[9px] font-bold">
                      <th className="p-3 pl-4">SKU / Code</th>
                      <th className="p-3">Product Description</th>
                      <th className="p-3 text-center">In Stock</th>
                      <th className="p-3">Price</th>
                      <th className="p-3 text-right pr-4">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 font-semibold text-slate-700">
                    {products.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50/50">
                        <td className="p-3 pl-4 font-mono text-slate-500 text-[10px]">{p.sku}</td>
                        <td className="p-3">
                          <p className="font-bold text-slate-800">{p.name}</p>
                          <span className="text-[9px] bg-slate-100 text-slate-400 px-1.5 py-0.2 rounded font-black uppercase">{p.category}</span>
                        </td>
                        <td className="p-3 text-center">
                          <span className={`font-mono font-bold px-2.5 py-0.5 rounded-full ${p.stock <= 5 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-800'}`}>
                            {p.stock} units
                          </span>
                          {p.stock <= 5 && <span className="text-[9px] font-black block text-rose-600 mt-1">⚠️ Low stock alert</span>}
                        </td>
                        <td className="p-3 font-extrabold text-slate-900">£{p.price.toFixed(2)}</td>
                        <td className="p-3 text-right pr-4">
                          <button
                            onClick={() => handlePOAdd(p.id)}
                            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[9px] px-2.5 py-1 rounded-lg"
                          >
                            + Draft restock
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Purchase Orders Drawer */}
            <div className="xl:col-span-4 bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs flex flex-col justify-between h-[390px]">
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">Purchase Order (PO) desk</h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Quickly dispatch replenishment requests directly to beauty distributors.</p>
                </div>

                <div className="space-y-2 text-xs font-semibold">
                  <div>
                    <label className="text-[9px] font-bold text-slate-400 block mb-1">Select Supplier</label>
                    <select
                      value={poSupplier}
                      onChange={(e) => setPoSupplier(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                    >
                      <option value="L'Oréal Professional">L'Oréal Professional Distributor</option>
                      <option value="GHD Salon Supply">GHD Salon Supply HQ</option>
                      <option value="Moroccanoil Inc">Moroccanoil Inc.</option>
                    </select>
                  </div>

                  <div className="border border-slate-100 rounded-xl p-3 bg-slate-50 max-h-36 overflow-y-auto space-y-1.5">
                    <span className="text-[9px] text-slate-400 block uppercase font-bold tracking-wider mb-1">Restock Items Bucket</span>
                    {poItems.map((item, i) => {
                      const prod = products.find(p => p.id === item.productId);
                      return (
                        <div key={i} className="flex justify-between items-center text-[11px]">
                          <span className="truncate pr-1 text-slate-700 font-bold">{prod?.name || 'Item'}</span>
                          <span className="font-mono bg-white border px-1.5 py-0.5 rounded text-indigo-600 font-bold">+{item.qty} units</span>
                        </div>
                      );
                    })}
                    {poItems.length === 0 && (
                      <p className="text-[10px] text-slate-400 italic font-medium py-3 text-center">No restock items drafted. Click "+ Draft restock" above.</p>
                    )}
                  </div>
                </div>
              </div>

              {poItems.length > 0 && (
                <button
                  onClick={submitPurchaseOrder}
                  className="w-full bg-slate-950 text-white font-bold text-xs py-2.5 rounded-xl hover:opacity-90 transition mt-4"
                >
                  Confirm & Dispatch PO
                </button>
              )}
            </div>

          </div>

          {/* Click & Collect Hub */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs">
            <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider mb-4 flex items-center gap-1">
              <ShoppingBag className="w-4 h-4 text-emerald-500" /> Click & Collect Fulfillment desk
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {collectOrders.map((ord) => (
                <div 
                  key={ord.id} 
                  className={`p-4 border rounded-2xl flex justify-between items-center text-xs ${ord.status.includes('Collected') ? 'bg-slate-50 border-slate-100 opacity-60' : 'bg-emerald-50/10 border-emerald-100'}`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] bg-indigo-50 text-indigo-700 font-extrabold px-1.5 py-0.5 rounded">{ord.id}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ord.status.includes('Collected') ? 'bg-slate-200 text-slate-700' : 'bg-emerald-100 text-emerald-800 animate-pulse'}`}>{ord.status}</span>
                    </div>
                    <p className="font-bold text-slate-800 text-sm mt-1">{ord.item}</p>
                    <p className="text-[11px] text-slate-500 font-medium">Customer: <span className="font-bold text-slate-700">{ord.client}</span></p>
                  </div>

                  <div className="text-right space-y-2">
                    <p className="font-black text-slate-900 text-sm">£{ord.price.toFixed(2)}</p>
                    {!ord.status.includes('Collected') && (
                      <button
                        onClick={() => completeClickCollect(ord.id)}
                        className="bg-slate-950 text-white text-[10px] font-black px-3 py-1.5 rounded-lg hover:opacity-90"
                      >
                        Handover & Check out
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* =======================================================================
          TAB 4: AUTOMATIONS, COMMUNICATIONS & QR MARKETING
          ======================================================================= */}
      {activeTab === 'automations' && (
        <div className="space-y-6">
          
          {/* Notifications config and template */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            <div className="lg:col-span-7 bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4 text-indigo-600" /> Smart Automated Reminders
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">Customise notifications dispatched by SMS or email on specific appointment milestones.</p>
              </div>

              <div className="space-y-4 text-xs font-semibold text-slate-600">
                <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <div>
                    <p className="text-slate-800 font-extrabold">Active Auto-Reminder Engine</p>
                    <p className="text-[10px] text-slate-400 font-medium">Reduce no-shows with automated follow-ups.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={enableSmartReminders}
                      onChange={(e) => setEnableSmartReminders(e.target.checked)}
                      className="sr-only peer" 
                    />
                    <div className="w-9 h-5 bg-gray-200 rounded-full peer peer-focus:ring-1 peer-focus:ring-slate-950 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-slate-950"></div>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">REMINDER LEAD TIME</label>
                    <select
                      value={reminderHours}
                      onChange={(e) => setReminderHours(parseInt(e.target.value))}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs font-bold"
                    >
                      <option value="2">2 Hours before appointment</option>
                      <option value="12">12 Hours before appointment</option>
                      <option value="24">24 Hours before appointment</option>
                      <option value="48">48 Hours before appointment</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">CHANNEL PREFERENCE</label>
                    <div className="bg-slate-50 border p-2.5 rounded-xl flex items-center gap-3">
                      <label className="flex items-center gap-1.5"><input type="checkbox" defaultChecked className="rounded" /> SMS</label>
                      <label className="flex items-center gap-1.5"><input type="checkbox" defaultChecked className="rounded" /> Email</label>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">AUTOMATED SMS MESSAGE BODY TEMPLATE</label>
                  <textarea
                    rows={3}
                    value={smsTemplate}
                    onChange={(e) => setSmsTemplate(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-950 text-xs font-mono text-slate-800"
                  />
                  <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider mt-1">SUPPORTED TAGS: {"{client_name}"} • {"{business_name}"} • {"{booking_time}"}</span>
                </div>

                <button
                  onClick={() => triggerNotif('Notification template deployed. Active auto-scheduler updated.')}
                  className="bg-slate-950 text-white font-bold px-4 py-2 rounded-xl text-xs"
                >
                  Save Reminder Rules
                </button>
              </div>
            </div>

            {/* Multi-Channel marketing & QR Code */}
            <div className="lg:col-span-5 bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                    <Share2 className="w-4 h-4 text-indigo-600" /> Multi-Channel Bookings Page
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">Let clients self-book 24/7. Distribute your customized scheduling link across any platform.</p>
                </div>

                <div className="space-y-3 text-xs font-semibold">
                  <div>
                    <label className="text-[9px] font-bold text-slate-400 block mb-1">ONLINE BOOKING LINK</label>
                    <div className="flex gap-1.5 bg-slate-50 p-1.5 rounded-xl border">
                      <input
                        type="text"
                        readOnly
                        value={bookingPageLink}
                        className="bg-transparent font-mono text-[10px] text-indigo-700 flex-1 focus:outline-none"
                      />
                      <button 
                        onClick={copyLink}
                        className="text-slate-500 hover:text-slate-900 p-1"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-2 bg-slate-50 p-3 rounded-2xl border items-center">
                    <div className="p-2 bg-white rounded-xl border shrink-0">
                      <QrCode className="w-10 h-10 text-slate-800" />
                    </div>
                    <div>
                      <h5 className="font-bold text-slate-800">Scan-to-Book QR Code</h5>
                      <p className="text-[10px] text-slate-400 mt-0.5">Download QR code flyers to display inside your salon windows or checkout desks.</p>
                      <button 
                        onClick={() => triggerNotif('QR Code flyer PDF exported.')}
                        className="text-[9px] text-indigo-700 font-bold underline mt-1 block"
                      >
                        Export Print PDF
                      </button>
                    </div>
                  </div>

                  {/* Social plugins integration */}
                  <div className="space-y-2">
                    <span className="text-[9px] font-bold text-slate-400 block uppercase">Social Feed Plugins</span>
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <button 
                        onClick={() => triggerNotif('Instagram button snippet exported.')}
                        className="p-2 border rounded-xl hover:bg-slate-50 flex items-center gap-1.5 justify-center"
                      >
                        📸 Instagram Plugin
                      </button>
                      <button 
                        onClick={() => triggerNotif('Facebook button snippet exported.')}
                        className="p-2 border rounded-xl hover:bg-slate-50 flex items-center gap-1.5 justify-center"
                      >
                        👥 Facebook Plugin
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t text-[10px] text-slate-400 font-bold flex justify-between items-center">
                <span>Domain status: Secured SSL</span>
                <span className="text-emerald-600">● 24/7 Booking Live</span>
              </div>
            </div>

          </div>

          {/* Fresha Marketplace Simulation */}
          <div className="bg-slate-950 text-white rounded-3xl p-6 relative overflow-hidden">
            <div className="absolute right-0 top-0 translate-x-12 -translate-y-12 w-48 h-48 rounded-full bg-white opacity-5 blur-lg"></div>
            
            <div className="relative z-10 max-w-xl space-y-4">
              <span className="text-[9px] font-black bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-full uppercase tracking-widest border border-indigo-500/30">
                Fresha Global Marketplace Engine
              </span>
              <h4 className="text-xl font-black tracking-tight">Boost booking discovery up to 40% on Fresha Marketplace</h4>
              <p className="text-xs text-slate-300">
                Allow nearby prospective clients searching for beauty/wellness treatments to discover, view reviews, tip professionals, and instantly book your salon catalog in just a single tap.
              </p>

              <div className="flex flex-wrap gap-4 text-xs font-bold pt-2">
                <div className="flex items-center gap-1.5">
                  <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                  <span>4.9 Star Average Rating</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ExternalLink className="w-4 h-4 text-indigo-400" />
                  <span>950+ Verified Reviews synced</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Marketplace Instant Tipping active</span>
                </div>
              </div>

              <button 
                onClick={() => triggerNotif('Your catalog and booking slots are now synced live to the Fresha Marketplace directory.')}
                className="bg-white text-slate-950 font-black text-xs px-5 py-2.5 rounded-xl hover:opacity-90 transition flex items-center gap-1 shadow-md"
              >
                Sync with Fresha Marketplace Directory <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

        </div>
      )}

      {/* =======================================================================
          TAB 5: WAITLIST, GROUP BOOKINGS, & CLIENT WALLET
          ======================================================================= */}
      {activeTab === 'waitlist' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          
          {/* Top Info Banner */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs">
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <Timer className="w-4 h-4 text-indigo-600" /> Waitlist & Group Booking Control Panel
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Fulfill competitor scheduling requirements by managing intelligent priority waitlists, multi-guest group bookings, and digital client wallets.
            </p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            
            {/* Left Hand: Add to Waitlist & Notification rules (col-span-5) */}
            <div className="xl:col-span-5 space-y-6">
              
              {/* Waitlist Add Form */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs space-y-4">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Queue Client on Waitlist</h4>
                <form onSubmit={addToWaitlist} className="space-y-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">CLIENT NAME</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Abigail Sanders"
                      value={wlClient}
                      onChange={(e) => setWlClient(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-950 text-xs font-bold"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 block mb-1">PHONE NUMBER</label>
                      <input
                        type="text"
                        placeholder="+44 7700..."
                        value={wlPhone}
                        onChange={(e) => setWlPhone(e.target.value)}
                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-950 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 block mb-1">PRIORITY CLASS</label>
                      <select
                        value={wlPriority}
                        onChange={(e: any) => setWlPriority(e.target.value)}
                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-950 text-xs font-bold"
                      >
                        <option value="regular">Regular Queue</option>
                        <option value="first_in_line">First-in-Line Priority</option>
                        <option value="high_value">High-Value First</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">TREATMENT REQUESTED</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Signature Balayage & Cut"
                      value={wlService}
                      onChange={(e) => setWlService(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-950 text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">PREFERRED SPECIALIST</label>
                    <select
                      value={wlStaff}
                      onChange={(e) => setWlStaff(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-950 text-xs font-bold"
                    >
                      <option value="Any Specialist">Any Specialist</option>
                      {staffList.map(s => (
                        <option key={s.id} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="w-full bg-slate-950 hover:bg-slate-900 text-white font-extrabold text-xs py-2.5 rounded-xl transition flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Append to Intelligent Waitlist
                  </button>
                </form>
              </div>

              {/* Dispatch notification strategy */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs space-y-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Send className="w-3.5 h-3.5 text-indigo-500" /> Automated Notify Rules
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Determine how waiting clients are notified when slots open up.</p>
                </div>

                <div className="space-y-2 text-xs font-semibold text-slate-700">
                  <label className="flex items-center gap-2 p-2.5 rounded-xl border hover:bg-slate-50 cursor-pointer">
                    <input
                      type="radio"
                      name="strategy"
                      checked={wlNotificationStrategy === 'first_in_line'}
                      onChange={() => {
                        setWlNotificationStrategy('first_in_line');
                        triggerNotif('Waitlist Strategy changed: First in Line Notification updated.');
                      }}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <p className="font-extrabold text-slate-800 text-[11px]">First in Line (Sequential)</p>
                      <p className="text-[9px] text-slate-400 font-normal">Notify the client who has been waiting longest. Give them 15 mins to claim.</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded-xl border hover:bg-slate-50 cursor-pointer">
                    <input
                      type="radio"
                      name="strategy"
                      checked={wlNotificationStrategy === 'high_value_first'}
                      onChange={() => {
                        setWlNotificationStrategy('high_value_first');
                        triggerNotif('Waitlist Strategy changed: High Value Booking Priority enabled.');
                      }}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <p className="font-extrabold text-slate-800 text-[11px]">High-Value treatment first (Revenue booster)</p>
                      <p className="text-[9px] text-slate-400 font-normal">Priority alerts go out first to clients waiting for premium Balayage or Facials.</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded-xl border hover:bg-slate-50 cursor-pointer">
                    <input
                      type="radio"
                      name="strategy"
                      checked={wlNotificationStrategy === 'offer_all'}
                      onChange={() => {
                        setWlNotificationStrategy('offer_all');
                        triggerNotif('Waitlist Strategy changed: Blast Offer to All active.');
                      }}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <p className="font-extrabold text-slate-800 text-[11px]">Offer to All (Fastest booking secure)</p>
                      <p className="text-[9px] text-slate-400 font-normal">Blast SMS/Email to all qualifying waitlisted clients. First-come, first-served.</p>
                    </div>
                  </label>
                </div>
              </div>

            </div>

            {/* Right Hand: Active Waitlist & Groups & Wallet (col-span-7) */}
            <div className="xl:col-span-7 space-y-6">
              
              {/* Waitlist Ledger Table */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Active Waitlist Queue</h4>
                    <p className="text-[10px] text-slate-400 mt-0.5">Automated matcher matches cancellations instantly.</p>
                  </div>
                  <span className="text-[10px] bg-indigo-50 text-indigo-600 font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                    {waitlist.length} Waiting
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 font-bold text-[10px] uppercase">
                        <th className="pb-2">Client / Date Added</th>
                        <th className="pb-2">Requested Service</th>
                        <th className="pb-2 text-center">Priority</th>
                        <th className="pb-2 text-right">Instant Dispatch</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {waitlist.map((wl) => (
                        <tr key={wl.id} className="hover:bg-slate-50/50 transition">
                          <td className="py-2.5">
                            <p className="font-extrabold text-slate-800">{wl.clientName}</p>
                            <p className="text-[9px] text-slate-400 font-mono mt-0.5">{wl.dateAdded} • {wl.phone}</p>
                          </td>
                          <td className="py-2.5 text-slate-600 font-semibold">
                            {wl.serviceName}
                            <span className="block text-[9px] text-slate-400">Prefers: {wl.preferredStaff}</span>
                          </td>
                          <td className="py-2.5 text-center">
                            <span className={`inline-block text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${
                              wl.priority === 'high_value' ? 'bg-rose-50 text-rose-600' :
                              wl.priority === 'first_in_line' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-600'
                            }`}>
                              {wl.priority.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-2.5 text-right">
                            <button
                              onClick={() => matchWaitlistOpening(wl.id)}
                              className="bg-indigo-50 hover:bg-indigo-600 hover:text-white text-indigo-700 font-extrabold text-[10px] px-2.5 py-1.5 rounded-lg transition"
                            >
                              Dispatch Match
                            </button>
                          </td>
                        </tr>
                      ))}
                      {waitlist.length === 0 && (
                        <tr>
                          <td colSpan={4} className="text-center py-6 text-slate-400">All waitlist queue spots resolved or dispatched.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Group Booking Planner */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs space-y-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-emerald-500" /> Group Appointment Orchestration (Multi-Guest)
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Allow multiple clients to book and attend appointments together. It automatically aligns timings, assigns the right staff, and checkouts the entire group under a single fast billing.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left sub-side: Organizer & Guest Roster */}
                  <div className="space-y-3 text-xs">
                    <div>
                      <label className="text-[9px] font-bold text-slate-400 block mb-1">GROUP ORGANIZER / MAIN CLIENT</label>
                      <input
                        type="text"
                        value={grpMainClient}
                        onChange={(e) => setGrpMainClient(e.target.value)}
                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-950 font-bold"
                      />
                    </div>

                    <div>
                      <label className="text-[9px] font-bold text-slate-400 block mb-1">GUESTS ATTACHED ({grpGuests.length})</label>
                      <div className="space-y-1.5">
                        {grpGuests.map((guest, idx) => (
                          <div key={idx} className="flex justify-between items-center bg-slate-50 p-2 rounded-xl border border-slate-100">
                            <span className="font-extrabold text-slate-700">{guest}</span>
                            <button onClick={() => removeGroupGuest(idx)} className="text-rose-500 hover:text-rose-700 p-0.5">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-1.5 mt-2">
                        <input
                          type="text"
                          placeholder="e.g. Liam Vance"
                          value={grpNewGuest}
                          onChange={(e) => setGrpNewGuest(e.target.value)}
                          className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-950 font-semibold"
                        />
                        <button
                          onClick={addGroupGuest}
                          className="bg-slate-200 hover:bg-slate-300 text-slate-800 px-3 py-2 rounded-xl transition font-extrabold"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Right sub-side: Align & Unified Checkout Preview */}
                  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex flex-col justify-between space-y-4">
                    <div className="space-y-3 text-xs font-semibold">
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 block mb-1">ASSIGNED SERVICE & CO-TIMINGS</label>
                        <select
                          value={grpServiceId}
                          onChange={(e) => setGrpServiceId(e.target.value)}
                          className="w-full p-2 bg-white border border-slate-200 rounded-xl font-bold"
                        >
                          {services.map(s => (
                            <option key={s.id} value={s.id}>{s.name} (£{s.price})</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 block mb-1">AUTO-ASSIGN PROFESSIONAL</label>
                        <select
                          value={grpStaffId}
                          onChange={(e) => setGrpStaffId(e.target.value)}
                          className="w-full p-2 bg-white border border-slate-200 rounded-xl font-bold"
                        >
                          {staffList.map(s => (
                            <option key={s.id} value={s.id}>{s.name} (Available)</option>
                          ))}
                        </select>
                      </div>

                      <div className="pt-2 border-t text-[10px] space-y-1 font-mono text-slate-500">
                        <div className="flex justify-between">
                          <span>Main Organiser:</span>
                          <span className="font-bold text-slate-800">14:00 (Slot Locked)</span>
                        </div>
                        {grpGuests.map((g, idx) => (
                          <div key={idx} className="flex justify-between">
                            <span>Guest #{idx + 1} ({g}):</span>
                            <span className="font-bold text-slate-800">14:{30 * (idx + 1)} (Staggered-Safe)</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pt-2 border-t">
                      {grpSuccess ? (
                        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-2.5 rounded-xl text-[11px] text-center font-bold">
                          ✓ Aligned group bookings booked in scheduling diary.
                        </div>
                      ) : (
                        <button
                          onClick={submitGroupBooking}
                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs py-2 rounded-xl transition flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/10"
                        >
                          <Users className="w-3.5 h-3.5" /> Book Group & Sync Single Checkout
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Digital Client Wallet */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs space-y-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Wallet className="w-4 h-4 text-indigo-500" /> Digital Client Wallet Portfolio
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Query the client wallet ledger to view deposit balances, active pre-paid gift card codes, subscription memberships, and saved cards.
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-[9px] font-bold text-slate-400 block mb-1">SEARCH CLIENT DATABASE FOR WALLET FILE</label>
                    <input
                      type="text"
                      placeholder="Type name (e.g. Eleanor Vance, Charlotte, Oliver...)"
                      value={walletSearch}
                      onChange={(e) => handleWalletSearch(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-950 text-xs font-bold"
                    />
                  </div>

                  {selectedWalletClient && (
                    <div className="bg-slate-950 text-white p-4 rounded-2xl border border-slate-800 font-sans grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-200">
                      <div>
                        <span className="text-[8px] font-bold bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-md uppercase tracking-wider">
                          Active Client Wallet
                        </span>
                        <h5 className="font-extrabold text-white text-sm mt-1">{selectedWalletClient.name}</h5>
                        <div className="mt-3 space-y-1.5 text-xs text-slate-300">
                          <p className="flex justify-between">
                            <span>Pre-paid Deposit Credit:</span>
                            <span className="font-bold text-white">£{selectedWalletClient.balance.toFixed(2)}</span>
                          </p>
                          <p className="flex justify-between">
                            <span>VIP Membership Rank:</span>
                            <span className="font-bold text-indigo-400">{selectedWalletClient.membership}</span>
                          </p>
                        </div>
                      </div>

                      <div className="border-t md:border-t-0 md:border-l border-slate-800 pt-3 md:pt-0 md:pl-4 space-y-2.5 text-xs text-slate-300">
                        <div>
                          <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">CONNECTED GIFT CARD / VOUCHERS</span>
                          <p className="font-mono text-white text-[11px] font-bold flex justify-between mt-0.5">
                            <span>{selectedWalletClient.giftCardCode}</span>
                            <span className="text-emerald-400">£{selectedWalletClient.giftCardBalance.toFixed(2)}</span>
                          </p>
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">SECURE WALLET DEBIT/CREDIT CARDS</span>
                          <p className="text-white text-[11px] font-semibold flex items-center gap-1 mt-0.5">
                            💳 {selectedWalletClient.savedCard}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>

          </div>

        </div>
      )}

      {/* =======================================================================
          TAB 6: RESOURCE ALLOCATION & STAFF-FREE SCHEDULING
          ======================================================================= */}
      {activeTab === 'resources' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          
          <div className="bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs">
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600" /> Resource, Room & Equipment Allocation Manager
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Configure treatment spaces, spa chambers, and advanced equipment assets. Schedule staff-free self-service bookings like sauna blocks or cold plunges safely without double-booking.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left: Register resource (col-span-4) */}
            <div className="lg:col-span-4 bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs space-y-4">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Register Resource Asset</h4>
              <form onSubmit={addResource} className="space-y-3 text-xs">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">ASSET / RESOURCE NAME</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Cryotherapy Sauna Tub"
                    value={newResName}
                    onChange={(e) => setNewResName(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-950 font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">ASSET CATEGORY</label>
                  <select
                    value={newResCategory}
                    onChange={(e: any) => setNewResCategory(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800"
                  >
                    <option value="room">Suite / Treatment Room</option>
                    <option value="equipment">Specialized Machinery / Laser</option>
                    <option value="space">Station / Self-Service Zone</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">MAX CAPACITY / CONCURRENT USE</label>
                  <input
                    type="number"
                    min={1}
                    value={newResCapacity}
                    onChange={(e) => setNewResCapacity(parseInt(e.target.value) || 1)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-950 font-mono"
                  />
                </div>
                
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-[10px] text-slate-400 font-medium">
                  💡 High Density rules enforce that services linked to resources automatically lock resource capacity when booked.
                </div>

                <button
                  type="submit"
                  className="w-full bg-slate-950 hover:bg-slate-900 text-white font-extrabold py-2.5 rounded-xl transition flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> Provision Resource Asset
                </button>
              </form>
            </div>

            {/* Right: Allocation monitor & staff-free bookings simulator (col-span-8) */}
            <div className="lg:col-span-8 bg-white rounded-2xl p-5 border border-slate-200/60 shadow-xs space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Active Resource ledger & utilization</h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">Toggle maintenance states or dispatch staff-free bookings instantly.</p>
                </div>
                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-mono font-bold">
                  4 active assets
                </span>
              </div>

              <div className="space-y-4">
                {resources.map((res) => (
                  <div key={res.id} className="p-4 bg-slate-50/50 rounded-2xl border border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h5 className="font-extrabold text-slate-900 text-sm truncate">{res.name}</h5>
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          res.category === 'room' ? 'bg-indigo-50 text-indigo-700' :
                          res.category === 'equipment' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                        }`}>
                          {res.category}
                        </span>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-400 font-bold uppercase">
                        <span>Max Clients: {res.capacity}</span>
                        <span className="flex items-center gap-1">
                          Status: 
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                            res.status === 'Available' ? 'bg-emerald-500' :
                            res.status === 'In Use' ? 'bg-indigo-500' : 'bg-amber-500'
                          }`}></span> 
                          <span className={
                            res.status === 'Available' ? 'text-emerald-600' :
                            res.status === 'In Use' ? 'text-indigo-600' : 'text-amber-600'
                          }>{res.status}</span>
                        </span>
                      </div>

                      {/* Utilization progress bar */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[8px] font-mono font-bold text-slate-400">
                          <span>RESOURCE UTILIZATION</span>
                          <span>{res.currentUtilization}%</span>
                        </div>
                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${
                            res.status === 'In Use' ? 'bg-indigo-600' :
                            res.status === 'Maintenance' ? 'bg-slate-400' : 'bg-emerald-500'
                          }`} style={{ width: `${res.currentUtilization}%` }}></div>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => toggleResourceStatus(res.id)}
                        className="p-2 border bg-white text-slate-700 font-bold text-[10px] rounded-xl hover:bg-slate-50 transition"
                      >
                        🔧 Service State
                      </button>
                      <button
                        onClick={() => simulateStaffFreeBooking(res.id)}
                        disabled={res.status === 'Maintenance'}
                        className="px-3 py-2 bg-slate-950 hover:bg-slate-900 disabled:bg-slate-300 text-white font-black text-[10px] rounded-xl transition flex items-center gap-1 shadow-sm"
                      >
                        ⚡ Staff-Free Booking
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>
      )}

    </div>
  );
}
