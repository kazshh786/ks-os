# Agency template import library

## Purpose

The Agency Portal route `/agency/templates` lets authorised operators upload an Envato HTML template package and organise it through the existing template-intelligence lifecycle.

The first release covers private intake, deterministic inspection and agency review. It does not execute template scripts, publish raw template code or automatically convert the source into KS OS renderers.

## Permissions

- `sites.templates.read` — open the library and analysis detail.
- `sites.templates.manage` — initiate imports and upload source assets.
- `sites.templates.approve` — approve analysed template versions through the existing template-intelligence API.
- `sites.templates.licenses.manage` — assign an Envato licence to a client site through the existing site-scoped licence API.

## Private storage

The API uses the bucket configured by:

```env
TEMPLATE_IMPORT_STORAGE_BUCKET=private-template-imports
```

On the first import, the server-only Supabase admin client creates the bucket as private when it does not already exist. Browser clients receive a short-lived signed upload URL for each declared asset. The API never returns a storage path, archive body, licence document or provider credential through the template library.

Accepted assets:

- required source ZIP;
- optional Envato licence evidence as PDF or plain text; and
- optional preview image as JPG, PNG or WebP.

The source ZIP is limited to 100 MB by the application. The Supabase project-wide Storage upload limit must also allow the selected package size.

## Import lifecycle

1. The browser hashes each selected file with SHA-256.
2. The API creates an `ENVATO_HTML` template source and a draft template version.
3. The API issues private signed upload URLs.
4. The browser transfers the files directly to Supabase Storage.
5. The completion endpoint downloads the assets with the service credential and verifies size, digest and file signature.
6. The ZIP directory is inspected without executing source code.
7. HTML and CSS files within the bounded inspection limit are decompressed in memory and passed to `@ks-os/template-intelligence`.
8. The existing analysis service persists files, layouts, sections and findings.
9. The Agency Portal shows `REVIEW_REQUIRED`, `READY_FOR_APPROVAL` or `FAILED` with safe counts and summaries.
10. Approval remains a separate privileged decision.

## ZIP safety boundary

The importer rejects:

- invalid ZIP signatures and directory structures;
- multi-disk and ZIP64 packages;
- encrypted entries;
- absolute paths, parent traversal and null bytes;
- symbolic links;
- more than 2,000 files;
- more than 250 MB of declared extracted content;
- files larger than 20 MB; and
- malformed or truncated local entries.

Only HTML and CSS files up to 2 MB each are decompressed for semantic inspection. JavaScript, PHP, shell files, binaries and build tools are inventoried but never executed. Unsupported or uninspectable source becomes an explicit finding rather than being silently trusted.

## Deployment

This feature changes the frontend and Fastify API but does not add a database migration.

After merge:

1. Vercel deploys the Agency Portal frontend.
2. Deploy the VPS API from `main`.
3. Set `TEMPLATE_IMPORT_STORAGE_BUCKET` only when a bucket name other than `private-template-imports` is required.
4. Confirm the Supabase project-wide Storage upload limit is suitable for the Envato packages being imported.
