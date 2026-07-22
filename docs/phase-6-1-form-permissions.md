# Phase 6.1 form permissions

Tenant identity always comes from verified server auth. Owners manage all tenant templates, assignments and submissions. Staff list published templates only; they must supply an appointment that belongs to the selected tenant client and is assigned to the authenticated staff user. The same appointment-user predicate scopes assignment and submission lists/details.

Wrong-tenant and unknown resources use safe not-found responses. Directory endpoints omit answer JSON. Only authorised detail routes return answers, already rendered against version-snapshot labels/options.
