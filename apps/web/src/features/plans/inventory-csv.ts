import type { CreateProductRequest } from '@ks-os/contracts';

export const inventoryCsvTemplate = 'name,sku,price,stock_quantity\nExample shampoo,SHP-001,12.50,8\n';

function parseRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(field.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  row.push(field.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

const normaliseHeader = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, '_');
const findHeader = (headers: string[], aliases: string[]) => aliases.map(alias => headers.indexOf(alias)).find(index => index >= 0) ?? -1;

export function parseInventoryCsv(source: string): { products: CreateProductRequest[]; errors: string[] } {
  const rows = parseRows(source.replace(/^\uFEFF/, ''));
  if (rows.length < 2) return { products: [], errors: ['The CSV must include a header row and at least one product.'] };

  const headers = rows[0].map(normaliseHeader);
  const nameIndex = findHeader(headers, ['name', 'product', 'product_name']);
  const skuIndex = findHeader(headers, ['sku', 'product_sku']);
  const poundsIndex = findHeader(headers, ['price', 'price_gbp', 'selling_price', 'retail_price']);
  const centsIndex = findHeader(headers, ['price_in_cents', 'price_cents']);
  const stockIndex = findHeader(headers, ['stock_quantity', 'stock', 'quantity', 'opening_stock']);
  const missing = [
    nameIndex < 0 ? 'name' : '',
    skuIndex < 0 ? 'sku' : '',
    poundsIndex < 0 && centsIndex < 0 ? 'price' : '',
    stockIndex < 0 ? 'stock_quantity' : '',
  ].filter(Boolean);
  if (missing.length) return { products: [], errors: [`Missing required column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`] };

  const products: CreateProductRequest[] = [];
  const errors: string[] = [];
  const seenSkus = new Set<string>();

  rows.slice(1).forEach((row, rowIndex) => {
    const line = rowIndex + 2;
    const name = String(row[nameIndex] || '').trim();
    const sku = String(row[skuIndex] || '').trim().toUpperCase();
    const priceRaw = String(row[centsIndex >= 0 ? centsIndex : poundsIndex] || '').trim().replace(/^£/, '');
    const stockRaw = String(row[stockIndex] || '').trim();
    const parsedPrice = priceRaw === '' ? Number.NaN : Number(priceRaw);
    const parsedStock = stockRaw === '' ? Number.NaN : Number(stockRaw);
    const priceInCents = centsIndex >= 0 ? parsedPrice : Math.round(parsedPrice * 100);

    if (!name) errors.push(`Row ${line}: product name is required.`);
    if (!sku) errors.push(`Row ${line}: SKU is required.`);
    else if (!/^[A-Za-z0-9._/-]+$/.test(sku)) errors.push(`Row ${line}: SKU contains unsupported characters.`);
    else if (seenSkus.has(sku)) errors.push(`Row ${line}: SKU ${sku} appears more than once in this file.`);
    if (!Number.isFinite(priceInCents) || !Number.isInteger(priceInCents) || priceInCents < 0) errors.push(`Row ${line}: price must be zero or a positive number.`);
    if (!Number.isInteger(parsedStock) || parsedStock < 0) errors.push(`Row ${line}: stock_quantity must be a whole number of zero or more.`);

    if (name && sku && /^[A-Za-z0-9._/-]+$/.test(sku) && !seenSkus.has(sku) && Number.isInteger(priceInCents) && priceInCents >= 0 && Number.isInteger(parsedStock) && parsedStock >= 0) {
      products.push({ name, sku, priceInCents, stockQuantity: parsedStock });
      seenSkus.add(sku);
    }
  });

  return { products, errors };
}
