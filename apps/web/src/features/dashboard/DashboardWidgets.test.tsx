import {describe,it,expect} from 'vitest';
import {render,screen} from '@testing-library/react';
import {resolveBusinessProfile} from '@ks-os/contracts';
import {DashboardWidgets} from './DashboardWidgets';
const k=(value:number)=>({value,previousValue:0,changeValue:value,changePercentage:null});
const data:any={
  bookings:{total:k(3),completed:k(2),cancelled:k(0),noShow:k(0),cancellationRate:k(0),noShowRate:k(0)},
  clients:{uniqueClients:k(4),newClients:k(2),returningClients:k(2)},
  currency:'GBP',revenue:{recordedRevenue:k(4500),refundedAmount:k(0),netRecordedRevenue:k(4500),outstandingAmount:k(0),averageTransactionValue:k(1500)},
  operations:{todayAppointments:3,awaitingPayment:0,incompleteForms:0,failedEmails:0,failedSms:0,openDisputes:0,failedPayouts:0,stripeActionRequired:0},
  dailyTrend:[],topServices:[],staffUtilisation:[],generatedAt:'2026-09-05T00:00:00Z',
};
describe('profile dashboard composition',()=>{
  it('keeps salon booking and service widgets',()=>{
    render(<DashboardWidgets data={data} profile={resolveBusinessProfile('SALON')}/>);
    expect(screen.getByRole('heading',{name:'Top services'})).toBeInTheDocument();
    expect(screen.getByText('Bookings',{selector:'p'})).toBeInTheDocument();
  });
  it('shows real shared data with agency terminology and no invented delivery metrics',()=>{
    render(<DashboardWidgets data={data} profile={resolveBusinessProfile('AGENCY')}/>);
    expect(screen.getByText('New clients')).toBeInTheDocument();
    expect(screen.getByText('£45.00')).toBeInTheDocument();
    expect(screen.queryByRole('heading',{name:'Top services'})).not.toBeInTheDocument();
    expect(screen.queryByText('Bookings')).not.toBeInTheDocument();
    expect(screen.queryByText(/deliveries|vehicles|routes/i)).not.toBeInTheDocument();
  });
});
