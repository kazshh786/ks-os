import {beforeEach,describe,it,expect,vi} from 'vitest';
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter,Route,Routes} from 'react-router';
import {resolveBusinessProfile} from '@ks-os/contracts';
import ProductOnboardingPage from './ProductOnboardingPage';
const fetchWithAuth=vi.fn();
const auth={role:'owner',tenantName:'Courier A',businessReference:'business-a',reload:vi.fn()};
vi.mock('../../api/client',()=>({fetchWithAuth:(...args:any[])=>fetchWithAuth(...args)}));
vi.mock('../../auth/useAuth',()=>({useAuth:()=>auth}));
vi.mock('../../auth/useBusinessProfile',()=>({useBusinessProfile:()=>resolveBusinessProfile('LOGISTICS_COURIER')}));
const body={data:{businessName:'Courier A',businessType:'LOGISTICS_COURIER',configuration:null,profile:resolveBusinessProfile('LOGISTICS_COURIER')}};
function show(){return render(<MemoryRouter initialEntries={['/app/onboarding']}><Routes><Route path="/app/onboarding" element={<ProductOnboardingPage/>}/><Route path="/app/dashboard" element={<p>Business dashboard</p>}/></Routes></MemoryRouter>);}
describe('product onboarding',()=>{
  beforeEach(()=>{fetchWithAuth.mockReset();auth.role='owner';auth.reload.mockResolvedValue(undefined);});
  it('loads tenant defaults and saves plain-language answers without a browser tenant identifier',async()=>{
    fetchWithAuth.mockResolvedValueOnce({ok:true,json:async()=>body}).mockResolvedValueOnce({ok:true,json:async()=>({data:{}})});
    show();
    expect(await screen.findByRole('heading',{name:'Make KSOS fit your business'})).toBeInTheDocument();
    expect(screen.getByRole('checkbox',{name:'Deliveries'})).toBeChecked();
    await userEvent.click(screen.getByRole('button',{name:'Save and open my workspace'}));
    await screen.findByText('Business dashboard');
    const payload=JSON.parse(fetchWithAuth.mock.calls[1][1].body);
    expect(payload.businessName).toBe('Courier A');
    expect(payload.businessType).toBe('LOGISTICS_COURIER');
    expect(payload).not.toHaveProperty('tenantId');
    expect(payload).not.toHaveProperty('businessReference');
    expect(auth.reload).toHaveBeenCalled();
  });
  it('keeps entered values and shows an error after a failed save',async()=>{
    fetchWithAuth.mockResolvedValueOnce({ok:true,json:async()=>body}).mockResolvedValueOnce({ok:false,json:async()=>({error:{message:'Please try again'}})});
    show();await screen.findByRole('heading',{name:'Make KSOS fit your business'});
    await userEvent.click(screen.getByRole('button',{name:'Save and open my workspace'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please try again');
    expect(screen.getByRole('textbox',{name:'Business name'})).toHaveValue('Courier A');
  });
  it('never asks invited staff which business they run',async()=>{
    auth.role='staff';fetchWithAuth.mockResolvedValue({ok:true,json:async()=>body});show();
    expect(screen.queryByRole('heading',{name:'Make KSOS fit your business'})).not.toBeInTheDocument();
    expect(screen.getByText(/managed by its owner/)).toBeInTheDocument();
    await waitFor(()=>expect(fetchWithAuth).toHaveBeenCalledTimes(1));
  });
});
