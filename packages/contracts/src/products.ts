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
