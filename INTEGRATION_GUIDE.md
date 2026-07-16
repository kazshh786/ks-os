# Kasim Shah LTD - Agency Engine Integration

## Architecture Overview

This is the unified platform for Kasim Shah LTD operations.

### Three Core User Roles

1. **Admin Dashboard** (`app/(admin)/`)
   - Agency control panel for managing salons
   - Previously: `agent` repository (Express control panel)
   - Now: Integrated Next.js routes

2. **Client Portal** (`app/(tenants)/[subdomain]/`)
   - Multi-tenant salon/client dashboard
   - Salon booking, POS, CRM
   - Per-client subdomain routing

3. **Core Platform** (`/`)
   - Lean Salon Growth OS (ks-os)
   - Multi-tenant database layer (Supabase)
   - Real-time calendar, POS, appointments, inventory

## Repository Merger

**Primary:** `ks-os` (The Brain)
- TypeScript + Next.js + Drizzle ORM + Supabase
- Multi-tenant booking, POS, CRM engine

**Integrated:** `agent` (Admin Control Plane)
- Express.js control panel server
- HTML/CSS portfolio interface
- Now routes via Next.js app/(admin)/ structure

## Environment Setup

No additional environment variables needed for the merge. Continue using:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
DATABASE_URL=...
VERCEL_AUTH_TOKEN=...
VERCEL_PROJECT_ID=...
VERCEL_TEAM_ID=...
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ZONE_ID=...
```

## Deployment

1. **Staging Branch**: `staging`
   - Push code changes → Vercel preview deployments
   - Test integrated admin + tenant + core system

2. **Production Branch**: `main`
   - Merge from staging → Live deployment
   - Routed to custom domain: `app.kasimshah.com`

## File Structure

```
ks-os/
├── app/
│   ├── (admin)/          # Agency Dashboard (from agent)
│   │   ├── control-panel/
│   │   └── [...routes]
│   ├── (tenants)/        # Client Portal
│   │   ├── [subdomain]/
│   │   └── [...routes]
│   ├── api/              # Backend routes
│   └── layout.tsx
├── db/
│   ├── schema.ts         # Drizzle ORM schema
│   └── migrations/
├── public/
├── components/
├── lib/
├── package.json          # Consolidated dependencies
├── .env.local            # Environment config
└── next.config.js
```

## Development

```bash
# Install dependencies
npm install

# Setup database
npm run db:generate
npm run db:push

# Start development server
npm run dev

# Open browser
# Admin: http://localhost:3000/admin
# Tenant: http://localhost:3000/[subdomain]
# Core: http://localhost:3000
```

## Integration Checklist

- [x] Branch created: `merge/integrate-admin-control-plane`
- [x] File structure reorganized
- [x] Dependencies consolidated
- [ ] PR created for review
- [ ] Preview deployment tested
- [ ] Merged to staging
- [ ] Production deployment

---

**Status:** Ready for PR review
