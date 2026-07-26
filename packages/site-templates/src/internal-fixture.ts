import type {
  PublishedPageSnapshot,
  PublishedSnapshotInput,
  SiteConversionRole,
  SitePageType,
  SiteSection,
} from '@ks-os/site-schema';
import { freezePublishedSnapshot } from '@ks-os/site-schema';

const id = (value: number) =>
  `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

const serviceReference = id(201);
const locationReference = id(301);
const staffReference = id(401);
const heroAssetReference = id(501);
const staffAssetReference = id(502);
const resultAssetReference = id(503);

export const ORIGINAL_INTERNAL_TEMPLATE_DEFINITION = Object.freeze({
  sourceType: 'INTERNAL' as const,
  name: 'Northlight renderer verification template',
  purpose: 'Original automated renderer fixture; not a production-ready design.',
  rendererVersion: 1,
});

function booking(label = 'Book an appointment', service?: string) {
  return {
    type: 'KS_OS_BOOKING' as const,
    label,
    ...(service ? { serviceReference: service } : {}),
  };
}

function createPageFactory() {
  let pageCounter = 600;
  let sectionCounter = 800;
  const sectionReference = () => id(sectionCounter++);
  const pages: PublishedPageSnapshot[] = [];

  const header = (): SiteSection => ({
    reference: sectionReference(),
    type: 'HEADER',
    primaryAction: booking('Book now'),
  });
  const hero = (heading: string, body: string, service?: string): SiteSection => ({
    reference: sectionReference(),
    type: 'HERO',
    variant: 'editorial',
    eyebrow: 'Northlight Studio',
    heading,
    body,
    imageAssetReference: heroAssetReference,
    primaryAction: booking('Book now', service),
  });
  const finalCta = (service?: string): SiteSection => ({
    reference: sectionReference(),
    type: 'FINAL_CTA',
    heading: 'Ready when you are',
    body: 'Choose a suitable time through the secure KS OS booking journey.',
    primaryAction: booking('Book an appointment', service),
  });
  const footer = (): SiteSection => ({
    reference: sectionReference(),
    type: 'FOOTER',
    primaryAction: booking('Book now'),
    legalText: 'Original demonstration content for renderer verification.',
  });

  function page(input: {
    pageType: SitePageType;
    conversionRole: SiteConversionRole;
    path: string;
    title: string;
    rendererKey: string;
    sections: SiteSection[];
  }) {
    const publicReference = id(pageCounter++);
    pages.push({
      publicReference,
      pageType: input.pageType,
      conversionRole: input.conversionRole,
      path: input.path,
      title: input.title,
      active: true,
      indexable: input.pageType !== 'BOOKING',
      canonical: true,
      rendererKey: input.rendererKey,
      rendererVersion: 1,
      rendererStatus: 'READY',
      layoutReference: id(pageCounter + 100),
      layoutStatus: 'APPROVED',
      templateVersionStatus: 'APPROVED',
      compatiblePageTypes: [input.pageType],
      seo: {
        title: `${input.title} | Northlight Studio`,
        description: `Explore ${input.title.toLowerCase()} at Northlight Studio and book securely through KS OS.`,
        canonicalPath: input.path,
        index: input.pageType !== 'BOOKING',
        follow: true,
        openGraphTitle: `${input.title} | Northlight Studio`,
        openGraphDescription: `Original demonstration page for ${input.title.toLowerCase()}.`,
        openGraphImageAssetReference: heroAssetReference,
        twitterCard: 'summary_large_image',
      },
      sections: [header(), ...input.sections, footer()],
    });
    return publicReference;
  }

  return {
    pages,
    sectionReference,
    page,
    hero,
    finalCta,
  };
}

export function createOriginalInternalSiteFixture(input: {
  hostname?: string;
  siteReference?: string;
  versionReference?: string;
  tenantSubdomain?: string;
  businessName?: string;
} = {}) {
  const factory = createPageFactory();
  const homeReference = factory.page({
    pageType: 'HOME',
    conversionRole: 'PRIMARY_LANDING',
    path: '/',
    title: 'Home',
    rendererKey: 'home-editorial-v1',
    sections: [
      factory.hero(
        'Thoughtful treatments, booked without friction',
        'An original internal template used to prove secure multi-tenant rendering.',
      ),
      {
        reference: factory.sectionReference(),
        type: 'INTRODUCTION',
        heading: 'A calm, practical approach',
        body: 'Northlight Studio is fictional demonstration content created for KS OS testing.',
      },
      {
        reference: factory.sectionReference(),
        type: 'FEATURED_SERVICES',
        heading: 'Featured services',
        serviceReferences: [serviceReference],
      },
      factory.finalCta(),
    ],
  });
  const servicesReference = factory.page({
    pageType: 'SERVICE_HUB',
    conversionRole: 'SERVICE_CONVERSION',
    path: '/services',
    title: 'Services',
    rendererKey: 'service-hub-grid-v1',
    sections: [
      factory.hero('Services designed around you', 'Browse the original demonstration service list.'),
      {
        reference: factory.sectionReference(),
        type: 'SERVICE_GRID',
        heading: 'Treatment menu',
        serviceReferences: [serviceReference],
      },
      factory.finalCta(),
    ],
  });
  const serviceDetailReference = factory.page({
    pageType: 'SERVICE_DETAIL',
    conversionRole: 'SERVICE_CONVERSION',
    path: '/services/clarity-session',
    title: 'Clarity Session',
    rendererKey: 'service-detail-editorial-v1',
    sections: [
      {
        reference: factory.sectionReference(),
        type: 'SERVICE_DETAILS',
        heading: 'A focused clarity session',
        body: 'A fictional sixty-minute service used to verify service-aware booking.',
        serviceReference,
        imageAssetReference: heroAssetReference,
        primaryAction: booking('Book the clarity session', serviceReference),
      },
      {
        reference: factory.sectionReference(),
        type: 'BENEFITS',
        heading: 'What to expect',
        items: [
          { heading: 'A considered plan', body: 'We begin by understanding your goals.' },
          { heading: 'Clear next steps', body: 'You leave with a simple, practical direction.' },
        ],
      },
      factory.finalCta(serviceReference),
    ],
  });
  const aboutReference = factory.page({
    pageType: 'ABOUT',
    conversionRole: 'TRUST_BUILDING',
    path: '/about',
    title: 'About',
    rendererKey: 'about-editorial-v1',
    sections: [
      factory.hero('A studio built around thoughtful care', 'Original placeholder copy, not a client claim.'),
      {
        reference: factory.sectionReference(),
        type: 'INTRODUCTION',
        heading: 'Our approach',
        body: 'Every part of this test site is structured, validated, and safely rendered.',
      },
      {
        reference: factory.sectionReference(),
        type: 'TRUST_INDICATORS',
        heading: 'Renderer principles',
        items: [
          { label: 'Structured content', detail: 'No arbitrary scripts or module paths.' },
          { label: 'Native booking', detail: 'Primary actions always enter KS OS booking.' },
        ],
      },
      factory.finalCta(),
    ],
  });
  const teamReference = factory.page({
    pageType: 'TEAM_HUB',
    conversionRole: 'TRUST_BUILDING',
    path: '/team',
    title: 'Team',
    rendererKey: 'team-grid-v1',
    sections: [
      factory.hero('Meet the demonstration team', 'A fictional profile for accessibility testing.'),
      {
        reference: factory.sectionReference(),
        type: 'TEAM',
        heading: 'Our team',
        staffReferences: [staffReference],
      },
      factory.finalCta(),
    ],
  });
  const contactReference = factory.page({
    pageType: 'CONTACT',
    conversionRole: 'LOCAL_DISCOVERY',
    path: '/contact',
    title: 'Location and contact',
    rendererKey: 'contact-v1',
    sections: [
      factory.hero('Find Northlight Studio', 'Original location data for renderer testing.'),
      {
        reference: factory.sectionReference(),
        type: 'LOCATION',
        heading: 'Visit us',
        locationReference,
      },
      {
        reference: factory.sectionReference(),
        type: 'OPENING_HOURS',
        heading: 'Opening hours',
        locationReference,
      },
      {
        reference: factory.sectionReference(),
        type: 'CONTACT',
        heading: 'Contact',
        body: 'Booking remains the primary route; public contact methods are secondary.',
        secondaryActions: [
          {
            type: 'PHONE',
            label: 'Call the studio',
            phoneNumber: '+44 1234 567890',
            secondary: true,
          },
          {
            type: 'EMAIL',
            label: 'Email the studio',
            emailAddress: 'hello@northlight.example',
            secondary: true,
          },
        ],
      },
      factory.finalCta(),
    ],
  });
  const faqReference = factory.page({
    pageType: 'FAQ',
    conversionRole: 'OBJECTION_HANDLING',
    path: '/faq',
    title: 'Frequently asked questions',
    rendererKey: 'faq-v1',
    sections: [
      factory.hero('Questions, answered clearly', 'Controlled visible FAQ content.'),
      {
        reference: factory.sectionReference(),
        type: 'FAQ',
        heading: 'Common questions',
        items: [
          {
            question: 'How do I book?',
            answer: 'Use any Book now action to enter the native KS OS booking journey.',
          },
          {
            question: 'Is this a real studio?',
            answer: 'No. Northlight Studio is original placeholder content for automated tests.',
          },
        ],
      },
      factory.finalCta(),
    ],
  });
  const resultsReference = factory.page({
    pageType: 'RESULTS',
    conversionRole: 'TRUST_BUILDING',
    path: '/results',
    title: 'Results',
    rendererKey: 'results-grid-v1',
    sections: [
      factory.hero('A controlled results gallery', 'No fabricated ratings or review scores.'),
      {
        reference: factory.sectionReference(),
        type: 'RESULTS',
        heading: 'Demonstration results',
        items: [
          {
            afterAssetReference: resultAssetReference,
            caption: 'An abstract original placeholder image.',
          },
        ],
      },
      {
        reference: factory.sectionReference(),
        type: 'TESTIMONIALS',
        heading: 'Fixture feedback',
        items: [{
          quote: 'The booking path was clear and keyboard friendly.',
          attribution: 'Original test fixture',
        }],
      },
      factory.finalCta(),
    ],
  });
  const guideReference = factory.page({
    pageType: 'NEW_CLIENT_GUIDE',
    conversionRole: 'OBJECTION_HANDLING',
    path: '/new-client-guide',
    title: 'New client guide',
    rendererKey: 'guide-editorial-v1',
    sections: [
      factory.hero('Your first visit', 'A concise guide expressed as validated rich-text nodes.'),
      {
        reference: factory.sectionReference(),
        type: 'RICH_TEXT',
        heading: 'Before you arrive',
        document: {
          blocks: [
            {
              type: 'PARAGRAPH',
              children: [{
                type: 'TEXT',
                text: 'Choose a service, select a suitable time, and follow the booking steps.',
              }],
            },
            {
              type: 'UNORDERED_LIST',
              items: [
                { children: [{ type: 'TEXT', text: 'Review your booking details.' }] },
                { children: [{ type: 'TEXT', text: 'Contact the public studio number if needed.' }] },
              ],
            },
          ],
        },
      },
      factory.finalCta(),
    ],
  });
  const policiesReference = factory.page({
    pageType: 'POLICIES',
    conversionRole: 'TRUST_BUILDING',
    path: '/policies',
    title: 'Policies',
    rendererKey: 'policies-v1',
    sections: [
      factory.hero('Studio policies', 'Original placeholder policy copy for renderer testing.'),
      {
        reference: factory.sectionReference(),
        type: 'RICH_TEXT',
        heading: 'Booking policy',
        document: {
          blocks: [{
            type: 'PARAGRAPH',
            children: [{
              type: 'TEXT',
              text: 'Please review the confirmed details in your native KS OS booking journey.',
            }],
          }],
        },
      },
      factory.finalCta(),
    ],
  });
  const bookingReference = factory.page({
    pageType: 'BOOKING',
    conversionRole: 'BOOKING',
    path: '/book',
    title: 'Book',
    rendererKey: 'booking-v1',
    sections: [{
      reference: factory.sectionReference(),
      type: 'BOOKING_CTA',
      heading: 'Book securely',
      body: 'Continue to the native KS OS booking application.',
      primaryAction: booking('Continue to booking'),
    }],
  });

  const hostname = input.hostname ?? 'northlight.sites.kasimshah.com';
  const snapshot = {
    schemaVersion: 1,
    publicReference: id(1),
    siteReference: input.siteReference ?? id(2),
    versionReference: input.versionReference ?? id(3),
    templateVersionReference: id(4),
    visibility: 'PUBLISHED',
    siteStatus: 'LIVE',
    versionStatus: 'PUBLISHED',
    createdAt: '2026-07-24T12:00:00.000Z',
    publishedAt: '2026-07-24T12:00:00.000Z',
    language: 'en-GB',
    theme: {
      primaryColour: '#213547',
      secondaryColour: '#5f7464',
      accentColour: '#b86b4b',
      backgroundColour: '#f7f4ee',
      surfaceColour: '#ffffff',
      textColour: '#172025',
      mutedTextColour: '#536168',
      borderColour: '#d7ddd8',
      headingFontKey: 'EDITORIAL_SERIF',
      bodyFontKey: 'SYSTEM_SANS',
      radiusScale: 'MEDIUM',
      spacingDensity: 'COMFORTABLE',
      containerWidth: 'STANDARD',
      buttonStyle: 'SOLID',
      imageStyle: 'ROUNDED',
      motionPreference: 'REDUCED',
    },
    navigation: {
      primary: [
        { label: 'Home', pageReference: homeReference, children: [] },
        {
          label: 'Services',
          pageReference: servicesReference,
          children: [{ label: 'Clarity Session', pageReference: serviceDetailReference }],
        },
        { label: 'About', pageReference: aboutReference, children: [] },
        { label: 'Team', pageReference: teamReference, children: [] },
        { label: 'Contact', pageReference: contactReference, children: [] },
      ],
      footer: [
        { label: 'FAQ', pageReference: faqReference, children: [] },
        { label: 'Results', pageReference: resultsReference, children: [] },
        { label: 'New client guide', pageReference: guideReference, children: [] },
        { label: 'Policies', pageReference: policiesReference, children: [] },
        { label: 'Book', pageReference: bookingReference, children: [] },
      ],
    },
    business: {
      name: input.businessName ?? 'Northlight Studio',
      description: 'An original internal test business used to validate the KS OS renderer.',
      publicTelephone: '+44 1234 567890',
      publicEmail: 'hello@northlight.example',
      socialLinks: [],
    },
    locations: [{
      publicReference: locationReference,
      name: 'Northlight Studio',
      addressLines: ['10 Example Lane'],
      locality: 'Blackburn',
      region: 'Lancashire',
      postalCode: 'BB1 1AA',
      countryCode: 'GB',
      publicTelephone: '+44 1234 567890',
      openingHours: [
        { day: 'MONDAY', opens: '09:00', closes: '17:00' },
        { day: 'TUESDAY', opens: '09:00', closes: '17:00' },
        { day: 'WEDNESDAY', opens: '09:00', closes: '17:00' },
        { day: 'THURSDAY', opens: '10:00', closes: '19:00' },
        { day: 'FRIDAY', opens: '09:00', closes: '17:00' },
        { day: 'SATURDAY', opens: '09:00', closes: '14:00' },
        { day: 'SUNDAY', opens: null, closes: null },
      ],
    }],
    services: [{
      publicReference: serviceReference,
      name: 'Clarity Session',
      shortDescription: 'An original fictional service used for renderer verification.',
      durationMinutes: 60,
      priceText: 'From £65',
      imageAssetReference: heroAssetReference,
      bookingEnabled: true,
    }],
    staff: [{
      publicReference: staffReference,
      displayName: 'Morgan Reed',
      role: 'Studio specialist',
      biography: 'A fictional profile written specifically for this original test fixture.',
      imageAssetReference: staffAssetReference,
      bookingEnabled: true,
      serviceReferences: [serviceReference],
    }],
    assets: [
      {
        publicReference: heroAssetReference,
        type: 'IMAGE',
        publicationStatus: 'PUBLISHED',
        mimeType: 'image/webp',
        url: 'https://assets.example.invalid/northlight/original-abstract.webp',
        width: 1_600,
        height: 1_067,
        purpose: 'INFORMATIVE',
        alt: 'An original abstract arrangement of warm geometric shapes',
        variants: [],
      },
      {
        publicReference: staffAssetReference,
        type: 'IMAGE',
        publicationStatus: 'PUBLISHED',
        mimeType: 'image/webp',
        url: 'https://assets.example.invalid/northlight/original-profile.webp',
        width: 800,
        height: 1_000,
        purpose: 'INFORMATIVE',
        alt: 'Original illustrated placeholder portrait for the test team member',
        variants: [],
      },
      {
        publicReference: resultAssetReference,
        type: 'IMAGE',
        publicationStatus: 'PUBLISHED',
        mimeType: 'image/webp',
        url: 'https://assets.example.invalid/northlight/original-result.webp',
        width: 1_200,
        height: 900,
        purpose: 'DECORATIVE',
        alt: '',
        variants: [],
      },
    ],
    domains: [{
      hostname,
      kind: hostname.endsWith('.sites.kasimshah.com') ? 'FALLBACK' : 'CUSTOM',
      status: 'ACTIVE',
      primary: true,
    }],
    canonicalHostname: hostname,
    booking: {
      tenantReference: id(5),
      tenantSubdomain: input.tenantSubdomain ?? 'northlight',
      campaignReference: 'site',
    },
    pages: factory.pages,
  } satisfies PublishedSnapshotInput;

  return freezePublishedSnapshot(snapshot);
}
