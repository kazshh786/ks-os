import type { Service } from '../../data/types.js';

export type ServiceCategoryGroup = {
  key: string;
  label: string;
  services: Service[];
};

export function categoryKey(category: string): string {
  return (category.trim() || 'General').toLocaleLowerCase();
}

export function categoryLabel(category: string): string {
  return category.trim() || 'General';
}

export function groupServicesByCategory(services: Service[]): ServiceCategoryGroup[] {
  const groups = new Map<string, ServiceCategoryGroup>();

  for (const service of services) {
    const key = categoryKey(service.category);
    const existing = groups.get(key);
    if (existing) {
      existing.services.push(service);
      continue;
    }

    groups.set(key, {
      key,
      label: categoryLabel(service.category),
      services: [service],
    });
  }

  return [...groups.values()];
}

export function flattenServiceCategories(groups: ServiceCategoryGroup[]): Service[] {
  return groups.flatMap(group => group.services);
}

export function regroupServices(services: Service[]): Service[] {
  return flattenServiceCategories(groupServicesByCategory(services));
}

export function moveServiceCategory(
  services: Service[],
  key: string,
  direction: -1 | 1,
): Service[] {
  const groups = groupServicesByCategory(services);
  const currentIndex = groups.findIndex(group => group.key === key);
  const nextIndex = currentIndex + direction;

  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= groups.length) {
    return services;
  }

  const nextGroups = [...groups];
  const [movedGroup] = nextGroups.splice(currentIndex, 1);
  nextGroups.splice(nextIndex, 0, movedGroup);
  return flattenServiceCategories(nextGroups);
}

export function moveServiceWithinCategory(
  services: Service[],
  serviceId: string,
  direction: -1 | 1,
): Service[] {
  const groups = groupServicesByCategory(services);
  const groupIndex = groups.findIndex(group => group.services.some(service => service.id === serviceId));
  if (groupIndex < 0) return services;

  const group = groups[groupIndex];
  const currentIndex = group.services.findIndex(service => service.id === serviceId);
  const nextIndex = currentIndex + direction;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= group.services.length) {
    return services;
  }

  const nextServices = [...group.services];
  const [movedService] = nextServices.splice(currentIndex, 1);
  nextServices.splice(nextIndex, 0, movedService);

  const nextGroups = [...groups];
  nextGroups[groupIndex] = { ...group, services: nextServices };
  return flattenServiceCategories(nextGroups);
}
