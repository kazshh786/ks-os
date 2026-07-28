# Client fact-find and business intake UX

## Purpose

The client fact-find is the controlled intake used to gather the verified business facts needed for the KS OS booking workspace, website generation and provisioning workflow. It reuses the existing advanced intake-form renderer rather than maintaining a second form interface.

Raw answers never provision a workspace directly. Every usable fact still passes through agency review and only an approved, locked production brief becomes a provisioning input.

## Starting an intake

Agency users open **Client onboarding → Business intake and fact-find** and complete three guided choices:

1. Select a client business from the searchable client directory.
2. Select a versioned intake template. The default migration provides **KS OS complete client onboarding**.
3. Choose a completion method:
   - **Complete together now** — agency-assisted completion in person, by telephone or from existing records. No participant, email invitation or client account is required.
   - **Send secure link** — create a participant and queue the normal expiring client invitation.

The interface never asks an agency user to copy tenant, questionnaire or production-brief references.

## Shared form experience

Both completion methods use `FactFindingForm`, which adapts controlled fact-finding questions to the existing `FormRenderer`. This keeps labels, choice inputs and accessibility behaviour aligned with the booking intake-form platform.

The form is grouped into understandable pages:

- Business basics
- Locations
- Services
- Team
- Booking rules
- Brand and content
- Files and evidence

Specialised fields provide structured controls for GBP money values, UK addresses, weekly opening hours and repeatable service, location or team entries. Choice fields retain their controlled business values rather than renderer-specific option identifiers.

## Agency-assisted completion

An assisted questionnaire is created and prequalified without a participant. Each answer is written as `AGENCY_PROVIDED`, versioned and marked `AGENCY_REVIEW_REQUIRED`. Updating an answer clears any earlier approval and creates a new response version.

Private assisted uploads use signed storage URLs and the same byte-length, SHA-256 and actual-file-signature verification as client uploads. They default to no public or AI permission and remain pending until a separate agency asset review.

Submitting the assisted form validates all visible required questions, increments the questionnaire response version and moves the facts into the normal controlled review workflow.

## Client self-service completion

The invitation continues to use a revocable signed invitation exchanged for a short-lived opaque session. The client can save each page, close the browser and return from the same invitation while it remains valid.

The client now uses the shared structured renderer instead of JSON textareas. Clarification responses are entered inline rather than through browser prompts.

## Review and production brief

Agency review remains deliberately separate from data entry. Each fact can be approved, rejected or returned for clarification. The service clamps website, booking and generation permissions against the permissions defined by the original controlled question.

The production brief builder includes approved facts and approved assets only. Readiness blockers must be resolved before the brief can be approved and locked for provisioning.

## Default intake migration

`20260728030000_default_client_onboarding_fact_find.sql` seeds an active, idempotent `KS_OS_CLIENT_ONBOARDING` template. It contains the minimum structured facts needed to establish an initial booking-ready workspace and website brief, including:

- legal and trading identity
- public contact details
- location, address and opening hours
- first service, duration and GBP price
- first bookable staff member and availability
- booking notice, cancellation and confirmation rules
- brand tone and visual direction
- optional private logo, location and team assets

Additional services, locations and staff can be added through the canonical operational tools after the initial workspace is provisioned.

## Security and audit

- Browser database roles do not receive direct table access.
- Agency routes require existing fact-finding capabilities.
- Assisted actions are recorded in the agency audit ledger.
- Answers remain versioned and digest-backed.
- Upload storage paths are private and server-controlled.
- Executable answer content and mismatched uploaded files are rejected.
- No raw answers, bearer tokens or storage paths are placed in audit metadata.
