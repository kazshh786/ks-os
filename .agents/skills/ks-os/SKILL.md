---
name: ks-os-migration
description: Migrate KS OS from its current Next.js implementation and Vite redesign into a secure Vite + Fastify monorepo.
---

# KS OS Migration Skill

Always combine two sources of truth:
- current Next.js app for proven backend behaviour and security;
- Vite redesign for desired UX and workflow.

Prefer incremental vertical slices over horizontal rewrites. Preserve Supabase Auth, Postgres data, Drizzle models, tenant boundaries, booking rules, host validation, and rate limiting unless a documented replacement is approved.

Never ship localStorage-backed customer, booking, medical, consent, payment, tenant, or authentication data.
