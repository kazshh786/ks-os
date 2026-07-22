# Advanced intake forms: architecture and UX

## Existing system and decisions

KS OS already had tenant-scoped forms, immutable published versions, booking/client assignments, hash-only public tokens, customer-portal access, email/SMS delivery, server validation, idempotent submissions, audit-aware operations, and structured staff review. The advanced platform extends those records additively; existing published schemas remain valid and active submissions stay pinned to their original version.

The builder uses a three-panel information architecture: searchable field library, central canvas, and contextual properties. The sticky header keeps name, save state, undo, redo, preview, save and publish visible. Dragging is optional: every field can be inserted by button and reordered with labelled keyboard-accessible controls. Inline labels and introductions update immediately.

The builder and customer journey render through the same `FormRenderer`. Desktop, tablet and mobile preview modes change the actual renderer viewport. The renderer owns semantics, descriptions, errors, required state, conditional visibility, translations and responsive layout, preventing preview drift.

Publishing validates schema v2 and creates an immutable snapshot of fields, theme, logic, validation and settings with a previous-version pointer. A database trigger prevents update/delete of published versions. Editing preserves the last published version for assignments and increments an optimistic draft revision; concurrent stale saves return `FORM_DRAFT_CONFLICT`.

## Customer journey

An assignment URL opens the exact published version. The customer sees business identity, progress, save status, page navigation and accessible errors. Answers survive backwards navigation. Autosave is debounced and revision-checked. The first save creates a separate hash-only resume token; no submission ID appears in the URL. Customers review their answers and explicit acknowledgement before the idempotent final submit.

Staff see answers in original field order, version and acknowledgement evidence. They can select specific answers, request changes with a reason, approve, reject or archive. Review state is tenant-scoped and records reviewer/time. Notification delivery for change requests should reuse the existing email/SMS outboxes in the next operational increment.

## Status

- Implemented: shared renderer, visual builder, inline editing, optional drag/drop, keyboard alternatives, undo/redo, autosave/conflicts, responsive live preview, schema v2, fields/options/layout/theme tokens, conditional logic, safe calculations, server validation, immutable versions, save/resume, review, structured answers, templates/data models, privacy-safe analytics events, private-upload metadata and security boundaries.
- Partial: page/section schema and rendering foundation, localisation fallback, file-upload UI placeholder, notification/review workflow, analytics dashboards, templates UI.
- Infrastructure required: private `form-uploads` Supabase bucket and malware-scanning webhook/worker.
- Stakeholder/legal decision: retention periods, medical-data reviewer roles, signature/consent wording, mapping approval, custom redirects, custom CSS, AI provider, reusable system templates.
