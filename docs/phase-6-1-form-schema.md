# Phase 6.1 form schema

`packages/contracts/src/forms.ts` is canonical. It uses a strict discriminated union for `SHORT_TEXT`, `LONG_TEXT`, `EMAIL`, `PHONE`, `DATE`, `YES_NO`, `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `SELECT`, `CONSENT_CHECKBOX`, and `INFORMATION`. Stable UUID field/option IDs are authoritative; labels are display snapshots only.

Unknown properties/types, duplicate IDs, executable markup, empty forms, excessive fields/options and excessive text are rejected. Choice answers store option IDs. Publication additionally requires salon-authored acknowledgement wording. KS OS does not generate legal or medical wording.
