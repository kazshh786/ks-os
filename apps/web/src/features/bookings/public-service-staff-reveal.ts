const originalStaffFieldsetClass = 'booking-original-staff-fieldset';
const revealClass = 'booking-service-staff-reveal';
const expandedServiceClass = 'is-team-expanded';

let observer: MutationObserver | null = null;
let scheduled = false;

function legendText(fieldset: HTMLFieldSetElement) {
  return fieldset.querySelector('legend')?.textContent?.trim() || '';
}

function fieldsetByLegend(root: ParentNode, label: string) {
  return Array.from(root.querySelectorAll<HTMLFieldSetElement>('fieldset'))
    .find(fieldset => legendText(fieldset) === label);
}

function serviceNameFromButton(button: HTMLButtonElement) {
  return button.querySelector<HTMLElement>('.booking-service-choice__top p')?.textContent?.trim()
    || button.getAttribute('aria-label')?.split(',')[0]?.trim()
    || 'this service';
}

function isAnyoneAvailableButton(button: HTMLButtonElement) {
  return button.getAttribute('aria-label')?.toLowerCase().startsWith('anyone available') || false;
}

function cloneStaffChoice(original: HTMLButtonElement) {
  const clone = original.cloneNode(true) as HTMLButtonElement;
  clone.classList.add('booking-service-staff-reveal__choice');
  clone.removeAttribute('id');
  clone.addEventListener('click', event => {
    event.preventDefault();
    original.click();
  });
  return clone;
}

function revealSignature(serviceButton: HTMLButtonElement, staffButtons: HTMLButtonElement[]) {
  return [
    serviceButton.getAttribute('aria-label') || serviceButton.textContent || '',
    ...staffButtons.map(button => `${button.getAttribute('aria-label') || button.textContent}:${button.getAttribute('aria-pressed')}`),
  ].join('|');
}

function clearExpandedServiceState(root: ParentNode, except?: HTMLButtonElement) {
  root.querySelectorAll<HTMLButtonElement>(`.booking-service-choice.${expandedServiceClass}`)
    .forEach(button => {
      if (button !== except) button.classList.remove(expandedServiceClass);
    });
}

export function syncPublicServiceStaffReveal(root: ParentNode = document) {
  const serviceFieldset = fieldsetByLegend(root, 'Choose a service');
  const staffFieldset = fieldsetByLegend(root, 'Choose who you book with');
  const previousReveal = root.querySelector<HTMLElement>(`.${revealClass}`);

  if (!serviceFieldset || !staffFieldset) {
    previousReveal?.remove();
    staffFieldset?.classList.remove(originalStaffFieldsetClass);
    clearExpandedServiceState(root);
    return;
  }

  const selectedService = serviceFieldset.querySelector<HTMLButtonElement>('.booking-service-choice[aria-pressed="true"]');
  if (!selectedService) {
    previousReveal?.remove();
    staffFieldset.classList.remove(originalStaffFieldsetClass);
    clearExpandedServiceState(root);
    return;
  }

  clearExpandedServiceState(root, selectedService);

  const staffButtons = Array.from(staffFieldset.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'));
  const memberButtons = staffButtons.filter(button => !isAnyoneAvailableButton(button));
  const serviceName = serviceNameFromButton(selectedService);

  if (memberButtons.length === 1 && memberButtons[0].getAttribute('aria-pressed') !== 'true') {
    const autoSelectionKey = `${serviceName}:${memberButtons[0].getAttribute('aria-label') || memberButtons[0].textContent}`;
    if (selectedService.dataset.autoSelectedStaff !== autoSelectionKey) {
      selectedService.dataset.autoSelectedStaff = autoSelectionKey;
      memberButtons[0].click();
    }
  }

  const visibleButtons = memberButtons.length === 1 ? memberButtons : staffButtons;
  const signature = revealSignature(selectedService, visibleButtons);
  const correctPosition = previousReveal?.previousElementSibling === selectedService;

  selectedService.classList.add(expandedServiceClass);
  staffFieldset.classList.add(originalStaffFieldsetClass);

  if (previousReveal?.dataset.signature === signature && correctPosition) return;
  previousReveal?.remove();

  const reveal = document.createElement('section');
  reveal.className = revealClass;
  reveal.dataset.signature = signature;
  reveal.setAttribute('aria-label', `Choose a team member for ${serviceName}`);

  const heading = document.createElement('div');
  heading.className = 'booking-service-staff-reveal__heading';

  const headingCopy = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'booking-service-staff-reveal__eyebrow';
  eyebrow.textContent = 'Available team';
  const title = document.createElement('h3');
  title.textContent = memberButtons.length === 1 ? 'Your team member' : 'Choose who you book with';
  const description = document.createElement('p');
  description.className = 'booking-service-staff-reveal__description';
  description.textContent = memberButtons.length === 1
    ? `Only one team member offers ${serviceName}, so they have been selected automatically.`
    : `These team members can deliver ${serviceName}. Choose a person or keep the earliest available option.`;
  headingCopy.append(eyebrow, title, description);

  const changeService = document.createElement('button');
  changeService.type = 'button';
  changeService.className = 'booking-service-staff-reveal__change-service';
  changeService.textContent = 'Change service';
  changeService.addEventListener('click', () => {
    serviceFieldset.scrollIntoView({ behavior: 'smooth', block: 'start' });
    selectedService.focus({ preventScroll: true });
  });

  heading.append(headingCopy, changeService);

  const choices = document.createElement('div');
  choices.className = 'booking-service-staff-reveal__choices';
  visibleButtons.forEach(button => choices.append(cloneStaffChoice(button)));

  reveal.append(heading, choices);
  selectedService.insertAdjacentElement('afterend', reveal);
}

function onNextFrame(callback: () => void) {
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(callback);
    return;
  }
  window.setTimeout(callback, 0);
}

function scheduleSync() {
  if (scheduled) return;
  scheduled = true;
  onNextFrame(() => {
    scheduled = false;
    const root = document.getElementById('booking-flow');
    if (root) syncPublicServiceStaffReveal(root);
  });
}

export function ensurePublicServiceStaffReveal() {
  if (typeof document === 'undefined' || observer || typeof window.MutationObserver === 'undefined') return;

  const connect = () => {
    const root = document.getElementById('booking-flow');
    if (!root) {
      onNextFrame(connect);
      return;
    }

    observer = new window.MutationObserver(scheduleSync);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-pressed', 'class', 'style'],
    });
    scheduleSync();
  };

  connect();
}
