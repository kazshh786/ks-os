import { useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck2,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  LockKeyhole,
  ReceiptText,
  Sparkles,
} from 'lucide-react';
import { useParams, useSearchParams } from 'react-router';
import { PublicBookingFlow } from '../features/bookings/PublicBookingFlow.js';
import { getDataProvider } from '../data/data-provider.js';
import { currentPublicBookingIdentifier } from '../lib/workspace-hostname.js';
import './BookingWizardPage.css';

type CatalogService = {
  id: string;
  publicReference?: string;
  name: string;
  description: string | null;
  duration: number;
  price: number;
  category?: string | null;
};

type BookingCatalog = {
  page?: {
    title?: string;
    description?: string;
    logoUrl?: string | null;
  };
  tenant?: {
    name: string;
    currency?: string;
  };
  tenantName?: string;
  services: CatalogService[];
};

const conversionPromises = [
  {
    icon: CalendarCheck2,
    title: 'Live availability',
    description: 'Choose from appointment times checked by the booking system.',
  },
  {
    icon: ReceiptText,
    title: 'Clear total and commitment',
    description: 'See the total price and what is due before you confirm.',
  },
  {
    icon: LockKeyhole,
    title: 'No account required',
    description: 'Book as a guest and manage the appointment from your secure email link.',
  },
] as const;

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'KS';
}

