# Review-gating prevention

KS OS does not ask for an internal rating before revealing provider links. It has no proprietary rating table, public review profile, approval queue, testimonial publication flow, sentiment score, “happy customer” flag, or staff send-to-customer action.

Technical prevention measures:

- invitation creation starts only from the durable `APPOINTMENT_COMPLETED` event;
- recipient selection is automatic and governed by one active rule per location scope;
- eligibility has no refund, complaint, rating, predicted sentiment or payment outcome input;
- database uniqueness prevents repeated/manual targeting of the same appointment;
- `BOTH` expands to a fixed Google + Trustpilot provider list rendered with identical button styling;
- private contact is independent of provider visibility;
- template schemas reject common five-star, positive-only and incentive wording;
- public click input accepts only `GOOGLE` or `TRUSTPILOT`, then resolves a server-stored URL;
- click responses explicitly return `reviewSubmitted: false`;
- imported provider ratings/text are read-only.

Operational exclusions must be neutral and consistently applied (for example, a test record or a legal/safety prohibition). Negative experience, complaint, refund or dispute is not a permitted exclusion reason merely because the customer may leave a negative review.

The prohibited design remains: internal satisfaction question → positive customers to a public provider → others to private feedback. Any future product work must preserve these invariants.

