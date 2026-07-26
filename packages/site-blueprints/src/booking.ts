import type {
  BlueprintBookingRequirement,
  BlueprintPageInput,
  SitePageType,
} from '@ks-os/contracts';

const GLOBAL_BOOKING_PLACEMENTS = [
  'HEADER',
  'HERO',
  'MOBILE_NAVIGATION',
  'PAGE_END',
  'FOOTER',
] as const;

export function bookingRequirementsForPage(input: {
  pageType: SitePageType;
  serviceReference?: string;
  locationReference?: string;
  staffReference?: string;
}): BlueprintBookingRequirement[] {
  const action = {
    type: 'KS_OS_BOOKING' as const,
    label: 'Book now',
    ...(input.serviceReference
      ? { serviceReference: input.serviceReference }
      : {}),
    ...(input.locationReference
      ? { locationReference: input.locationReference }
      : {}),
    ...(input.staffReference ? { staffReference: input.staffReference } : {}),
  };
  const placements = input.pageType === 'HOME'
    ? GLOBAL_BOOKING_PLACEMENTS
    : input.pageType === 'SERVICE_DETAIL'
      ? ['SERVICE_CARD', 'PAGE_END'] as const
      : ['PAGE_END'] as const;
  return placements.map((placement) => ({ placement, action }));
}

export function pageHasNativeBookingAction(
  page: Pick<BlueprintPageInput, 'bookingRequirements'>,
) {
  return page.bookingRequirements.some(
    (requirement) => requirement.action.type === 'KS_OS_BOOKING',
  );
}
