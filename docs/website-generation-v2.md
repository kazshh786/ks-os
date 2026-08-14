# Website Generation V2

KS OS Website Generation V2 is a controlled composition system. It separates a
semantic section type from its deterministic renderer implementation and does
not allow the model to generate executable frontend code.

## Governed architecture

- 24 semantic section types remain the stable snapshot vocabulary.
- 123 active designed components (124 registered including one disabled test
  component) are discovered from the compile-time component registry.
- 16 page-purpose recipes define required content groups, meaningful depth,
  conversion intent and deliberate booking-page exemptions.
- 13 native layout manifests cover all 16 page types and expose page compatibility, required capabilities,
  renderer mappings and registry-compatible component keys.
- 42 controlled V2 design-token fields cover typography, layout, shape,
  surfaces, elevation, buttons, imagery and section rhythm.

Every generated section persists a `componentKey`. V1 snapshots without that
field retain deterministic semantic-type/variant fallback rendering. Unknown,
disabled, page-incompatible or manifest-incompatible component keys fail before
persistence or rendering.

The implementation audit classifies the 123 active keys as 23 canonical
`FULLY_IMPLEMENTED` semantic renderers and 100
`INTENTIONAL_VISUAL_VARIANT` presentations. `INVALID_REGISTRY_CAPABILITY`
must remain zero. `pnpm audit:site-generation-v2` emits the complete
machine-readable per-key audit, including schema slots, provider JSON fields,
renderer markup, CSS selector, page compatibility and mobile behaviour.

The component registry is application configuration, not tenant-authored code.
The additive migration seeds an immutable approved V2 template record and its
analysed layout capability records using existing template-intelligence tables.
It preserves the approved V1 template and the historical template-analysis
section vocabulary.

## Generation pipeline

1. Build a site-wide composition strategy from verified facts and the active
   controlled registry.
2. Build one page composition plan from a page-scoped component catalogue.
3. Validate the exact blueprint identity, layout capabilities, page recipe,
   component compatibility, bindings, asset references, internal links and
   meaningful depth.
4. Bind only approved tenant asset references. Missing required media becomes a
   private preview placeholder and a review finding.
5. Generate structured content for only the selected component contracts.
6. Validate schema, completeness and cross-page repetition before persisting a
   private snapshot.
7. Stop at `DESIGN_COMPLETE`, apply any governed native design selection, and
   require a full browser-backed quality run.
8. Promote to `READY_FOR_REVIEW` only after browser evidence exists and no
   non-human blocking findings remain. Evidence is complete only when every
   planned active page has successful 390, 768 and 1440 results, a clean page
   run and zero blocking findings; one or partial evidence rows cannot promote.
9. Require the existing human review and publication gates. Generation and
   quality never publish.

Full-site browser quality covers the existing secure preview at the configured
quality viewports. The V2 completeness evidence requires representative 390,
768 and 1440 pixel results, successful rendering, responsive layout, usable
navigation, visible native booking actions, media safety and accessibility
checks.

## Editing and invalidation

Site Studio exposes the page-compatible component catalogue, component
metadata, governed content fields, approved image choices, reordering,
duplication and removal. It does not expose arbitrary JSON or executable code.

Any persisted Site Studio change creates a new private snapshot, reopens the
review cycle and moves an existing `READY_FOR_REVIEW` generation back to
`DESIGN_COMPLETE`. Previous browser evidence is therefore never treated as
valid for changed content. A new full-site quality run is required before human
review can continue.

Design Library output uses the same registry version and real component keys.
Generated library items cannot introduce an unregistered component and still
require the existing approval workflow before client delivery.

## Publication boundary

V2 adds no publication shortcut. Reviewability remains distinct from
publication readiness, and public routing, domain attachment, publication
snapshots and publication pointers stay under the existing explicit human and
quality gates.

The V2 data migration must be validated and reviewed in the pull request. It
must not be applied automatically during implementation.

## Controlled release sequence

The production release is deliberately ordered. A generation request remains
blocked until both deployed code and migration-backed V2 template data are
ready.

A. Merge the reviewed PR; do not generate or publish.

B. Allow the existing automatic BOTH deployment to release the same commit to
Cloudflare and the VPS. Migration application remains disabled. The V2 API
readiness guard refuses generation throughout the gap between code deployment
and the migration-backed V2 template becoming complete.

C. Verify V1 production remains healthy. Confirm the deployed commit and the
API, site worker and public renderer without changing V1 data, routes or
publication state.

D. Manually review the migration plan and apply migration 69 once through the
normal runner. Its replay path verifies the owned public reference, both
approval states, exactly 13 approved layouts, 16 page-type mappings, 13 READY
versioned renderers, non-empty manifests and normalized sections before
returning.

E. Verify the persisted V2 template version, layout rows, normalized component
capabilities, page-type mappings and compiled renderer identities. Confirm V1
is untouched.

F. Verify API, site worker and public renderer health again and prove the real
KS OS provider path through server-side ADC without exposing credentials.

G. Inspect existing Luma generation records, then create a separate Luma V2
generation. Never overwrite, resume as V2 or otherwise mutate the audited V1
generation. V2 generation must finish at `DESIGN_COMPLETE`.

H. Run full-site quality and browser validation for every planned page at 390,
768 and 1440 with zero blocking findings. Only this evidence may promote V2 to
`READY_FOR_REVIEW`.

I. Create signed, noindex desktop and mobile previews for human review.

J. STOP for human approval. Do not publish, attach domains, change public
routing or create a publication snapshot.
