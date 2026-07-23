import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServicesPage } from './ServicesPage';

const getServices = vi.fn();
const createService = vi.fn();
const activeTenant = { id: 'tenant-1', name: 'Test business' };

vi.mock('../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ activeTenant }),
}));
vi.mock('../../data/data-provider', () => ({
  getDataProvider: () => ({ getServices, createService }),
}));

describe('ServicesPage', () => {
  beforeEach(() => {
    getServices.mockReset();
    createService.mockReset();
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
});
