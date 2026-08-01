const originalStaffFieldsetClass = 'booking-original-staff-fieldset';
const revealClass = 'booking-service-staff-reveal';
const expandedServiceClass = 'is-team-expanded';
const serviceListOpenClass = 'has-team-drawer';
const dismissedAttribute = 'data-team-drawer-dismissed';
const toggleBoundAttribute = 'data-team-drawer-toggle-bound';
const drawerId = 'booking-service-team-drawer';

let observer: MutationObserver | null = null;
let observedRoot: HTMLElement | null = null;
let scheduled = false;
let connecting = false;
let resizeBound = false;

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
      if (button !== except) {
        button.classList.remove(expandedServiceClass);
        button.setAttribute('aria-expanded', 'false');
        button.removeAttribute('aria-controls');
      }
    });

  root.querySelectorAll<HTMLElement>(`.booking-service-list.${serviceListOpenClass}`)
    .forEach(list => {
      if (!except || list !== except.closest('.booking-service-list')) list.classList.remove(serviceListOpenClass);
    });
}

function setStyleProperty(element: HTMLElement, property: string, value: string) {
  if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value);
}

function positionReveal(serviceList: HTMLElement, selectedService: HTMLButtonElement, reveal: HTMLElement) {
  const listRect = serviceList.getBoundingClientRect();
  const serviceRect = selectedService.getBoundingClientRect();
  const relativeTop = Math.max(0, serviceRect.top - listRect.top + serviceList.scrollTop);
  const availableViewportHeight = Math.max(260, window.innerHeight - serviceRect.top - 24);
  const maximumHeight = Math.min(430, availableViewportHeight);
  const serviceHeight = Math.max(92, selectedService.offsetHeight || serviceRect.height || 0);

  setStyleProperty(reveal, '--booking-team-drawer-top', `${Math.round(relativeTop)}px`);
  setStyleProperty(reveal, '--booking-team-drawer-max-height', `${Math.round(maximumHeight)}px`);
  setStyleProperty(reveal, '--booking-team-card-height', `${Math.round(serviceHeight)}px`);
}

function dismissReveal(root: ParentNode, selectedService: HTMLButtonElement) {
  selectedService.setAttribute(dismissedAttribute, 'true');
  selectedService.classList.remove(expandedServiceClass);
  selectedService.setAttribute('aria-expanded', 'false');
  selectedService.removeAttribute('aria-controls');
  selectedService.closest('.booking-service-list')?.classList.remove(serviceListOpenClass);
  root.querySelector<HTMLElement>(`.${revealClass}`)?.remove();
}

function bindServiceToggle(root: ParentNode, selectedService: HTMLButtonElement) {
  if (selectedService.hasAttribute(toggleBoundAttribute)) return;
  selectedService.setAttribute(toggleBoundAttribute, 'true');
  selectedService.addEventListener('click', () => {
    if (selectedService.classList.contains(expandedServiceClass)) {
      dismissReveal(root, selectedService);
      return;
    }

    if (selectedService.getAttribute(dismissedAttribute) === 'true') {
      selectedService.removeAttribute(dismissedAttribute);
      scheduleSync();
    }
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

  const serviceList = selectedService.closest<HTMLElement>('.booking-service-list');
  if (!serviceList) return;

  bindServiceToggle(root, selectedService);
  clearExpandedServiceState(root, selectedService);
  staffFieldset.classList.add(originalStaffFieldsetClass);

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

  if (selectedService.getAttribute(dismissedAttribute) === 'true') {
    previousReveal?.remove();
    selectedService.classList.remove(expandedServiceClass);
    selectedService.setAttribute('aria-expanded', 'false');
    selectedService.removeAttribute('aria-controls');
    serviceList.classList.remove(serviceListOpenClass);
    return;
  }

  const visibleButtons = memberButtons.length === 1 ? memberButtons : staffButtons;
  const signature = revealSignature(selectedService, visibleButtons);
  const correctParent = previousReveal?.parentElement === serviceList;

  selectedService.classList.add(expandedServiceClass);
  selectedService.setAttribute('aria-expanded', 'true');
  selectedService.setAttribute('aria-controls', drawerId);
  serviceList.classList.add(serviceListOpenClass);

  if (previousReveal?.dataset.signature === signature && correctParent) {
    positionReveal(serviceList, selectedService, previousReveal);
    return;
  }

  previousReveal?.remove();

  const reveal = document.createElement('section');
  reveal.id = drawerId;
  reveal.className = revealClass;
  reveal.dataset.signature = signature;
  reveal.dataset.choiceCount = String(visibleButtons.length);
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
    : `Choose from the people who can deliver ${serviceName}. The list scrolls when more team members are available.`;
  headingCopy.append(eyebrow, title, description);

  const changeService = document.createElement('button');
  changeService.type = 'button';
  changeService.className = 'booking-service-staff-reveal__change-service';
  changeService.textContent = 'Choose another service';
  changeService.addEventListener('click', () => {
    dismissReveal(root, selectedService);
    selectedService.focus({ preventScroll: true });
  });

  heading.append(headingCopy, changeService);

  const choices = document.createElement('div');
  choices.className = 'booking-service-staff-reveal__choices';
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', `Team members for ${serviceName}`);
  visibleButtons.forEach(button => choices.append(cloneStaffChoice(button)));

  reveal.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    dismissReveal(root, selectedService);
    selectedService.focus({ preventScroll: true });
  });

  reveal.append(heading, choices);
  serviceList.append(reveal);
  positionReveal(serviceList, selectedService, reveal);
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

function connectObserver() {
  const root = document.getElementById('booking-flow');
  if (!root) {
    connecting = false;
    return;
  }

  if (observer && observedRoot === root) {
    connecting = false;
    scheduleSync();
    return;
  }

  observer?.disconnect();
  observedRoot = root;
  observer = new window.MutationObserver(scheduleSync);
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-pressed', 'class', 'style'],
  });

  if (!resizeBound) {
    window.addEventListener('resize', scheduleSync, { passive: true });
    resizeBound = true;
  }

  connecting = false;
  scheduleSync();
}

export function ensurePublicServiceStaffReveal() {
  if (typeof document === 'undefined' || typeof window.MutationObserver === 'undefined' || connecting) return;
  connecting = true;
  onNextFrame(connectObserver);
}