export function BookingWizardPage() {
  const { subdomain } = useParams();
  const [search, setSearch] = useSearchParams();
  const bookingIdentifier = subdomain || currentPublicBookingIdentifier();
  const preview = search.get('preview') === '1';
  const selectedServiceReference = search.get('service');
  const [catalog, setCatalog] = useState<BookingCatalog | null>(null);
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    if (!bookingIdentifier) return;
    const provider = getDataProvider();
    if (typeof provider.getPublicCatalog !== 'function') return;

    let active = true;
    setCatalog(null);
    provider.getPublicCatalog(bookingIdentifier)
      .then((data: BookingCatalog) => {
        if (active) setCatalog(data);
      })
      .catch(() => {
        if (active) setCatalog(null);
      });
    return () => {
      active = false;
    };
  }, [bookingIdentifier]);

  const categories = useMemo(() => {
    const assigned = (catalog?.services || [])
      .map(service => service.category?.trim())
      .filter((category): category is string => Boolean(category));
    return Array.from(new Set(assigned)).sort((a, b) => a.localeCompare(b));
  }, [catalog]);

  useEffect(() => {
    if (activeCategory !== 'all' && !categories.includes(activeCategory)) setActiveCategory('all');
  }, [activeCategory, categories]);

  const visibleServices = useMemo(() => {
    const services = catalog?.services || [];
    if (activeCategory === 'all') return services;
    return services.filter(service => service.category?.trim() === activeCategory);
  }, [activeCategory, catalog]);

  if (!bookingIdentifier) {
    return (
      <section className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-black text-slate-950">Booking page unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          This address is not connected to a business workspace.
        </p>
      </section>
    );
  }

  const businessName = catalog?.tenant?.name || catalog?.tenantName || 'Online booking';
  const currencyCode = catalog?.tenant?.currency || 'GBP';
  const formatCurrency = (amount: number) => new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currencyCode,
  }).format(amount / 100);
  const catalogueReady = Boolean(catalog?.services?.length);

  const chooseService = (service: CatalogService) => {
    if (!service.publicReference) return;
    const next = new URLSearchParams(search);
    next.set('service', service.publicReference);
    setSearch(next, { replace: true });
  };

  return (
    <div className={`booking-experience${catalogueReady ? ' booking-experience--catalog-ready' : ''}`}>
      <a href="#booking-flow" className="booking-skip-link">
        Skip to booking options
      </a>

      {preview ? (
        <div role="status" className="booking-preview-banner">
          <CheckCircle2 aria-hidden="true" />
          Preview mode is active. You can test the journey, but no real booking or payment will be created.
        </div>
      ) : null}

      <div className="booking-experience__shell">
        <aside className="booking-experience__rail" aria-labelledby="booking-page-title">
          <div className="booking-brand">
            {catalog?.page?.logoUrl ? (
              <img src={catalog.page.logoUrl} alt={`${businessName} logo`} className="booking-brand__logo" />
            ) : (
              <div className="booking-brand__monogram" aria-hidden="true">{initials(businessName)}</div>
            )}
            <div className="booking-brand__copy">
              <p>{businessName}</p>
              <span><Sparkles aria-hidden="true" /> Secure online booking</span>
            </div>
          </div>

          <section className="booking-intro">
            <p className="booking-eyebrow">Book in four clear steps</p>
            <h1 id="booking-page-title">Choose a service and book a live appointment time</h1>
            <p className="booking-intro__description">
              Complete the booking in four clear steps. You will see availability, the full price and the exact payment commitment before confirming.
            </p>

            <ul className="booking-benefits" aria-label="Booking benefits">
              {conversionPromises.map(item => (
                <li key={item.title}>
                  <span className="booking-benefits__icon"><item.icon aria-hidden="true" /></span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="booking-service-picker" aria-labelledby="service-picker-title">
            <div className="booking-service-picker__heading">
              <div>
                <p className="booking-eyebrow">Start here</p>
                <h2 id="service-picker-title">Select a service</h2>
              </div>
              <span>{catalog?.services.length || 0}</span>
            </div>

            {categories.length ? (
              <div className="booking-category-tabs" aria-label="Service categories">
                <button
                  type="button"
                  aria-pressed={activeCategory === 'all'}
                  onClick={() => setActiveCategory('all')}
                >
                  All services
                </button>
                {categories.map(category => (
                  <button
                    type="button"
                    key={category}
                    aria-pressed={activeCategory === category}
                    onClick={() => setActiveCategory(category)}
                  >
                    {category}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="booking-service-list" aria-live="polite">
              {!catalog ? (
                <div className="booking-service-skeleton" aria-label="Loading services">
                  <span />
                  <span />
                  <span />
                </div>
              ) : null}

              {visibleServices.map(service => {
                const selected = selectedServiceReference === service.publicReference;
                const category = service.category?.trim();
                return (
                  <button
                    type="button"
                    key={service.id}
                    className="booking-service-card"
                    aria-pressed={selected}
                    aria-label={`Select ${service.name}, ${service.duration} minutes, ${formatCurrency(service.price)}`}
                    onClick={() => chooseService(service)}
                    disabled={!service.publicReference}
                  >
                    <span className="booking-service-card__main">
                      <span className="booking-service-card__title-row">
                        <strong>{service.name}</strong>
                        <b>{formatCurrency(service.price)}</b>
                      </span>
                      <small>{service.description || 'Choose this service to see live appointment times.'}</small>
                      <span className="booking-service-card__meta">
                        {category ? <em>{category}</em> : null}
                        <span><Clock3 aria-hidden="true" /> {service.duration} minutes</span>
                      </span>
                    </span>
                    <span className="booking-service-card__action" aria-hidden="true">
                      {selected ? <Check /> : <ChevronRight />}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </aside>

        <section className="booking-experience__workspace" aria-label="Booking steps">
          <div className="booking-workspace-bar">
            <span><CalendarCheck2 aria-hidden="true" /> Live availability</span>
            <span><ReceiptText aria-hidden="true" /> Total shown before confirmation</span>
            <span><LockKeyhole aria-hidden="true" /> Guest booking</span>
          </div>
          <div id="booking-flow" tabIndex={-1} className="booking-flow-surface">
            <PublicBookingFlow
              key={`${bookingIdentifier}:${selectedServiceReference || 'unselected'}:${preview}`}
              slug={bookingIdentifier}
              preview={preview}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

export default BookingWizardPage;
