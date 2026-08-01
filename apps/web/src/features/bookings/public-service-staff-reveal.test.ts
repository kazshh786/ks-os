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
  it('selects the only eligible team member and reveals them beneath the service', () => {
    const { root, originals } = renderFixture([
      { label: 'Anyone available. Show the earliest times across the eligible team.', selected: true },
      { label: 'Amina, Senior stylist' },
    ]);

    syncPublicServiceStaffReveal(root);
    syncPublicServiceStaffReveal(root);

    const service = root.querySelector<HTMLButtonElement>('.booking-service-choice');
    const originalFieldset = root.querySelector<HTMLFieldSetElement>('fieldset[data-testid="original-staff"]');
    const reveal = root.querySelector<HTMLElement>('.booking-service-staff-reveal');
    const choices = reveal?.querySelectorAll<HTMLButtonElement>('.booking-service-staff-reveal__choice');

    expect(originals[1]).toHaveAttribute('aria-pressed', 'true');
    expect(originals[0]).toHaveAttribute('aria-pressed', 'false');
    expect(service).toHaveClass('is-team-expanded');
    expect(originalFieldset).toHaveClass('booking-original-staff-fieldset');
    expect(reveal?.previousElementSibling).toBe(service);
    expect(reveal).toHaveTextContent('selected automatically');
    expect(choices).toHaveLength(1);
    expect(choices?.[0]).toHaveAttribute('aria-label', 'Amina, Senior stylist');
    expect(choices?.[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows all eligible choices and forwards selection to the booking flow', () => {
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
    expect(root.querySelector('.booking-service-staff-reveal')).toHaveTextContent('Choose who you book with');
    expect(root.querySelector<HTMLButtonElement>('.booking-service-staff-reveal__choice[aria-label="Yusuf, Barber"]'))
      .toHaveAttribute('aria-pressed', 'true');
  });
});
