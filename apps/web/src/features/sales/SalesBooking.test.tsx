// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { CreateBookingDialog } from '../bookings/CreateBookingDialog.js';
import { SalesAppointments } from './SalesAppointments.js';
import { BookingCard } from '../bookings/BookingCard.js';
import type { SalesAppointment } from '@ks-os/contracts';

const mocks=vi.hoisted(()=>({fetchWithAuth:vi.fn(),getClientProfile:vi.fn(),createStaffBooking:vi.fn(),listForms:vi.fn()}));
vi.mock('../../api/client.js',()=>({fetchWithAuth:mocks.fetchWithAuth,getClientProfile:mocks.getClientProfile}));
vi.mock('../../data/data-provider.js',()=>({getDataProvider:()=>({createStaffBooking:mocks.createStaffBooking,listForms:mocks.listForms})}));
const sale='11111111-1111-4111-8111-111111111111',client='22222222-2222-4222-8222-222222222222',staffId='33333333-3333-4333-8333-333333333333';
const related={reference:sale,title:'Boiler replacement',stage:'Site visit',state:'OPEN',value:450000,currency:'GBP'};
const context={customer:{reference:client,name:'Taylor Morgan',email:'taylor@example.test',phone:'07000000000'},sales:[related],selectedReference:sale,suggestedStaffId:staffId,hasMore:false};
const props={open:true,timezone:'UTC',services:[{id:'44444444-4444-4444-8444-444444444444',name:'Site survey',durationMin:60,price:0,description:'',category:'Visits'}],staff:[{id:staffId,name:'Ahmed',role:'Engineer',avatarUrl:'',rating:5,servicesHandled:[],schedules:[]}],initialDate:'2027-01-01',onClose:vi.fn(),onCreated:vi.fn()};
beforeEach(()=>{vi.clearAllMocks();mocks.listForms.mockResolvedValue([]);mocks.createStaffBooking.mockResolvedValue({success:true});mocks.fetchWithAuth.mockResolvedValue(new Response(JSON.stringify({data:context}),{status:200}));mocks.getClientProfile.mockResolvedValue({data:{profile:context.customer}});});
afterEach(cleanup);

it('prefills the Sales customer and owner, persists public references and uses the canonical booking provider',async()=>{
  render(<CreateBookingDialog {...props} initialSalesReference={sale}/>);
  await waitFor(()=>expect(screen.getByLabelText('Customer name')).toHaveValue('Taylor Morgan'));
  expect(screen.getByLabelText('Team member')).toHaveValue(staffId);
  expect(screen.getByRole('combobox',{name:/Related sale/})).toHaveValue(sale);
  fireEvent.submit(screen.getByLabelText('Customer name').closest('form')!);
  await waitFor(()=>expect(mocks.createStaffBooking).toHaveBeenCalledTimes(1));
  const request=mocks.createStaffBooking.mock.calls[0][0];
  expect(request).toMatchObject({clientReference:client,salesOpportunityReference:sale,staffId});
  expect(request).not.toHaveProperty('tenantId');expect(request).not.toHaveProperty('salesOpportunityId');
});

it('allows a keyboard user to choose a general appointment without Sales provenance',async()=>{
  const user=userEvent.setup();render(<CreateBookingDialog {...props} initialSalesReference={sale}/>);
  const select=await screen.findByRole('combobox',{name:/Related sale/});
  await user.selectOptions(select,'');expect(select).toHaveValue('');
  fireEvent.submit(screen.getByLabelText('Customer name').closest('form')!);
  await waitFor(()=>expect(mocks.createStaffBooking).toHaveBeenCalled());
  expect(mocks.createStaffBooking.mock.calls[0][0]).not.toHaveProperty('salesOpportunityReference');
});

it('keeps appointment-first customer and general booking flows free of Sales controls',async()=>{
  mocks.fetchWithAuth.mockResolvedValue(new Response(JSON.stringify({data:{...context,sales:[],selectedReference:null,suggestedStaffId:null}}),{status:200}));
  const view=render(<CreateBookingDialog {...props} initialClientId={client}/>);
  await waitFor(()=>expect(screen.getByLabelText('Customer name')).toHaveValue('Taylor Morgan'));
  expect(screen.queryByRole('combobox',{name:/Related sale/})).toBeNull();
  view.unmount();render(<CreateBookingDialog {...props}/>);expect(screen.queryByRole('combobox',{name:/Related sale/})).toBeNull();
});

it('fails closed when a prelinked sale becomes inaccessible',async()=>{
  mocks.fetchWithAuth.mockResolvedValue(new Response('{}',{status:404}));
  render(<CreateBookingDialog {...props} initialSalesReference={sale}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  expect(screen.getByRole('button',{name:'Create booking'})).toBeDisabled();
  expect(mocks.createStaffBooking).not.toHaveBeenCalled();
});

it('shows bounded multiple appointments and an explicit permission-aware quote suggestion',async()=>{
  const now=new Date();const appointment:SalesAppointment={reference:client,title:'Site survey',status:'COMPLETED',startTime:new Date(now.getTime()-3600000).toISOString(),endTime:now.toISOString(),timezone:'UTC',staffName:'Ahmed',route:'/app/bookings?reference='+client,canReschedule:false};
  const create=vi.fn();const view=render(<MemoryRouter><SalesAppointments appointments={[appointment]} hasMore={false} bookingAction={{route:'/app/bookings?create=1&salesOpportunityReference='+sale}} bookingLabel="Book site visit" open hasQuote={false} canCreateQuote onCreateQuote={create}/></MemoryRouter>);
  expect(screen.getByRole('link',{name:'Book site visit'})).toHaveAttribute('href',expect.stringContaining(sale));
  fireEvent.click(screen.getByRole('button',{name:'Create quote'}));expect(create).toHaveBeenCalledTimes(1);
  view.unmount();render(<MemoryRouter><SalesAppointments appointments={[appointment]} hasMore={false} bookingAction={null} bookingLabel="Book site visit" open hasQuote={false} canCreateQuote={false} onCreateQuote={create}/></MemoryRouter>);
  expect(screen.queryByRole('button',{name:'Create quote'})).toBeNull();
});

it('keeps dense calendar cards lightweight and only renders server-provided Sales context',()=>{
  const booking:any={id:client,reference:client,startTime:'2027-01-01T10:00:00Z',endTime:'2027-01-01T11:00:00Z',timezone:'UTC',customer:{name:'Taylor'},service:{name:'Survey'},staff:{name:'Ahmed'},status:'CONFIRMED',location:{name:null},paymentStatus:'NOT_REQUIRED',intakeStatus:'NOT_REQUIRED',attentionReasons:[],relatedSale:related};
  const view=render(<BookingCard booking={booking} density="compact" onOpen={vi.fn()}/>);
  expect(screen.queryByText(/Boiler replacement/)).toBeNull();
  view.rerender(<BookingCard booking={booking} density="detailed" onOpen={vi.fn()}/>);expect(screen.getByText(/Boiler replacement/)).toBeInTheDocument();
  view.rerender(<BookingCard booking={{...booking,relatedSale:undefined}} density="detailed" onOpen={vi.fn()}/>);expect(screen.queryByText(/Boiler replacement/)).toBeNull();
});
