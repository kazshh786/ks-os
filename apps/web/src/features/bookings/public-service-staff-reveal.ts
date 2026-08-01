import { getDataProvider } from '../../data/data-provider.js';

const originalStaffFieldsetClass = 'booking-original-staff-fieldset';
const revealClass = 'booking-service-staff-reveal';
const expandedServiceClass = 'is-team-expanded';
const serviceListOpenClass = 'has-team-drawer';
const dismissedAttribute = 'data-team-drawer-dismissed';
const toggleBoundAttribute = 'data-team-drawer-toggle-bound';
const drawerId = 'booking-service-team-drawer';
const summaryProfileClass = 'booking-summary-team-profile';

type StaffProfile = {
  id?: string;
  name: string;
  role?: string | null;
  bio?: string | null;
  imageUrl?: string | null;
};

type PublicCatalogPayload = {
  staff?: StaffProfile[];
  data?: { staff?: StaffProfile[] };
};

type StaffChoiceDetails = {
  name: string;
  role: string;
  anyoneAvailable: boolean;
};

let observer: MutationObserver | null = null;
let observedRoot: HTMLElement | null = null;
let scheduled = false;
let connecting = false;
let resizeBound = false;
let catalogIdentifier: string | null = null;
let catalogLoad: Promise<void> | null = null;
let loadedStaffProfiles: StaffProfile[] = [];

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

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'TM';
}

function staffChoiceDetails(button: HTMLButtonElement): StaffChoiceDetails {
  if (isAnyoneAvailableButton(button)) {
    return {
      name: 'Anyone available',
      role: 'First available team member',
      anyoneAvailable: true,
    };
  }

  const ariaLabel = button.getAttribute('aria-label') || '';
  const [labelName, ...labelRoleParts] = ariaLabel.split(',');
  const visibleCopy = Array.from(button.querySelectorAll<HTMLElement>('p'))
    .map(element => element.textContent?.trim())
    .filter((value): value is string => Boolean(value));

  return {
    name: labelName?.trim() || visibleCopy[0] || 'Team member',
    role: labelRoleParts.join(',').trim() || visibleCopy[1] || 'Team member',
    anyoneAvailable: false,
  };
}

