# Phase 6.1 form versioning

`forms` stores the editable working draft. Publishing locks the parent row, validates the complete definition, calculates the next version number, inserts a full `form_versions` snapshot, and marks the parent published in one transaction. A database trigger rejects updates/deletes of version rows.

Editing a published parent returns it to `DRAFT`; existing versions and assignments are unchanged. Every assignment and submission references its exact immutable version. Legacy submissions remain intact and are not reinterpreted using new drafts.
