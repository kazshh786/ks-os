# Creating and publishing forms

Start with a blank form and add fields from the left library by clicking or dragging. Select a canvas field to edit its stable key, help text, width, required state, classification and accessibility metadata. Stable keys are lowercase identifiers used by logic, mappings and exports and should not be renamed after integrations depend on them.

Choice fields require at least two options. Consent fields require explicit wording. Medical, consent and other sensitive fields should use the appropriate classification. Layout widths collapse on small screens. Theme values are constrained tokens rather than arbitrary CSS, protecting host isolation and accessibility.

Conditional rules use readable conditions and actions. Hidden fields are excluded from validation; rules may clear their old answer. Circular references block validation/publishing. Calculations accept numbers, field keys, parentheses, `+ - * /`, and `min`, `max`, `round`, `abs`; JavaScript and property access are rejected.

Save state is always visible. Autosave waits briefly after changes and uses the draft revision to prevent silent overwrites. Ctrl/Cmd+S saves; Ctrl/Cmd+Z undoes; Shift+Ctrl/Cmd+Z redoes. History is bounded. If a conflict is reported, reload and compare before reapplying changes.

Before publishing, confirm a public title, at least one input, reachable required fields, non-circular logic, consent wording, completion message, safe file limits and acceptable contrast. Publishing creates a new immutable version and does not move in-progress assignments to it.

Schema import/export must pass `FormSchemaJsonSchema`; executable content, scriptable URLs, unknown properties and unsupported field types are rejected. Cross-tenant copying requires an explicit owner-authorised workflow and is not implicit.
