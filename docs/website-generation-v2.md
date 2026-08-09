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
- 13 native layout manifests expose page compatibility, required capabilities,
  renderer mappings and registry-compatible component keys.
- 42 controlled V2 design-token fields cover typography, layout, shape,
  surfaces, elevation, buttons, imagery and section rhythm.

Every generated section persists a `componentKey`. V1 snapshots without that
field retain deterministic semantic-type/variant fallback rendering. Unknown,
disabled, page-incompatible or manifest-incompatible component keys fail before
persistence or rendering.

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
   non-human blocking findings remain.
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
