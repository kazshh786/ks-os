# Google Reviews integration

## Manual review-link setup

In **Reputation → Connections & policy**, choose a location (or the explicit tenant-wide fallback), enter the verified Business Profile display name, and paste the review-request URL obtained by the owner from Google Business Profile. KS OS does not scrape Maps/Search and does not treat the URL as proof of ownership.

Accepted links are HTTPS, credential-free, at most 2,048 characters, and restricted to supported `g.page`, `search.google.com/local/writereview`, or `maps.app.goo.gl` forms. “Test link” performs a short, bounded server-side check and never accepts a user-selected host.

The UI label is **Google review link configured**, not “Business Profile connected”.

## Optional OAuth

Configure server-only values:

```text
GOOGLE_BUSINESS_PROFILE_CLIENT_ID
GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET
GOOGLE_BUSINESS_PROFILE_REDIRECT_URI
INTEGRATION_ENCRYPTION_KEY
```

The redirect URI targets `/api/v1/reputation/connections/google/oauth/callback`. OAuth uses the current `https://www.googleapis.com/auth/business.manage` scope. State is random, hash-only, single-use, bound to tenant/user, and expires after ten minutes. Token exchange occurs server-side and the AES-256-GCM credential envelope is never returned to the browser.

After connection, list accessible accounts/locations and map each KS OS location. The mapping includes the provider account/location identifiers and a Google-provided review URL. Review sync reads the official provider API in background jobs; normal dashboard reads use `external_reviews`.

Google’s official API exposes paginated review listing plus create/update and delete reply operations for verified locations. KS OS preserves provider timestamps and never permits edits to imported review/rating data.

Official references: [Google OAuth implementation](https://developers.google.com/my-business/content/implement-oauth), [Business Profile basic setup and approval](https://developers.google.com/my-business/content/basic-setup), [reviews list](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list), and [reply update](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/updateReply).

## Limitations

Google Business Profile API access requires project approval and has no sandbox. OAuth availability in the UI does not guarantee account/location access. Manual review links remain usable when OAuth is unavailable. Provider errors are mapped to safe KS OS codes and never replaced with sample data.

