# Review-only association templates

These files are intentionally outside the served web directory and are not deployable configuration. Replace every marked value with the approved native application's actual identifier/signing information; never publish placeholders. Limit the native URL handler to HTTPS on the approved MOBILE_LINK_ORIGIN and `/open` path. Configure the authentication callback separately using its exact provider-approved path.

After separate approval, serve JSON without redirects from `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` on that domain. iOS needs the associated-domain entitlement; Android needs a BROWSABLE/DEFAULT VIEW intent filter with autoVerify and the approved host/path. Verify both installed-app routing and web fallback on signed physical builds. A verified association chooses the app; the authenticated KSOS resolver still grants access.

See [Phase 8 developer guide](../../docs/communications-phase-8-mobile.md) and its official Apple/Android references. This change configures no production domain, app signing, store listing or callback.
