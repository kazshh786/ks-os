# Trustpilot integration

## Limited manual setup

An owner can configure a validated Trustpilot profile/evaluation URL per location or as an explicit tenant-wide fallback. Accepted HTTPS hosts are `trustpilot.com` and its provider-controlled subdomains, with review/evaluate paths. The connection is labelled **Trustpilot review link configured**, not an API connection.

KS OS does not guess or manufacture Trustpilot invitation URLs.

## API connection

Where the tenant has suitable Trustpilot access, the encrypted server-side connection stores:

- business unit ID and optional Trustpilot location ID;
- profile domain and locale;
- invitation template ID;
- API key, access token and optional refresh/author business-user identifiers inside an AES-256-GCM envelope.

The worker can call the official `POST /v1/private/business-units/{businessUnitId}/invitation-links` endpoint with only customer name/email, locale, optional provider location, and an opaque HMAC-derived reference. Treatment, forms, notes, payments and staff performance are never sent. The returned unique invitation ID and validated provider URL are recorded.

Available templates come from the official templates endpoint. Background public-review sync follows the provider's `nextPageToken`, upserts by provider review ID, and preserves Trustpilot verification level, replies, and validated original-review web links. Public replies use the official private review reply endpoint and require a configured business-user identity.

Official references: [Invitations API overview](https://developers.trustpilot.com/invitations-api-overview/), [Invitation API endpoints](https://developers.trustpilot.com/invitation-api), [Business Units reviews API](https://developers.trustpilot.com/business-units-api), and [Service review replies](https://developers.trustpilot.com/service-reviews-api/).

## Limitations and retention

Invitation, Insights/review and reply capabilities depend on the tenant’s Trustpilot product/API access and OAuth role. Failure is explicit; there is no live-to-mock fallback. Operators should also implement the provider’s deletions-feed retention process before enabling long-term Trustpilot review caching at scale.
