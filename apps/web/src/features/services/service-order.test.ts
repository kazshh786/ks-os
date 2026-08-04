import { describe, expect, it } from 'vitest';
import type { Service } from '../../data/types.js';
import {
  groupServicesByCategory,
  moveServiceCategory,
  moveServiceWithinCategory,
  regroupServices,
} from './service-order.js';

const service = (id: string, category: string): Service => ({
  id,
  name: id,
  description: `${id} description`,
  durationMin: 30,
  price: 20,
  category,
});

describe('category-aware service ordering', () => {
  it('groups matching categories in first-seen order', () => {
    const groups = groupServicesByCategory([
      service('hair-1', 'Hair'),
      service('nails-1', 'Nails'),
      service('hair-2', 'hair'),
    ]);

    expect(groups.map(group => group.label)).toEqual(['Hair', 'Nails']);
    expect(groups[0].services.map(item => item.id)).toEqual(['hair-1', 'hair-2']);
  });

  it('moves an entire category block', () => {
    const reordered = moveServiceCategory([
      service('hair-1', 'Hair'),
      service('hair-2', 'Hair'),
      service('nails-1', 'Nails'),
      service('nails-2', 'Nails'),
    ], 'nails', -1);

    expect(reordered.map(item => item.id)).toEqual([
      'nails-1',
      'nails-2',
      'hair-1',
      'hair-2',
    ]);
  });

  it('moves a service only within its category', () => {
    const reordered = moveServiceWithinCategory([
      service('hair-1', 'Hair'),
      service('hair-2', 'Hair'),
      service('nails-1', 'Nails'),
    ], 'hair-2', -1);

    expect(reordered.map(item => item.id)).toEqual([
      'hair-2',
      'hair-1',
      'nails-1',
    ]);
  });

  it('regroups non-contiguous services without changing category order', () => {
    const regrouped = regroupServices([
      service('hair-1', 'Hair'),
      service('nails-1', 'Nails'),
      service('hair-2', 'Hair'),
    ]);

    expect(regrouped.map(item => item.id)).toEqual([
      'hair-1',
      'hair-2',
      'nails-1',
    ]);
  });
});
