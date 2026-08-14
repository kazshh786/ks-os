import {
  LiveConditionFactSchema,
  LiveConditionKeySchema,
  LiveConditionRuleV1Schema,
  type LiveConditionFact,
  type LiveConditionKey,
  type LiveConditionRuleV1,
} from '@ks-os/contracts';
import type { PublicLiveSiteData } from './contracts.js';

export {
  LiveConditionFactSchema,
  LiveConditionKeySchema,
  LiveConditionRuleV1Schema,
};
export type { LiveConditionFact, LiveConditionKey, LiveConditionRuleV1 };

export type LiveFactState = 'TRUE' | 'FALSE' | 'UNKNOWN';

function matchReference<T extends { publicReference: string }>(items: readonly T[], reference?: string) {
  if (reference) return items.find(item => item.publicReference === reference);
  return items.length === 1 ? items[0] : undefined;
}

export function evaluateLiveFact(factValue: LiveConditionFact, live?: PublicLiveSiteData): LiveFactState {
  const fact = LiveConditionFactSchema.parse(factValue);
  if (!live || live.telemetry.fallbackActivated) return 'UNKNOWN';
  if (fact.key === 'SERVICE_EXISTS' || fact.key === 'SERVICE_BOOKABLE' || fact.key === 'WAITLIST_AVAILABLE') {
    const service = matchReference(live.services, fact.subjectReference);
    if (!service) return 'UNKNOWN';
    if (fact.key === 'SERVICE_EXISTS') return service.exists ? 'TRUE' : 'FALSE';
    if (fact.key === 'SERVICE_BOOKABLE') return service.bookingEligible ? 'TRUE' : 'FALSE';
    return service.waitlistEligible ? 'TRUE' : 'FALSE';
  }
  if (fact.key === 'STAFF_ACTIVE' || fact.key === 'STAFF_BOOKABLE') {
    const staff = matchReference(live.staff, fact.subjectReference);
    if (!staff) return 'UNKNOWN';
    return (fact.key === 'STAFF_ACTIVE' ? staff.active : staff.bookingEligible) ? 'TRUE' : 'FALSE';
  }
  if (fact.key === 'LOCATION_ACTIVE' || fact.key === 'LOCATION_OPEN') {
    const location = matchReference(live.locations, fact.subjectReference);
    if (!location) return 'UNKNOWN';
    return (fact.key === 'LOCATION_ACTIVE' ? location.active : location.opening.state === 'OPEN') ? 'TRUE' : 'FALSE';
  }
  if (fact.key === 'CAMPAIGN_ACTIVE') {
    const campaign = matchReference(live.campaigns, fact.subjectReference);
    return campaign ? (campaign.active ? 'TRUE' : 'FALSE') : 'FALSE';
  }
  if (fact.key === 'AVAILABILITY_KNOWN' || fact.key === 'APPOINTMENTS_AVAILABLE') {
    const summary = fact.subjectReference
      ? live.availability.find(item => item.serviceReference === fact.subjectReference)
      : live.availability.length === 1 ? live.availability[0] : undefined;
    if (!summary || summary.state === 'UNKNOWN') return 'UNKNOWN';
    if (fact.key === 'AVAILABILITY_KNOWN') return 'TRUE';
    return ['NEXT_AVAILABLE', 'AVAILABLE_THIS_WEEK'].includes(summary.state) ? 'TRUE' : 'FALSE';
  }
  return 'UNKNOWN';
}

export function evaluateLiveRule(ruleValue: LiveConditionRuleV1, live?: PublicLiveSiteData) {
  const rule = LiveConditionRuleV1Schema.parse(ruleValue);
  const evaluate = (facts: LiveConditionFact[]) => facts.map(fact => ({ fact, state: evaluateLiveFact(fact, live) }));
  const all = evaluate(rule.all);
  const any = evaluate(rule.any);
  const none = evaluate(rule.none);
  const unknown = [...all, ...any, ...none].filter(item => item.state === 'UNKNOWN');
  const definitiveFalse = all.some(item => item.state === 'FALSE')
    || (any.length > 0 && any.every(item => item.state === 'FALSE'))
    || none.some(item => item.state === 'TRUE');
  const matches = all.every(item => item.state === 'TRUE')
    && (!any.length || any.some(item => item.state === 'TRUE'))
    && none.every(item => item.state === 'FALSE');
  return {
    matches,
    definitiveFalse,
    indeterminate: !definitiveFalse && !matches && unknown.length > 0,
    facts: [...all, ...any, ...none],
  } as const;
}
