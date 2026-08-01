import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncPublicServiceStaffReveal } from './public-service-staff-reveal';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function renderFixture(staff: Array<{ label: string; selected?: boolean }>) {
  document.body.innerHTML = `
    <div id="booking-flow">
      <fieldset>
        <legend>Choose a service</legend>
        <div class="booking-service-list">
          <button
            type="button"
            class="booking-service-choice"
            aria-pressed="true"
            aria-label="Signature haircut, 45 minutes, £35"
          >
            <div class="booking-service-choice__top"><p>Signature haircut</p></div>
          </button>
          <button
            type="button"
            class="booking-service-choice"
            aria-pressed="false"
            aria-label="Beard trim, 20 minutes, £15"
          >
            <div class="booking-service-choice__top"><p>Beard trim</p></div>
          </button>
        </div>
      </fieldset>
      <fieldset data-testid="original-staff">
        <legend>Choose who you book with</legend>
        <div>
          ${staff.map(person => `
            <button type="button" aria-pressed="${person.selected ? 'true' : 'false'}" aria-label="${person.label}">
              <div><p>${person.label.split(',')[0]}</p></div>
            </button>
          `).join('')}
        </div>
      </fieldset>
    </div>
  `;

  const root = document.getElementById('booking-flow') as HTMLElement;
  const originals = Array.from(root.querySelectorAll<HTMLButtonElement>('fieldset[data-testid="original-staff"] button'));
  originals.forEach(button => {
    button.addEventListener('click', () => {
      originals.forEach(option => option.setAttribute('aria-pressed', String(option === button)));
    });
  });

  return { root, originals };
}

describe('public service staff reveal', () => {
  it('selects the only eligible team member and layers the drawer over the service list', () => {
    const { root, originals } = renderFixture([
      { label: 'Anyone available. Show the earliest times across the eligible team.', selected: true },
      { label: 'Amina, Senior stylist' },
    ]);

    syncPublicServiceStaffReveal(root);
    syncPublicServiceStaffReveal(root);

    const serviceList = root.querySelector<HTMLElement>('.booking-service-list');
    const services = serviceList?.querySelectorAll<HTMLButtonElement>(':scope > .booking-service-choice');
    const selectedService = services?.[0];
    const otherService = services?.[1];
    const originalFieldset = root.querySelector<HTMLFieldSetElement>('fieldset[data-testid="original-staff"]');
    const reveal = root.querySelector<HTMLElement>('.booking-service-staff-reveal');
    const choices = reveal?.querySelectorAll<HTMLButtonElement>('.booking-service-staff-reveal__choice');

    expect(originals[1]).toHaveAttribute('aria-pressed', 'true');
    expect(originals[0]).toHaveAttribute('aria-pressed', 'false');
    expect(selectedService).toHaveClass('is-team-expanded');
    expect(selectedService).toHaveAttribute('aria-expanded', 'true');
    expect(selectedService).toHaveAttribute('aria-controls', 'booking-service-team-drawer');
    expect(originalFieldset).toHaveClass('booking-original-staff-fieldset');
    expect(serviceList).toHaveClass('has-team-drawer');
    expect(reveal?.parentElement).toBe(serviceList);
    expect(selectedService?.nextElementSibling).toBe(otherService);
    expect(reveal).toHaveTextContent('selected automatically');
    expect(choices).toHaveLength(1);
    expect(choices?.[0]).toHaveAttribute('aria-label', 'Amina, Senior stylist');
    expect(choices?.[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps a large team inside one anchored scroll region without inserting rows between services', () => {
    const team = Array.from({ length: 10 }, (_, index) => ({
      label: `Team member ${index + 1}, Stylist`,
      selected: index === 0,
    }));
    const { root } = renderFixture(team);

    syncPublicServiceStaffReveal(root);

    const serviceList = root.querySelector<HTMLElement>('.booking-service-list');
    const services = serviceList?.querySelectorAll<HTMLButtonElement>(':scope > .booking-service-choice');
    const reveal = root.querySelector<HTMLElement>('.booking-service-staff-reveal');
    const choices = reveal?.querySelector<HTMLElement>('.booking-service-staff-reveal__choices');

    expect(reveal).toHaveAttribute('data-choice-count', '10');
    expect(choices).toHaveAttribute('role', 'group');
    expect(choices?.querySelectorAll('.booking-service-staff-reveal__choice')).toHaveLength(10);
    expect(reveal?.parentElement).toBe(serviceList);
    expect(services?.[0].nextElementSibling).toBe(services?.[1]);
    expect(serviceList?.lastElementChild).toBe(reveal);
  });

  it('forwards a team selection and lets the customer close the drawer to choose another service', () => {
    const { root, originals } = renderFixture([
      { label: 'Anyone available. Show the earliest times across the eligible team.', selected: true },
      { label: 'Amina, Senior stylist' },
      { label: 'Yusuf, Barber' },
    ]);

    syncPublicServiceStaffReveal(root);

    const reveal = root.querySelector<HTMLElement>('.booking-service-staff-reveal');
    const choices = Array.from(reveal?.querySelectorAll<HTMLButtonElement>('.booking-service-staff-reveal__choice') || []);
    const yusuf = choices.find(button => button.getAttribute('aria-label') === 'Yusuf, Barber');

    expect(choices).toHaveLength(3);
    yusuf?.click();
    syncPublicServiceStaffReveal(root);

    expect(originals[2]).toHaveAttribute('aria-pressed', 'true');
    expect(root.querySelector<HTMLButtonElement>('.booking-service-staff-reveal__choice[aria-label="Yusuf, Barber"]'))
      .toHaveAttribute('aria-pressed', 'true');

    root.querySelector<HTMLButtonElement>('.booking-service-staff-reveal__change-service')?.click();

    expect(root.querySelector('.booking-service-staff-reveal')).not.toBeInTheDocument();
    expect(root.querySelector('.booking-service-list')).not.toHaveClass('has-team-drawer');
    expect(root.querySelector('.booking-service-choice')).toHaveAttribute('aria-expanded', 'false');
  });
});