function createStaffChoice(original: HTMLButtonElement) {
  const details = staffChoiceDetails(original);
  const choice = document.createElement('button');
  choice.type = 'button';
  choice.className = 'booking-service-staff-reveal__choice';
  choice.setAttribute('aria-label', original.getAttribute('aria-label') || `${details.name}, ${details.role}`);
  choice.setAttribute('aria-pressed', original.getAttribute('aria-pressed') || 'false');

  const avatar = document.createElement('span');
  avatar.className = 'booking-service-staff-reveal__avatar';
  avatar.setAttribute('aria-hidden', 'true');
  const originalImage = original.querySelector<HTMLImageElement>('img');
  if (originalImage && !details.anyoneAvailable) {
    const image = originalImage.cloneNode(true) as HTMLImageElement;
    image.alt = '';
    avatar.append(image);
  } else {
    avatar.textContent = details.anyoneAvailable ? 'Any' : initials(details.name);
  }

  const copy = document.createElement('span');
  copy.className = 'booking-service-staff-reveal__choice-copy';
  const name = document.createElement('strong');
  name.className = 'booking-service-staff-reveal__choice-name';
  name.textContent = details.name;
  const role = document.createElement('small');
  role.className = 'booking-service-staff-reveal__choice-role';
  role.textContent = details.role;
  copy.append(name, role);

  const selected = document.createElement('span');
  selected.className = 'booking-service-staff-reveal__choice-selected';
  selected.setAttribute('aria-hidden', 'true');
  selected.textContent = '✓';

  choice.append(avatar, copy, selected);
  choice.addEventListener('click', event => {
    event.preventDefault();
    original.click();
  });
  return choice;
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
  const maximumHeight = Math.min(390, availableViewportHeight);
  const serviceHeight = Math.max(88, selectedService.offsetHeight || serviceRect.height || 0);

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

function matchingSummaryProfile(root: ParentNode, profiles: StaffProfile[]) {
  const summary = root.querySelector<HTMLElement>('.booking-summary-column');
  if (!summary) return undefined;

  const visibleNames = Array.from(summary.querySelectorAll<HTMLElement>('span'))
    .filter(element => !element.closest(`.${summaryProfileClass}`))
    .map(element => element.textContent?.trim())
    .filter((value): value is string => Boolean(value));

  return profiles.find(profile => visibleNames.includes(profile.name.trim()));
}

function matchingSelectedProfile(memberButtons: HTMLButtonElement[], profiles: StaffProfile[]) {
  const selected = memberButtons.find(button => button.getAttribute('aria-pressed') === 'true');
  if (!selected) return undefined;
  const details = staffChoiceDetails(selected);
  if (details.anyoneAvailable) return undefined;
  return profiles.find(profile => profile.name.trim().toLowerCase() === details.name.toLowerCase());
}

function syncSummaryStaffProfile(root: ParentNode, memberButtons: HTMLButtonElement[], profiles: StaffProfile[]) {
  if (profiles.length === 0) return;

  const summaryBody = root.querySelector<HTMLElement>('.booking-summary-column .space-y-4');
  const previous = root.querySelector<HTMLElement>(`.${summaryProfileClass}`);
  if (!summaryBody) {
    previous?.remove();
    return;
  }

  const profile = matchingSummaryProfile(root, profiles) || matchingSelectedProfile(memberButtons, profiles);
  if (!profile) {
    previous?.remove();
    return;
  }

  const role = profile.role?.trim() || 'Team member';
  const bio = profile.bio?.trim() || `${profile.name} is part of the team as ${role}.`;
  const signature = [profile.id || profile.name, role, bio, profile.imageUrl || ''].join('|');
  if (previous?.dataset.signature === signature && previous.parentElement === summaryBody) return;

  previous?.remove();

  const card = document.createElement('section');
  card.className = summaryProfileClass;
  card.dataset.signature = signature;
  card.setAttribute('aria-label', `About ${profile.name}`);
  card.setAttribute('aria-live', 'polite');

  const header = document.createElement('div');
  header.className = 'booking-summary-team-profile__header';
  const avatar = document.createElement('span');
  avatar.className = 'booking-summary-team-profile__avatar';
  avatar.setAttribute('aria-hidden', 'true');
  if (profile.imageUrl) {
    const image = document.createElement('img');
    image.src = profile.imageUrl;
    image.alt = '';
    avatar.append(image);
  } else {
    avatar.textContent = initials(profile.name);
  }

  const identity = document.createElement('span');
  identity.className = 'booking-summary-team-profile__identity';
  const name = document.createElement('strong');
  name.textContent = profile.name;
  const roleCopy = document.createElement('small');
  roleCopy.textContent = role;
  identity.append(name, roleCopy);
  header.append(avatar, identity);

  const bioCopy = document.createElement('p');
  bioCopy.className = 'booking-summary-team-profile__bio';
  bioCopy.textContent = bio;
  card.append(header, bioCopy);

  const total = Array.from(summaryBody.children)
    .find(element => element.classList.contains('border-t'));
  summaryBody.insertBefore(card, total || null);
}

export function syncPublicServiceStaffReveal(
  root: ParentNode = document,
  profiles: StaffProfile[] = loadedStaffProfiles,
) {
  const serviceFieldset = fieldsetByLegend(root, 'Choose a service');
  const staffFieldset = fieldsetByLegend(root, 'Choose who you book with');
  const previousReveal = root.querySelector<HTMLElement>(`.${revealClass}`);

  if (!serviceFieldset || !staffFieldset) {
    syncSummaryStaffProfile(root, [], profiles);
    previousReveal?.remove();
    staffFieldset?.classList.remove(originalStaffFieldsetClass);
    clearExpandedServiceState(root);
    return;
  }

  const selectedService = serviceFieldset.querySelector<HTMLButtonElement>('.booking-service-choice[aria-pressed="true"]');
  if (!selectedService) {
    syncSummaryStaffProfile(root, [], profiles);
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

  syncSummaryStaffProfile(root, memberButtons, profiles);

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
  const title = document.createElement('h3');
  title.textContent = 'Choose one of our team members';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'booking-service-staff-reveal__close';
  close.setAttribute('aria-label', 'Close team member choices');
  close.textContent = '×';
  close.addEventListener('click', () => {
    dismissReveal(root, selectedService);
    selectedService.focus({ preventScroll: true });
  });
  heading.append(title, close);

  const choices = document.createElement('div');
  choices.className = 'booking-service-staff-reveal__choices';
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', `Team members for ${serviceName}`);
  visibleButtons.forEach(button => choices.append(createStaffChoice(button)));

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

function loadStaffProfiles(identifier: string) {
  if (catalogIdentifier === identifier && catalogLoad) return;

  catalogIdentifier = identifier;
  loadedStaffProfiles = [];
  const requestedIdentifier = identifier;
  catalogLoad = getDataProvider().getPublicCatalog(identifier)
    .then(payload => {
      if (catalogIdentifier !== requestedIdentifier) return;
      const catalog = payload as PublicCatalogPayload;
      loadedStaffProfiles = catalog.staff || catalog.data?.staff || [];
      scheduleSync();
    })
    .catch(() => {
      if (catalogIdentifier !== requestedIdentifier) return;
      loadedStaffProfiles = [];
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

export function ensurePublicServiceStaffReveal(identifier?: string | null) {
  if (identifier) loadStaffProfiles(identifier);
  if (typeof document === 'undefined' || typeof window.MutationObserver === 'undefined' || connecting) return;
  connecting = true;
  onNextFrame(connectObserver);
}
