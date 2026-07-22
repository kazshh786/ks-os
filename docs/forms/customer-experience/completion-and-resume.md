# Customer completion, resume, consent and review

Assignment links are unguessable bearer credentials and must be shared only with their intended customer. They expire and can be revoked/regenerated. Autosave sends structured answers, page, language, time zone and revision to the API; it never stores sensitive answers in `localStorage`. A resume token is shown/emailed only through an approved workflow, stored hash-only, expires with the assignment and is revoked on submission.

Browser validation provides immediate feedback, while the API repeats schema, type, option, logic, required and calculation checks. Errors are associated with fields and focus/scroll moves toward the first invalid field. Hidden answers are excluded or cleared according to rule configuration.

Typed signature is the accessible signature baseline and records signer name, timestamp, user-agent/IP evidence through the submission/audit boundary. It does not assert legal enforceability. Drawn signatures require an accessible typed alternative. Consent must be explicit, purpose-specific, versioned and separate from optional marketing consent; withdrawal instructions and legal wording require review.

Uploads must use a private Supabase bucket, allow only JPEG, PNG and PDF, enforce 10 MiB/file and five files/field, use generated storage paths, validate magic bytes server-side, scan before download, strip image metadata where appropriate, and return signed URLs only after tenant/assignment authorisation. Executables and browser-supplied MIME alone are never accepted. The schema and metadata hook exist; bucket provisioning/scanner activation remain infrastructure tasks.

Analytics records only event type, page/field key, device class, source/campaign, language and duration. Answer values, names, contact details, signatures and file names are prohibited. Retention and privacy requests must include drafts, structured answers and files and respect legal holds.

Troubleshooting codes: `FORM_DRAFT_CONFLICT` means a newer device/session saved; `FORM_RESUME_INVALID` means expired/revoked token; `FORM_REQUIRED_ANSWER_MISSING` means a visible required answer is absent; `FORM_LOGIC_CYCLE` requires builder rule repair.
