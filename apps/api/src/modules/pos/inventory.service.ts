import { and, eq, sql } from 'drizzle-orm';
import { getDatabase, products } from '@ks-os/database';
import type {
  AdjustProductStockRequest,
  CreateProductRequest,
  ImportProductsRequest,
  Product,
  ProductImportResult,
  UpdateProductRequest,
} from '@ks-os/contracts';
import { EntitlementService } from '../agency/agency.service.js';

const inventoryError = (code: string, message: string) => {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
};

const productView = (product: typeof products.$inferSelect): Product => ({
  id: product.id,
  name: product.name,
  sku: product.sku,
  priceInCents: product.priceInCents,
  stockQuantity: product.stockQuantity,
});

const normaliseInput = <T extends Partial<CreateProductRequest>>(input: T): T => ({
  ...input,
  ...(input.name !== undefined ? { name: input.name.trim() } : {}),
  ...(input.sku !== undefined ? { sku: input.sku.trim().toUpperCase() } : {}),
}) as T;

export class InventoryService {
  constructor(
    private readonly db = getDatabase(),
    private readonly entitlements = new EntitlementService(),
  ) {}

  private async assertAccess(tenantId: string) {
    await this.entitlements.assertBoolean(tenantId, 'inventory.enabled');
  }

  private async findBySku(tenantId: string, sku: string, tx: any = this.db) {
    const [product] = await tx.select().from(products).where(and(
      eq(products.tenantId, tenantId),
      eq(products.sku, sku),
    )).limit(1);
    return product as typeof products.$inferSelect | undefined;
  }

  async createProduct(tenantId: string, input: CreateProductRequest): Promise<Product> {
    await this.assertAccess(tenantId);
    const clean = normaliseInput(input);
    if (await this.findBySku(tenantId, clean.sku)) {
      throw inventoryError('PRODUCT_SKU_EXISTS', `A product with SKU ${clean.sku} already exists.`);
    }

    try {
      const [created] = await this.db.insert(products).values({ tenantId, ...clean }).returning();
      return productView(created);
    } catch (error: any) {
      if (error?.code === '23505') throw inventoryError('PRODUCT_SKU_EXISTS', `A product with SKU ${clean.sku} already exists.`);
      throw error;
    }
  }

  async updateProduct(tenantId: string, productId: string, input: UpdateProductRequest): Promise<Product> {
    await this.assertAccess(tenantId);
    const clean = normaliseInput(input);

    if (clean.sku) {
      const duplicate = await this.findBySku(tenantId, clean.sku);
      if (duplicate && duplicate.id !== productId) {
        throw inventoryError('PRODUCT_SKU_EXISTS', `A product with SKU ${clean.sku} already exists.`);
      }
    }

    try {
      const [updated] = await this.db.update(products).set({
        ...clean,
        updatedAt: sql`NOW()`,
      }).where(and(eq(products.id, productId), eq(products.tenantId, tenantId))).returning();
      if (!updated) throw inventoryError('PRODUCT_NOT_FOUND', 'Product not found.');
      return productView(updated);
    } catch (error: any) {
      if (error?.code === '23505') throw inventoryError('PRODUCT_SKU_EXISTS', `A product with SKU ${clean.sku} already exists.`);
      throw error;
    }
  }

  async adjustStock(tenantId: string, productId: string, input: AdjustProductStockRequest): Promise<Product> {
    await this.assertAccess(tenantId);
    const [updated] = await this.db.update(products).set({
      stockQuantity: sql`${products.stockQuantity} + ${input.adjustment}`,
      updatedAt: sql`NOW()`,
    }).where(and(
      eq(products.id, productId),
      eq(products.tenantId, tenantId),
      sql`${products.stockQuantity} + ${input.adjustment} >= 0`,
    )).returning();

    if (updated) return productView(updated);
    const [existing] = await this.db.select({ id: products.id }).from(products).where(and(
      eq(products.id, productId),
      eq(products.tenantId, tenantId),
    )).limit(1);
    if (!existing) throw inventoryError('PRODUCT_NOT_FOUND', 'Product not found.');
    throw inventoryError('INSUFFICIENT_STOCK', 'This adjustment would make the stock quantity negative.');
  }

  async importProducts(tenantId: string, input: ImportProductsRequest): Promise<ProductImportResult> {
    await this.assertAccess(tenantId);
    return this.db.transaction(async tx => {
      let created = 0;
      let updated = 0;
      const imported: Product[] = [];

      for (const rawProduct of input.products) {
        const clean = normaliseInput(rawProduct);
        const existing = await this.findBySku(tenantId, clean.sku, tx);
        if (existing) {
          const [saved] = await tx.update(products).set({
            name: clean.name,
            priceInCents: clean.priceInCents,
            stockQuantity: clean.stockQuantity,
            updatedAt: sql`NOW()`,
          }).where(eq(products.id, existing.id)).returning();
          imported.push(productView(saved));
          updated += 1;
        } else {
          try {
            const [saved] = await tx.insert(products).values({ tenantId, ...clean }).returning();
            imported.push(productView(saved));
            created += 1;
          } catch (error: any) {
            if (error?.code === '23505') {
              throw inventoryError('PRODUCT_SKU_EXISTS', `SKU ${clean.sku} is already used by another workspace.`);
            }
            throw error;
          }
        }
      }

      return { created, updated, products: imported };
    });
  }
}
