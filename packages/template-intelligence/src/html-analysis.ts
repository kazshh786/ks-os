import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import {
  EMPTY_TEMPLATE_RESPONSIVE_SIGNALS,
  type TemplateBookingCtaPosition,
  type TemplateManifestSection,
  type TemplateSectionType,
} from '@ks-os/contracts';
import type {
  HtmlBookingCtaSignal,
  HtmlPageAnalysis,
} from './types.js';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

function childNodes(node: Node): Node[] {
  return 'childNodes' in node ? node.childNodes : [];
}

function walk(node: Node, visitor: (element: Element) => void) {
  if (isElement(node)) visitor(node);
  for (const child of childNodes(node)) walk(child, visitor);
}

function elements(node: Node, predicate?: (element: Element) => boolean) {
  const result: Element[] = [];
  walk(node, (element) => {
    if (!predicate || predicate(element)) result.push(element);
  });
  return result;
}

function attribute(element: Element, name: string) {
  return element.attrs.find((item) => item.name.toLowerCase() === name)?.value || null;
}

function textContent(node: Node): string {
  if ('value' in node) return node.value;
  return childNodes(node).map(textContent).join(' ');
}

function cleanText(value: string, max = 500) {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function ancestors(element: Element): Element[] {
  const result: Element[] = [];
  let current = element.parentNode;
  while (current) {
    if (isElement(current)) result.push(current);
    current = 'parentNode' in current ? current.parentNode : null;
  }
  return result;
}

function semanticSignal(element: Element) {
  return [
    element.tagName,
    attribute(element, 'id'),
    attribute(element, 'class'),
    attribute(element, 'role'),
    attribute(element, 'aria-label'),
    cleanText(textContent(element), 1_000),
  ].filter(Boolean).join(' ').toLowerCase();
}

function structuralReference(element: Element) {
  const id = attribute(element, 'id')?.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const classes = (attribute(element, 'class') || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((value) => value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60))
    .filter(Boolean);
  return `${element.tagName}${id ? `#${id}` : ''}${
    classes.length ? `.${classes.join('.')}` : ''
  }`.slice(0, 300);
}

const positiveBookingLabel =
  /\b(book(?:\s+now|\s+appointment)?|schedule\s+appointment|reserve|make\s+a\s+booking|check\s+availability)\b/i;
const negativeBookingLabel =
  /\b(buy\s+now|add\s+to\s+cart|view\s+portfolio|read\s+more|contact\s+us|subscribe)\b/i;

function bookingLabel(element: Element) {
  const value = cleanText(
    attribute(element, 'aria-label')
    || attribute(element, 'title')
    || textContent(element),
    120,
  );
  const destination = [
    attribute(element, 'href'),
    attribute(element, 'action'),
    attribute(element, 'data-action'),
    attribute(element, 'data-target'),
  ].filter(Boolean).join(' ');
  if (negativeBookingLabel.test(value)) return null;
  if (
    positiveBookingLabel.test(value)
    || /(?:^|[/?#_-])(book|booking|appointment|availability)(?:$|[/?#_-])/i.test(
      destination,
    )
  ) {
    return value || 'Booking action';
  }
  return null;
}

function hasAncestorSignal(element: Element, pattern: RegExp) {
  return ancestors(element).some((parent) => pattern.test(semanticSignal(parent)));
}

function bookingPosition(
  element: Element,
  sectionCandidates: readonly Element[],
): TemplateBookingCtaPosition {
  const ancestry = ancestors(element);
  if (ancestry.some((parent) => parent.tagName === 'header')) return 'HEADER';
  if (ancestry.some((parent) => parent.tagName === 'footer')) return 'FOOTER';
  if (hasAncestorSignal(element, /\b(sticky|fixed)[-_ ]?(mobile|bottom)|mobile[-_ ]?bar\b/)) {
    return 'STICKY_MOBILE';
  }
  if (hasAncestorSignal(element, /\bmobile[-_ ]?(nav|menu)|nav[-_ ]?mobile\b/)) {
    return 'MOBILE_NAVIGATION';
  }
  if (hasAncestorSignal(element, /\b(hero|masthead|banner)\b/)) return 'HERO';
  if (hasAncestorSignal(element, /\bservice[-_ ]?(card|item|tile)\b/)) {
    return 'SERVICE_CARD';
  }
  if (hasAncestorSignal(element, /\bservice[-_ ]?(detail|single)\b/)) {
    return 'SERVICE_DETAIL';
  }
  const containingSection = ancestry.find((parent) => sectionCandidates.includes(parent));
  const contentSections = sectionCandidates.filter(
    (candidate) => !['header', 'nav', 'footer'].includes(candidate.tagName),
  );
  if (
    containingSection
    && contentSections.indexOf(containingSection) === contentSections.length - 1
  ) {
    return 'FINAL_SECTION';
  }
  return 'OTHER';
}

function sectionType(
  element: Element,
  containsBookingAction: boolean,
  finalCandidate: boolean,
): { type: TemplateSectionType; confidence: number } {
  const signal = semanticSignal(element);
  if (element.tagName === 'header') return { type: 'HEADER', confidence: 1 };
  if (element.tagName === 'nav') return { type: 'NAVIGATION', confidence: 1 };
  if (element.tagName === 'footer') return { type: 'FOOTER', confidence: 1 };
  if (/\bannouncement|top[-_ ]?bar|promo[-_ ]?bar\b/.test(signal)) {
    return { type: 'ANNOUNCEMENT_BAR', confidence: 0.9 };
  }
  if (/\bhero|masthead|banner\b/.test(signal)) return { type: 'HERO', confidence: 0.94 };
  if (/\bfeatured[-_ ]?services?\b/.test(signal)) {
    return { type: 'FEATURED_SERVICES', confidence: 0.9 };
  }
  if (/\bservice[-_ ]?(grid|list|cards?)\b/.test(signal)) {
    return { type: 'SERVICE_GRID', confidence: 0.9 };
  }
  if (/\bservice[-_ ]?(detail|single)|treatment[-_ ]?detail\b/.test(signal)) {
    return { type: 'SERVICE_DETAILS', confidence: 0.92 };
  }
  if (/\bbenefits?|why[-_ ]?(us|choose)\b/.test(signal)) {
    return { type: 'BENEFITS', confidence: 0.84 };
  }
  if (/\b(process|how[-_ ]?it[-_ ]?works|steps)\b/.test(signal)) {
    return { type: 'PROCESS', confidence: 0.84 };
  }
  if (/\b(pricing|price[-_ ]?list|packages?)\b/.test(signal)) {
    return { type: 'PRICING', confidence: 0.9 };
  }
  if (/\b(staff[-_ ]?profile|team[-_ ]?member|practitioner[-_ ]?profile)\b/.test(signal)) {
    return { type: 'STAFF_PROFILE', confidence: 0.9 };
  }
  if (/\b(team|our[-_ ]?team|staff|practitioners?)\b/.test(signal)) {
    return { type: 'TEAM', confidence: 0.82 };
  }
  if (/\b(gallery|portfolio|lookbook)\b/.test(signal)) {
    return { type: 'GALLERY', confidence: 0.9 };
  }
  if (/\b(results?|before[-_ ]?after|case[-_ ]?stud)\b/.test(signal)) {
    return { type: 'RESULTS', confidence: 0.88 };
  }
  if (/\b(testimonials?|client[-_ ]?stories)\b/.test(signal)) {
    return { type: 'TESTIMONIALS', confidence: 0.9 };
  }
  if (/\b(review[-_ ]?summary|ratings?)\b/.test(signal)) {
    return { type: 'REVIEW_SUMMARY', confidence: 0.88 };
  }
  if (/\b(trust|accredit|awards?|certif)\b/.test(signal)) {
    return { type: 'TRUST_INDICATORS', confidence: 0.8 };
  }
  if (/\b(faq|frequently[-_ ]?asked|accordion)\b/.test(signal)) {
    return { type: 'FAQ', confidence: 0.9 };
  }
  if (/\b(opening[-_ ]?hours?|business[-_ ]?hours?|opening times)\b/.test(signal)) {
    return { type: 'OPENING_HOURS', confidence: 0.92 };
  }
  if (/\b(map|directions?)\b/.test(signal)) return { type: 'MAP', confidence: 0.75 };
  if (/\b(location|find[-_ ]?us|address)\b/.test(signal)) {
    return { type: 'LOCATION', confidence: 0.82 };
  }
  if (/\b(contact[-_ ]?form|get[-_ ]?in[-_ ]?touch)\b/.test(signal)) {
    return { type: 'CONTACT_FORM', confidence: 0.88 };
  }
  if (/\b(newsletter|mailing[-_ ]?list|subscribe)\b/.test(signal)) {
    return { type: 'NEWSLETTER', confidence: 0.9 };
  }
  if (/\b(policy|policies|privacy|terms|cancellation)\b/.test(signal)) {
    return { type: 'POLICIES', confidence: 0.88 };
  }
  if (containsBookingAction && /\bfinal[-_ ]?cta|closing[-_ ]?cta\b/.test(signal)) {
    return { type: 'FINAL_CTA', confidence: 0.94 };
  }
  if (containsBookingAction && finalCandidate) {
    return { type: 'FINAL_CTA', confidence: 0.9 };
  }
  if (containsBookingAction) return { type: 'BOOKING_CTA', confidence: 0.84 };
  if (/\b(introduction|intro|overview|welcome|about)\b/.test(signal)) {
    return { type: 'INTRODUCTION', confidence: 0.74 };
  }
  return { type: 'UNKNOWN', confidence: 0.35 };
}

export function inspectHtmlPage(html: string): HtmlPageAnalysis {
  const document = parse(html);
  const all = elements(document);
  const findTag = (tagName: string) => all.find((item) => item.tagName === tagName);
  const candidates = all.filter((element) => {
    if (['header', 'nav', 'footer', 'section', 'aside'].includes(element.tagName)) {
      return true;
    }
    const signal = semanticSignal(element);
    return element.tagName === 'div' && /\b(hero|cta|services?|team|gallery|faq|contact|location|pricing|testimonial)\b/.test(signal);
  });
  const actionable = all.filter((element) =>
    ['a', 'button', 'form', 'input'].includes(element.tagName)
  );
  const bookingCtas: HtmlBookingCtaSignal[] = actionable.flatMap((element) => {
    const label = bookingLabel(element);
    if (!label) return [];
    return [{
      label,
      structuralReference: structuralReference(element),
      position: bookingPosition(element, candidates),
    }];
  });

  const sections: TemplateManifestSection[] = candidates.map((element, index) => {
    const descendantBooking = actionable.some(
      (action) =>
        (action === element || ancestors(action).includes(element))
        && Boolean(bookingLabel(action)),
    );
    const classified = sectionType(
      element,
      descendantBooking,
      index === candidates.length - 1,
    );
    return {
      sectionType: classified.type,
      confidence: classified.confidence,
      domOrder: index,
      structuralReference: structuralReference(element),
      requiredForRecommendedPageType: false,
      containsBookingAction: descendantBooking,
      requiresAgencyReview: classified.confidence < 0.8 || classified.type === 'UNKNOWN',
    };
  });

  const titleElement = findTag('title');
  const htmlElement = findTag('html');
  const metaDescription = all.find(
    (element) =>
      element.tagName === 'meta'
      && attribute(element, 'name')?.toLowerCase() === 'description',
  );
  const canonical = all.find(
    (element) =>
      element.tagName === 'link'
      && attribute(element, 'rel')?.toLowerCase().split(/\s+/).includes('canonical'),
  );
  const headings = all
    .filter((element) => /^h[1-6]$/.test(element.tagName))
    .map((element) => ({
      level: Number(element.tagName.slice(1)),
      text: cleanText(textContent(element), 240),
    }));
  const scripts = all.filter((element) => element.tagName === 'script');
  const stylesheets = all.filter(
    (element) =>
      element.tagName === 'link'
      && attribute(element, 'rel')?.toLowerCase().split(/\s+/).includes('stylesheet'),
  );
  const links = all.filter((element) => element.tagName === 'a');
  const images = all.filter((element) => element.tagName === 'img');
  const navigationSignals = all.some((element) =>
    /\bmobile[-_ ]?(nav|menu)|nav[-_ ]?mobile|hamburger|menu[-_ ]?toggle\b/.test(
      semanticSignal(element),
    )
  );
  const viewport = all.some(
    (element) =>
      element.tagName === 'meta'
      && attribute(element, 'name')?.toLowerCase() === 'viewport',
  );
  const hasSrcset = images.some((element) => Boolean(attribute(element, 'srcset')));
  const hasSizes = images.some((element) => Boolean(attribute(element, 'sizes')));
  const hasPictureElements = all.some((element) => element.tagName === 'picture');
  const accessibilityConcerns: string[] = [];
  if (!htmlElement || !attribute(htmlElement, 'lang')) {
    accessibilityConcerns.push('HTML_LANGUAGE_MISSING');
  }
  if (!all.some((element) => element.tagName === 'main')) {
    accessibilityConcerns.push('MAIN_LANDMARK_MISSING');
  }
  if (!headings.some((heading) => heading.level === 1)) {
    accessibilityConcerns.push('H1_MISSING');
  }
  if (images.some((image) => attribute(image, 'alt') === null)) {
    accessibilityConcerns.push('IMAGE_ALT_MISSING');
  }
  const securityConcerns: string[] = [];
  if (scripts.some((script) => !attribute(script, 'src') && cleanText(textContent(script)))) {
    securityConcerns.push('INLINE_SCRIPT_REQUIRES_REVIEW');
  }
  if (scripts.length > 0) securityConcerns.push('SCRIPT_EXECUTION_PROHIBITED_DURING_ANALYSIS');

  return {
    title: titleElement ? cleanText(textContent(titleElement), 240) || null : null,
    metaDescription: metaDescription
      ? cleanText(attribute(metaDescription, 'content') || '', 500) || null
      : null,
    canonicalHref: canonical ? attribute(canonical, 'href') : null,
    language: htmlElement ? attribute(htmlElement, 'lang') : null,
    hasHeader: all.some((element) => element.tagName === 'header'),
    hasNavigation: all.some((element) => element.tagName === 'nav'),
    hasMain: all.some((element) => element.tagName === 'main'),
    hasFooter: all.some((element) => element.tagName === 'footer'),
    headings,
    hasBreadcrumbs: all.some((element) => /\bbreadcrumb\b/.test(semanticSignal(element))),
    formCount: all.filter((element) => element.tagName === 'form').length,
    linkCount: links.length,
    buttonCount: all.filter((element) => element.tagName === 'button').length,
    imageCount: images.length,
    sectionCount: candidates.length,
    hasStructuredData: scripts.some(
      (element) => attribute(element, 'type')?.toLowerCase() === 'application/ld+json',
    ),
    scriptReferences: scripts
      .map((element) => attribute(element, 'src'))
      .filter((value): value is string => Boolean(value))
      .slice(0, 100),
    stylesheetReferences: stylesheets
      .map((element) => attribute(element, 'href'))
      .filter((value): value is string => Boolean(value))
      .slice(0, 100),
    inlineStyleCount:
      all.filter((element) => attribute(element, 'style') !== null).length
      + all.filter((element) => element.tagName === 'style').length,
    internalLinks: links
      .map((element) => attribute(element, 'href'))
      .filter(
        (value): value is string =>
          Boolean(value)
          && (/^(?:\/|#|\.)/.test(value || '') || !/^[a-z]+:/i.test(value || '')),
      )
      .slice(0, 500),
    sections,
    bookingCtas,
    responsiveSignals: {
      ...EMPTY_TEMPLATE_RESPONSIVE_SIGNALS,
      hasViewportMeta: viewport,
      hasSrcset,
      hasSizes,
      hasPictureElements,
      hasResponsiveNavigation: navigationSignals,
      missingMobileNavigationSignal: !navigationSignals,
    },
    accessibilityConcerns,
    securityConcerns,
    textSignals: [
      titleElement ? cleanText(textContent(titleElement), 240) : '',
      ...headings.map((heading) => heading.text),
    ].filter(Boolean),
  };
}
