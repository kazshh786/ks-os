export type ServiceSelectionMode = 'SINGLE' | 'MULTIPLE' | 'CUSTOM';

export type ServiceSelectionRules = {
  serviceSelectionMode?: ServiceSelectionMode;
  exclusiveServiceIds?: string[];
};

export function normaliseSelectedServiceIds(serviceId: string, serviceIds?: readonly string[]): string[] {
  const ordered = serviceIds?.length ? [...serviceIds] : [serviceId];
  if (ordered[0] !== serviceId) ordered.unshift(serviceId);
  return [...new Set(ordered)].slice(0, 10);
}

export function assertServiceSelectionAllowed(
  rules: ServiceSelectionRules | null | undefined,
  serviceIds: readonly string[],
): void {
  if (!serviceIds.length || serviceIds.length > 10) {
    throw Object.assign(new Error('Choose between one and ten services.'), {
      code: 'INVALID_SERVICE_SELECTION',
      statusCode: 400,
    });
  }

  const mode = rules?.serviceSelectionMode || 'SINGLE';
  if (mode === 'SINGLE' && serviceIds.length > 1) {
    throw Object.assign(new Error('This booking page accepts one service per appointment.'), {
      code: 'MULTIPLE_SERVICES_DISABLED',
      statusCode: 409,
    });
  }

  if (mode === 'CUSTOM' && serviceIds.length > 1) {
    const exclusiveIds = new Set(rules?.exclusiveServiceIds || []);
    if (serviceIds.some(serviceId => exclusiveIds.has(serviceId))) {
      throw Object.assign(new Error('One of the selected services must be booked on its own.'), {
        code: 'SERVICE_COMBINATION_NOT_ALLOWED',
        statusCode: 409,
      });
    }
  }
}
