import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportPage, ReportsHome } from './OperationalReports.js';

const getAppointmentsReport=vi.fn();
vi.mock('../../data/data-provider.js',()=>({getDataProvider:()=>({getAppointmentsReport})}));

const response:any={
  period:{period:'LAST_30_DAYS',from:'2026-06-20T23:00:00.000Z',to:'2026-07-20T23:00:00.000Z',timezone:'Europe/London',localFrom:'2026-06-21',localTo:'2026-07-20'},currency:'GBP',
  filters:{search:null,status:null,staffId:null,serviceId:null,clientId:null,bookingChannel:null,paymentStatus:null,sort:'date_desc'},
  summary:{total:1,completed:1,cancelled:0,noShow:0,awaitingPayment:0,quotedAmountTotal:12345},
  rows:[{appointmentId:'11111111-1111-1111-1111-111111111111',publicReference:'22222222-2222-2222-2222-222222222222',startTime:'2026-07-19T10:00:00.000Z',endTime:'2026-07-19T11:00:00.000Z',clientId:'33333333-3333-3333-3333-333333333333',clientDisplayName:'Safe Client',serviceId:'44444444-4444-4444-4444-444444444444',serviceName:'Cut',staffId:'55555555-5555-5555-5555-555555555555',staffName:'Stylist',status:'COMPLETED',bookingChannel:'in_shop',quotedAmount:12345,paymentState:'FullyPaid',createdAt:'2026-07-01T10:00:00.000Z'}],
  pagination:{limit:25,nextCursor:null,hasMore:false},generatedAt:'2026-07-19T12:00:00.000Z',
};

const renderReport=()=>render(<MemoryRouter initialEntries={['/app/reports/appointments']}><Routes><Route path="/app/reports/:reportKey" element={<ReportPage/>}/><Route path="/app/reports" element={<ReportsHome/>}/></Routes></MemoryRouter>);

describe('Operational reports',()=>{
  beforeEach(()=>getAppointmentsReport.mockReset());
  it('shows navigation for every operational report',()=>{render(<MemoryRouter><ReportsHome/></MemoryRouter>);expect(screen.getAllByRole('link')).toHaveLength(10);expect(screen.getByRole('link',{name:/Appointments report/})).toHaveAttribute('href','/app/reports/appointments');expect(screen.getByRole('link',{name:/Communications report/})).toBeInTheDocument();});
  it('shows loading then live responsive table data and currency',async()=>{let resolve:any;getAppointmentsReport.mockReturnValue(new Promise(r=>resolve=r));renderReport();expect(screen.getByText('Loading report')).toBeInTheDocument();resolve(response);expect(await screen.findAllByText('£123.45')).toHaveLength(2);expect(screen.getByRole('table',{name:'Appointments report detailed records'})).toBeInTheDocument();expect(screen.getByText('Safe Client')).toBeInTheDocument();});
  it('sends period and status filters to the live provider',async()=>{getAppointmentsReport.mockResolvedValue(response);renderReport();await screen.findByText('Safe Client');await userEvent.selectOptions(screen.getByLabelText('Report period'),'TODAY');await userEvent.selectOptions(screen.getByLabelText('Status'),'COMPLETED');await waitFor(()=>expect(getAppointmentsReport).toHaveBeenLastCalledWith(expect.objectContaining({period:'TODAY',status:'COMPLETED',sort:'date_desc',limit:25})));});
  it('uses opaque cursors for next and previous pages',async()=>{getAppointmentsReport.mockResolvedValueOnce({...response,pagination:{limit:25,nextCursor:'cursor_2',hasMore:true}}).mockResolvedValue(response);renderReport();await screen.findByText('Safe Client');await userEvent.click(screen.getByRole('button',{name:/Next/}));await waitFor(()=>expect(getAppointmentsReport).toHaveBeenLastCalledWith(expect.objectContaining({cursor:'cursor_2'})));await userEvent.click(screen.getByRole('button',{name:/Previous/}));await waitFor(()=>expect(getAppointmentsReport).toHaveBeenLastCalledWith(expect.not.objectContaining({cursor:expect.anything()})));});
  it('shows honest empty and retry states without mock rows',async()=>{getAppointmentsReport.mockRejectedValueOnce(new Error('Live report failed')).mockResolvedValueOnce({...response,summary:{...response.summary,total:0,quotedAmountTotal:0},rows:[]});renderReport();expect(await screen.findByText('Live report failed')).toBeInTheDocument();await userEvent.click(screen.getByRole('button',{name:/Retry/}));expect(await screen.findByText('No matching records')).toBeInTheDocument();expect(screen.queryByText('Safe Client')).not.toBeInTheDocument();});
});
