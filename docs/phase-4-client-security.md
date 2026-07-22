# Phase 4.1 Client CRM Security Document

## Tenant Isolation
Tenant isolation is enforced strictly at the database query level within the API layer. Every single database query executed for the Client CRM includes an explicit `tenantId` condition matching the authenticated user's session:
```typescript
eq(clients.tenantId, request.auth!.tenantId)
```
This guarantees that clients from one tenant cannot be loaded, searched, or viewed by users of another tenant. When requesting a client profile by ID, both the ID and the `tenantId` are queried simultaneously. An unknown client ID or a client ID belonging to another tenant results in the exact same generic `404 Not Found` response, preventing enumeration attacks.

## Medical-Note Access Controls
Medical notes often contain sensitive Protected Health Information (PHI). In Phase 4.1, access to this data is governed by Role-Based Access Control (RBAC):
- **Owners (`role === 'owner'`):** Have unrestricted view access to all client medical notes within their tenant.
- **Staff/Other roles:** The `medicalNotes` property is actively stripped from the API response and replaced with `null` at the server level. The frontend never receives the data.

## Protection of PII
Personally Identifiable Information (PII) such as emails, phone numbers, and addresses must be protected from logging and unintentional exposure:
- **Redaction:** Fastify's logger has been configured to redact sensitive payload data including `req.body.client.name`, `req.body.client.email`, `req.body.client.phone`, `*.email`, `*.phone`, and `*.medicalNotes`. 
- **Response Payloads:** Response bodies (`res.body`) are also redacted from logs to prevent PII from leaking into external logging services.
- **Safe Exposure:** Internal appointment notes and mobile addresses are intentionally excluded from the generic `bookingHistory` array to limit exposure of sensitive operational data.
