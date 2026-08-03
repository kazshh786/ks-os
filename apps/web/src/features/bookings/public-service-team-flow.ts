let observer: MutationObserver | null = null;
let observedRoot: HTMLElement | null = null;
let scheduled = false;
let connecting = false;

function syncTeamDrawerFlow(root: ParentNode) {
  const selectedService = root.querySelector<HTMLElement>(
    '.booking-service-list.has-team-drawer > .booking-service-choice.is-team-expanded',
  );
  const drawer = root.querySelector<HTMLElement>('.booking-service-staff-reveal');

  if (!selectedService || !drawer || selectedService.parentElement !== drawer.parentElement) return;
  if (selectedService.nextElementSibling === drawer) return;

  selectedService.insertAdjacentElement('afterend', drawer);
}

function scheduleSync() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    const root = document.getElementById('booking-flow');
    if (root) syncTeamDrawerFlow(root);
  });
}

function connectObserver() {
  const root = document.getElementById('booking-flow');
  if (!root) {
    connecting = false;
    window.requestAnimationFrame(ensurePublicServiceTeamFlow);
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
    attributeFilter: ['class', 'aria-expanded'],
  });

  connecting = false;
  scheduleSync();
}

export function ensurePublicServiceTeamFlow() {
  if (typeof document === 'undefined' || typeof window === 'undefined' || connecting) return;
  if (typeof window.MutationObserver === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;

  connecting = true;
  window.requestAnimationFrame(connectObserver);
}
