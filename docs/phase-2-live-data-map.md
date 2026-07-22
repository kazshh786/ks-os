# Phase 2 Live Data Map

This document tracks the progression of features transitioned from static mock data to live Drizzle/Postgres database interactions.

## Currently Live (Phase 4.1)
- **Client Directory (`/app/clients`)**: Fully live. Implements offset pagination, Drizzle search, and tenant-scoping.
- **Client Profile (`/app/clients/:id`)**: Fully live. Loads client profiles securely and queries the `appointments` table for booking history metrics.
- **Availability & Bookings**: Transitioned in Phase 3. Live availability calculations and booking mutation pipelines.
- **Service & Staff Catalogs**: Live queries for public booking and reception desks.

## Still Mocked (To be transitioned)
- POS Checkout Transactions
- Loyalty & Wallet calculations
- Marketing/Automation rules
- Analytics Dashboards
