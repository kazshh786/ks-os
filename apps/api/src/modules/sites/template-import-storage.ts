import { getSupabaseAdmin } from '../../lib/supabase-admin.js';

const DEFAULT_BUCKET = 'private-template-imports';
const allowedMimeTypes = [
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  'application/pdf',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

let bucketReady: Promise<void> | undefined;

export function templateImportBucket() {
  return process.env.TEMPLATE_IMPORT_STORAGE_BUCKET || DEFAULT_BUCKET;
}

export async function ensureTemplateImportBucket() {
  bucketReady ||= (async () => {
    const storage = getSupabaseAdmin().storage;
    const bucket = templateImportBucket();
    const existing = await storage.getBucket(bucket);
    if (existing.data) return;

    const created = await storage.createBucket(bucket, {
      public: false,
      allowedMimeTypes,
    });
    if (!created.error) return;

    // A concurrent API process may have created the bucket between the two calls.
    const confirmed = await storage.getBucket(bucket);
    if (!confirmed.data) {
      throw fail(
        503,
        'TEMPLATE_IMPORT_STORAGE_UNAVAILABLE',
        'Private template storage could not be prepared.',
      );
    }
  })().catch(error => {
    bucketReady = undefined;
    throw error;
  });
  return bucketReady;
}
