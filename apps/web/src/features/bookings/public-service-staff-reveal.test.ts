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
          ${staff.map(person => {
            const [name, ...roleParts] = person.label.split(',');
            const role = roleParts.join(',').trim() || 'Team member';
            return `
              <button type="button" aria-pressed="${person.selected ? 'true' : 'false'}" aria-label="${person.label}">
                <div>
                  <div>${name.trim().slice(0, 2)}</div>
                  <div><p>${name.trim()}</p><p>${role}</p></div>
                </div>
              </button>
            `;
          }).join('')}
        </div>
      </fieldset>
      <aside class="booking-summary-column">
        <div class="space-y-4">
          <p>Choose a service to begin.</p>
          <div class="border-t">Total</div>
        </div>
      </aside>
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

const profiles = [
  {
    id: 'staff-amina',
    name: 'Amina',
    role: 'Senior stylist',
    bio: 'Amina specialises in precision cuts and relaxed, personal appointments.',
    imageUrl: null,
  },
  {
    id: 'staff-yusuf',
    name: 'Yusuf',
    role: 'Barber',
    bio: 'Yusuf brings a careful eye to modern cuts, fades and beard shaping.',
    imageUrl: null,
  },
];

describe('public service staff reveal', () => {
  it('auto-selects the sole team member and keeps the drawer copy compact', () => {
    const { root, originals } = renderFixture([
      { label: 'Anyone available. Show the earliest times across the eligible team.', selected: true },
      { label: 'Amina, Senior stylist' },
    ]);

    syncPublicServiceStaffReveal(root, profiles);
    syncPublicServiceStaffReveal(root, profiles);

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
    expect(originalFieldset).toHaveClass('booking-original-staff-fieldset');
    expect(serviceList).toHaveClass('has-team-drawer');
    expect(reveal?.parentElement).toBe(serviceList);
    expect(selectedService?.nextElementSibling).toBe(otherService);
    expect(reveal?.querySelector('h3')).toHaveTextContent('Choose one of our team members');
    expect(reveal).not.toHaveTextContent('selected automatically');
    expect(reveal).not.toHaveTextContent('Available team');
    expect(choices).toHaveLength(1);
    expect(choices?.[0].querySelector('.booking-service-staff-reveal__choice-name')).toHaveTextContent('Amina');
    expect(choices?.[0].querySelector('.booking-service-staff-reveal__choice-role')).toHaveTextContent('Senior stylist');
    expect(root.querySelector('.booking-summary-team-profile')).toHaveTextContent('Amina');
    expect(root.querySelector('.booking-summary-team-profile')).toHaveTextContent('precision cuts');
  });

  it('keeps ten compact team choices inside one anchored scroll region', () => {
    const team = Array.from({ length: 10 }, (_, index) => ({
      label: `Team member ${index + 1}, Stylist`,
      selected: index === 0,
    }));
    const { root } = renderFixture(team);

    syncPublicServiceStaffReveal(root, []);

    const serviceList = root.querySelector<HTMLElement>('.booking-service-list');
    const services = serviceList?.querySelectorAll<HTMLButtonElement>(':scope > .booking-service-choice');
    const reveal = root.querySelector<HTMLElement>('.booking-service-staff-reveal');
    const choices = reveal?.querySelector<HTMLElement>('.booking-service-staff-reveal__choices');

    expect(reveal).toHaveAttribute('data-choice-count', '10');
    expect(choices).toHaveAttribute('role', 'group');
    expect(choices?.querySelectorAll('.booking-service-staff-reveal__choice')).toHaveLength(10);
    expect(choices?.querySelectorAll('.booking-service-staff-reveal__choice-name')).toHaveLength(10);
    expect(choices?.querySelectorAll('.booking-service-staff-reveal__choice-role')).toHaveLength(10);
    expect(reveal?.parentElement).toBe(serviceList);
    expect(services?.[0].nextElementSibling).toBe(services?.[1]);
    expect(serviceList?.lastElementChild).toBe(reveal);
  });

  it('forwards staff selection, updates the summary bio and closes with the icon action', () => {
    const { root, originals } = renderFixture([
      { label: 'Anyone available. Show the earliest times across the eligible team.', selected: true },
      { label: 'Amina, Senior stylist' },
      { label: 'Yusuf, Barber' },
    ]);

    syncPublicServiceStaffReveal(root, profiles);

    const reveal = root.querySelector<HTMLElement>('.booking-service-staff-reveal');
    const choices = Array.from(reveal?.querySelectorAll<HTMLButtonElement>('.booking-service-staff-reveal__choice') || []);
    const yusuf = choices.find(button => button.getAttribute('aria-label') === 'Yusuf, Barber');

    expect(choices).toHaveLength(3);
    yusuf?.click();
    syncPublicServiceStaffReveal(root, profiles);

    expect(originals[2]).toHaveAttribute('aria-pressed', 'true');
    expect(root.querySelector<HTMLButtonElement>('.booking-service-staff-reveal__choice[aria-label="Yusuf, Barber"]'))
      .toHaveAttribute('aria-pressed', 'true');
    expect(root.querySelector('.booking-summary-team-profile')).toHaveTextContent('Yusuf');
    expect(root.querySelector('.booking-summary-team-profile')).toHaveTextContent('beard shaping');

    root.querySelector<HTMLButtonElement>('.booking-service-staff-reveal__close')?.click();

    expect(root.querySelector('.booking-service-staff-reveal')).not.toBeInTheDocument();
    expect(root.querySelector('.booking-service-list')).not.toHaveClass('has-team-drawer');
    expect(root.querySelector('.booking-service-choice')).toHaveAttribute('aria-expanded', 'false');
  });
});
