import {
  listSiteComponents,
  type SiteComponentImplementationOutcome,
} from '@ks-os/site-components';
import { generatedSectionContentSlots } from './response-schema.js';

export interface SiteComponentImplementationAuditEntry {
  componentKey: string;
  sectionType: string;
  outcome: SiteComponentImplementationOutcome;
  schemaBackedContentSlots: readonly string[];
  generatedJsonContentSlots: readonly string[];
  rendererMarkupKey: string;
  cssSelector: string;
  cssSelectorPresent: boolean;
  pageCompatibilityCount: number;
  mobileBehaviour: string;
  failures: readonly string[];
}

export function buildSiteComponentImplementationAudit(input: {
  designLibraryCss: string;
}) {
  const entries: SiteComponentImplementationAuditEntry[] = listSiteComponents().map(component => {
    const generatedJsonContentSlots = generatedSectionContentSlots(component.sectionType);
    const failures = [
      ...component.contentSlots.filter(slot => !generatedJsonContentSlots.includes(slot))
        .map(slot => `content slot ${slot} is absent from the generated JSON schema`),
      ...generatedJsonContentSlots.filter(slot => !component.contentSlots.includes(slot))
        .map(slot => `generated JSON field ${slot} is absent from the registry contract`),
      ...(!input.designLibraryCss.includes(component.cssSelector) ? ['CSS selector is absent'] : []),
      ...(!component.rendererMarkupKey.trim() ? ['renderer markup contract is absent'] : []),
      ...(!component.supportedPageTypes.length ? ['page compatibility is empty'] : []),
      ...(!component.mobileBehaviour.trim() ? ['mobile behaviour is empty'] : []),
    ];
    return {
      componentKey: component.componentKey,
      sectionType: component.sectionType,
      outcome: failures.length ? 'INVALID_REGISTRY_CAPABILITY' : component.implementationOutcome,
      schemaBackedContentSlots: component.contentSlots,
      generatedJsonContentSlots,
      rendererMarkupKey: component.rendererMarkupKey,
      cssSelector: component.cssSelector,
      cssSelectorPresent: input.designLibraryCss.includes(component.cssSelector),
      pageCompatibilityCount: component.supportedPageTypes.length,
      mobileBehaviour: component.mobileBehaviour,
      failures,
    };
  });
  return {
    schemaVersion: 1,
    registryVersion: 2,
    activeComponentCount: entries.length,
    fullyImplementedCount: entries.filter(entry => entry.outcome === 'FULLY_IMPLEMENTED').length,
    intentionalVisualVariantCount: entries.filter(entry => entry.outcome === 'INTENTIONAL_VISUAL_VARIANT').length,
    invalidRegistryCapabilityCount: entries.filter(entry => entry.outcome === 'INVALID_REGISTRY_CAPABILITY').length,
    entries,
  } as const;
}
