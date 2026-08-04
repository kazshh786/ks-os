const packageSummaries = [
  {
    name: 'Essential',
    launch: '£197',
    monthly: '£97',
    summary: 'Professional brand, website, copywriting, booking, CRM and ongoing support.',
  },
  {
    name: 'Growth',
    launch: '£297',
    monthly: '£197',
    summary: 'Advanced CRM, staff tools, payments, automation, reviews and reporting.',
    popular: true,
  },
  {
    name: 'Scale',
    launch: '£397',
    monthly: '£297',
    summary: 'Advanced automation, multi-location tools and monthly growth consultation.',
  },
];

function createNavigationLink(className: string) {
  const link = document.createElement('a');
  link.href = '/packages';
  link.textContent = 'Packages';
  link.className = className;
  link.dataset.ksPackagesLink = 'true';
  return link;
}

function installNavigationLinks() {
  const desktopNavigation = document.querySelector<HTMLElement>('nav[aria-label="Primary navigation"]');
  if (desktopNavigation && !desktopNavigation.querySelector('[data-ks-packages-link]')) {
    desktopNavigation.prepend(createNavigationLink('text-sm font-bold text-slate-600 transition hover:text-indigo-700'));
  }

  const mobileNavigation = document.querySelector<HTMLElement>('nav[aria-label="Mobile navigation"] > div');
  if (mobileNavigation && !mobileNavigation.querySelector('[data-ks-packages-link]')) {
    mobileNavigation.prepend(createNavigationLink('rounded-xl px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-100'));
  }

  const footerServicesLink = document.querySelector<HTMLAnchorElement>('footer a[href="/services"]');
  const footerLinks = footerServicesLink?.parentElement;
  if (footerLinks && !footerLinks.querySelector('[data-ks-packages-link]')) {
    footerLinks.prepend(createNavigationLink('hover:text-white'));
  }
}

function installHomePackagesSection() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/' || document.getElementById('packages')) return;

  const comparisonSection = document.getElementById('comparison');
  if (!comparisonSection) return;

  const section = document.createElement('section');
  section.id = 'packages';
  section.className = 'border-y border-slate-200 bg-white px-5 py-20 sm:py-28 lg:px-8';
  section.innerHTML = `
    <div class="mx-auto max-w-7xl">
      <div class="mx-auto max-w-3xl text-center">
        <p class="text-xs font-black uppercase tracking-[0.22em] text-indigo-700">Simple packages, full KS OS value</p>
        <h2 class="mt-4 text-4xl font-black tracking-[-0.05em] text-slate-950 sm:text-5xl">Choose your launch and monthly support level.</h2>
        <p class="mt-5 text-lg leading-8 text-slate-600">These packages do not replace the KS OS service catalogue. They make it easier to understand the professional launch work, platform access and ongoing support included at each level.</p>
      </div>
      <div class="mt-14 grid gap-7 lg:grid-cols-3">
        ${packageSummaries.map(item => `
          <article class="relative rounded-2xl border bg-white p-7 shadow-sm ${item.popular ? 'border-indigo-500 ring-4 ring-indigo-100' : 'border-slate-200'}">
            ${item.popular ? '<span class="absolute -top-3 left-6 rounded-full bg-indigo-600 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white">Most popular</span>' : ''}
            <h3 class="text-3xl font-black tracking-[-0.04em] text-slate-950">${item.name}</h3>
            <div class="mt-6 rounded-xl bg-slate-50 p-5">
              <p class="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Launch</p>
              <p class="mt-1 text-3xl font-black text-slate-950">${item.launch}</p>
              <p class="mt-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Then monthly</p>
              <p class="mt-1 text-3xl font-black text-indigo-600">${item.monthly}<span class="text-sm font-bold text-slate-500"> / month</span></p>
            </div>
            <p class="mt-6 text-sm font-semibold leading-7 text-slate-700">${item.summary}</p>
            <a href="/packages#${item.name.toLowerCase()}" class="mt-7 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-indigo-600 px-5 text-sm font-black text-white transition hover:bg-indigo-700">View ${item.name}</a>
          </article>
        `).join('')}
      </div>
      <div class="mt-10 flex flex-col items-center justify-between gap-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-6 text-center sm:flex-row sm:text-left">
        <div><p class="font-black text-slate-950">Every package includes a professional website, new logo, copywriting, business card and leaflet design.</p><p class="mt-2 text-sm leading-6 text-slate-600">There is no per-page website charge. The reasonable pages required to represent the business properly are included.</p></div>
        <a href="/packages" class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-indigo-200 bg-white px-5 text-sm font-black text-indigo-700 shadow-sm hover:bg-indigo-100">Compare every inclusion</a>
      </div>
    </div>
  `;

  comparisonSection.before(section);
}

export function installPackagesEnhancements() {
  const install = () => {
    installNavigationLinks();
    installHomePackagesSection();
  };

  install();
  window.setTimeout(install, 50);
  window.setTimeout(install, 250);
  window.setTimeout(install, 1000);
}
