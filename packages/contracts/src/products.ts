import { z } from 'zod';

export const ProductListQuerySchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  inStockOnly: z.coerce.boolean().default(false),
});
export type ProductListQuery = z.infer<typeof ProductListQuerySchema>;

export const ProductSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  sku: z.string(),
  priceInCents: z.number().int(),
  stockQuantity: z.number().int(),
});
export type Product = z.infer<typeof ProductSchema>;

const ProductInputFields = {
  name: z.string().trim().min(1, 'Product name is required.').max(255),
  sku: z.string().trim().min(1, 'SKU is required.').max(100).regex(/^[A-Za-z0-9._/-]+$/, 'Use letters, numbers, dots, slashes, underscores or hyphens.'),
  priceInCents: z.number().int().min(0).max(100_000_000),
  stockQuantity: z.number().int().min(0).max(10_000_000),
};

export const CreateProductRequestSchema = z.object(ProductInputFields);
export type CreateProductRequest = z.infer<typeof CreateProductRequestSchema>;

export const UpdateProductRequestSchema = z.object(ProductInputFields).partial().refine(
  value => Object.keys(value).length > 0,
  { message: 'Provide at least one product field to update.' },
);
export type UpdateProductRequest = z.infer<typeof UpdateProductRequestSchema>;

export const AdjustProductStockRequestSchema = z.object({
  adjustment: z.number().int().min(-10_000_000).max(10_000_000).refine(value => value !== 0, 'Stock adjustment cannot be zero.'),
  reason: z.string().trim().max(255).optional(),
});
export type AdjustProductStockRequest = z.infer<typeof AdjustProductStockRequestSchema>;

export const ImportProductsRequestSchema = z.object({
  products: z.array(CreateProductRequestSchema).min(1).max(500),
});
export type ImportProductsRequest = z.infer<typeof ImportProductsRequestSchema>;

export const ProductImportResultSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  products: z.array(ProductSchema),
});
export type ProductImportResult = z.infer<typeof ProductImportResultSchema>;

export const ProductListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(ProductSchema),
  nextCursor: z.string().optional(),
});
export type ProductListResponse = z.infer<typeof ProductListResponseSchema>;

export const SingleProductResponseSchema = z.object({
  success: z.literal(true),
  data: ProductSchema,
});
export type SingleProductResponse = z.infer<typeof SingleProductResponseSchema>;
