import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServicesPage } from './ServicesPage';

const { getServices, createService, updateServiceRecord, reorderServiceRecords, deleteServiceRecord, activeTenant } = vi.hoisted(() => ({
  getServices: vi.fn(),
  createService: vi.fn(),
  updateServiceRecord: vi.fn(),
  reorderServiceRecords: vi.fn(),
  deleteServiceRecord: vi.fn(),
  activeTenant: { id: 'tenant-1', name: 'Test business' },
}));

vi.mock('../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ activeTenant }),
}));
vi.mock('../../data/data-provider', () => ({
  getDataProvider: () => ({ getServices, createService }),
}));
vi.mock('./services-api', () => ({ updateServiceRecord, reorderServiceRecords, deleteServiceRecord }));

const signatureService = {
  id: 'service-1',
  name: 'Signature treatment',
  description: 'A complete demo treatment.',
  durationMin: 45,
  price: 65,
  category: 'General',
};

const hairService = (id: string, name: string) => ({
  id,
  name,
  description: `${name} description.`,
  durationMin: 45,
  price: 50,
  category: 'Hair',
});

const nailsService = {
  id: 'nails-1',
  name: 'Gel manicure',
  description: 'Gel manicure description.',
  durationMin: 60,
  price: 45,
  category: 'Nails',
};

describe('ServicesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getServices.mockReset();
    createService.mockReset();
    updateServiceRecord.mockReset();
    reorderServiceRecords.mockReset();
    deleteServiceRecord.mockReset();
    reorderServiceRecords.mockResolvedValue(undefined);
    deleteServiceRecord.mockResolvedValue(undefined);
    getServices.mockResolvedValue([signatureService]);
  });

  it('shows services inside their visible category', async () => {
    render(<MemoryRouter initialEntries={['/app/services']}><ServicesPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Signature treatment' })).toBeInTheDocument();
    expect(screen.getByText('A complete demo treatment.')).toBeInTheDocument();
    expect(screen.getByText('45 minutes')).toBeInTheDocument();
  });

  it('opens and submits the add-service form from the primary link query', async () => {
    createService.mockResolvedValue({
      id: 'service-2',
      name: 'Consultation',
      description: 'A detailed consultation.',
      durationMin: 30,
      price: 25,
      category: 'Consultations',
    });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/app/services?add=1']}><ServicesPage /></MemoryRouter>);

    await user.type(screen.getByLabelText('Service name'), 'Consultation');
    await user.clear(screen.getByLabelText('Category'));
    await user.type(screen.getByLabelText('Category'), 'Consultations');
    await user.type(screen.getByLabelText('Description'), 'A detailed consultation.');
    await user.type(screen.getByLabelText('Price (£)'), '25');
    await user.click(screen.getByRole('button', { name: 'Create service' }));

    expect(createService).toHaveBeenCalledWith('tenant-1', {
      name: 'Consultation',
      description: 'A detailed consultation.',
      price: 25,
      durationMin: 30,
      category: 'Consultations',
    });
    expect(await screen.findByRole('heading', { name: 'Consultations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Consultation' })).toBeInTheDocument();
  });

  it('loads an existing service into the form, saves the changes, and shows its new category', async () => {
    updateServiceRecord.mockResolvedValue({
      id: 'service-1',
      name: 'Updated signature treatment',
      description: 'A complete demo treatment.',
      durationMin: 60,
      price: 75,
      category: 'Premium',
    });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/app/services']}><ServicesPage /></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: 'Edit Signature treatment' }));
    expect(screen.getByRole('heading', { name: 'Edit service' })).toBeInTheDocument();
    expect(screen.getByLabelText('Service name')).toHaveValue('Signature treatment');

    await user.clear(screen.getByLabelText('Service name'));
    await user.type(screen.getByLabelText('Service name'), 'Updated signature treatment');
    await user.clear(screen.getByLabelText('Category'));
    await user.type(screen.getByLabelText('Category'), 'Premium');
    await user.clear(screen.getByLabelText('Price (£)'));
    await user.type(screen.getByLabelText('Price (£)'), '75');
    await user.clear(screen.getByLabelText('Duration (minutes)'));
    await user.type(screen.getByLabelText('Duration (minutes)'), '60');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateServiceRecord).toHaveBeenCalledWith('service-1', {
      name: 'Updated signature treatment',
      description: 'A complete demo treatment.',
      price: 75,
      durationMin: 60,
      category: 'Premium',
    }));
    expect(await screen.findByRole('heading', { name: 'Premium' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Updated signature treatment' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit service' })).not.toBeInTheDocument());
  });

  it('moves an entire category and persists every service in the new order', async () => {
    getServices.mockResolvedValue([
      hairService('hair-1', 'Haircut'),
      hairService('hair-2', 'Blow dry'),
      nailsService,
    ]);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/app/services']}><ServicesPage /></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: 'Move Nails category up' }));

    await waitFor(() => expect(reorderServiceRecords).toHaveBeenCalledWith(['nails-1', 'hair-1', 'hair-2']));
    const serviceList = screen.getByRole('heading', { name: 'Service categories' }).closest('section');
    expect(serviceList).not.toBeNull();
    const categoryHeadings = within(serviceList!).getAllByRole('heading', { level: 3 });
    expect(categoryHeadings.map(heading => heading.textContent)).toEqual(['Nails', 'Hair']);
  });

  it('moves a service only within its own category', async () => {
    getServices.mockResolvedValue([
      hairService('hair-1', 'Haircut'),
      hairService('hair-2', 'Blow dry'),
      nailsService,
    ]);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/app/services']}><ServicesPage /></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: 'Move Blow dry up within Hair' }));

    await waitFor(() => expect(reorderServiceRecords).toHaveBeenCalledWith(['hair-2', 'hair-1', 'nails-1']));
    const hairSection = screen.getByRole('heading', { name: 'Hair' }).closest('section');
    expect(hairSection).not.toBeNull();
    const serviceHeadings = within(hairSection!).getAllByRole('heading', { level: 4 });
    expect(serviceHeadings.map(heading => heading.textContent)).toEqual(['Blow dry', 'Haircut']);
  });

  it('confirms and removes a service from future choices', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/app/services']}><ServicesPage /></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: 'Delete Signature treatment' }));

    expect(window.confirm).toHaveBeenCalledWith('Delete “Signature treatment”? It will be removed from future booking choices, while existing booking history is kept.');
    await waitFor(() => expect(deleteServiceRecord).toHaveBeenCalledWith('service-1'));
    expect(await screen.findByRole('heading', { name: 'No services yet' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Signature treatment' })).not.toBeInTheDocument();
  });
});
