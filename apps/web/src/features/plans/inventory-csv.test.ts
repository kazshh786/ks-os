import { describe, expect, it } from 'vitest';
import { parseInventoryCsv } from './inventory-csv.js';

describe('parseInventoryCsv', () => {
  it('parses pounds, quoted product names and stock quantities', () => {
    const result = parseInventoryCsv('name,sku,price,stock_quantity\n"Shampoo, large",shp-1,12.50,8\n');
    expect(result.errors).toEqual([]);
    expect(result.products).toEqual([{ name: 'Shampoo, large', sku: 'SHP-1', priceInCents: 1250, stockQuantity: 8 }]);
  });

  it('accepts price_in_cents and reports duplicate SKUs', () => {
    const result = parseInventoryCsv('product_name,product_sku,price_in_cents,opening_stock\nSerum,S-1,2500,3\nOil,s-1,1800,2\n');
    expect(result.products).toHaveLength(1);
    expect(result.errors).toContain('Row 3: SKU S-1 appears more than once in this file.');
  });

  it('reports missing required columns and invalid values', () => {
    expect(parseInventoryCsv('name,sku\nSerum,S-1\n').errors[0]).toMatch(/Missing required columns: price, stock_quantity/);
    const invalid = parseInventoryCsv('name,sku,price,stock_quantity\nSerum,S 1,-2,1.5\n');
    expect(invalid.errors).toEqual(expect.arrayContaining([
      'Row 2: SKU contains unsupported characters.',
      'Row 2: price must be zero or a positive number.',
      'Row 2: stock_quantity must be a whole number of zero or more.',
    ]));
  });
});
