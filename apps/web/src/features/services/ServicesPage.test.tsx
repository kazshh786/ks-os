import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServicesPage } from './ServicesPage';

const getServices = vi.fn();
const createService = vi.fn();
const updateServiceRecord = vi.fn();
const activeTenant = { id: 'tenant-1', name: 'Test business' };

vi.mock('../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ activeTenant }),
}));
vi.mock('../../data/data-provider', () => ({
  getDataProvider: () => ({ getServices, createService }),
}));
vi.mock('./services-api', () => ({
  updateServiceRecord: (...args: unknown[]) => updateServiceRecord(...args),
}));

describe('ServicesPage', () => {
  beforeEach(() => {
    getServices.mockReset();
    createService.mockReset();
    updateServiceRecord.mockReset();
    getServices.mockResolvedValue([{
      id: 'service-1',
      name: 'Signature treatment',
      description: 'A complete demo treatment.',
      durationMin: 45,
      price: 65,
      category: 'General',
    }]);
  });

  it('shows the full service list and descriptions', async () => {
    render(<MemoryRouter initialEntries={['/app/services']}><ServicesPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Signature treatment' })).toBeInTheDocument();
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
    expect(await screen.findByRole('heading', { name: 'Consultation' })).toBeInTheDocument();
  });

  it('loads an existing service into the form and saves the changes', async () => {
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

    expect(updateServiceRecord).toHaveBeenCalledWith('service-1', {
      name: 'Updated signature treatment',
      description: 'A complete demo treatment.',
      price: 75,
      durationMin: 60,
      category: 'Premium',
    });
    expect(await screen.findByRole('heading', { name: 'Updated signature treatment' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Edit service' })).not.toBeInTheDocument();
  });
});
