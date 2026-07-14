# Lean Salon Growth OS - Development Setup

This project is a highly scalable, multi-tenant Booking, POS, and CRM engine designed for salons.

---

## Windows Local Setup Instructions

Since Node.js, NPM, and Docker are not pre-installed in your environment, follow these steps to run and verify the codebase locally on your Windows machine:

### 1. Install Node.js & Git
1. Download and run the **[Node.js Windows Installer (LTS)](https://nodejs.org/en/)** (recommends `v20` or higher).
2. Download and install **[Git for Windows](https://gitforwindows.org/)** to manage commands and dependencies inside Git Bash / PowerShell.
3. Verify your installations inside your Command Prompt (`cmd`) or PowerShell:
   ```bash
   node -v
   npm -v
   git --version
   ```

### 2. Configure Environment Variables
Create a file named `.env.local` in the root of the project folder:
```bash
# Supabase Project Client Keys (Public API)
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key

# PostgreSQL direct database connection string (used by Drizzle ORM)
# Find this under Project Settings -> Database -> Connection Strings (URI) inside Supabase
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.your-project-id.supabase.co:6543/postgres

# Vercel API Domain Provisioning Keys (Staging & Production)
VERCEL_AUTH_TOKEN=your_vercel_api_token
VERCEL_PROJECT_ID=prj_vVxi53tF9BkyBeb7iYYiBdy6UW2B
VERCEL_TEAM_ID=team_KvtNAa8QG2pV8ZpwanQG6wkt

# Cloudflare API DNS Configuration Keys (Staging & Production)
CLOUDFLARE_API_TOKEN=your_cloudflare_dns_edit_token
CLOUDFLARE_ZONE_ID=your_cloudflare_domain_zone_id

# Phase 6 private booking service and real Stripe payments
KS_OS_SERVICE_TOKEN=generate-a-long-random-service-token
STRIPE_SECRET_KEY=sk_test_or_live_key
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_or_live_key
STRIPE_WEBHOOK_SECRET=whsec_from_the_stripe_endpoint
BOOKING_RATE_LIMIT_SALT=generate-another-random-secret-at-least-32-characters
```

### 3. Install Dependencies
Run the package installation script:
```bash
npm install
```

### 4. Push Database Schema to Supabase
We use Drizzle ORM to manage Postgres tables and relational boundaries. Since schema updates were created in `db/schema.ts`, push them directly to your live database using:
```bash
# 1. Generate TypeScript migrations
npm run db:generate

# 2. Push tables directly to Supabase
npm run db:push
```
*Note: Alternatively, apply the numbered SQL scripts in order in the Supabase SQL Editor. Phase 6 requires `module10_booking_service_api.sql` followed by `module11_booking_channels.sql`.*

Owners can configure separate **Visit the shop** and **Mobile appointment** hours from the Manage screen. Mobile hours are opt-in: the public booking journey only offers mobile appointments after at least one mobile schedule has been saved. Customer addresses are stored only with the KS OS appointment.

### 5. Launch the Local Server
Run the Next.js development server:
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** inside your browser.

---

## Testing & Verification Steps

To verify the real-time calendar syncing and the POS trigger decrements:

1. **Verify Real-time Sync**:
   * Open the weekly calendar view in one browser tab.
   * Open your Supabase Dashboard Table Editor in another.
   * Insert a mock row into the `appointments` table.
   * Observe the appointment card instantly appearing on the calendar in real-time.

2. **Verify POS Checkout & Stock Decrement**:
   * Open the POS checkout drawer component.
   * Search for a product (ensure product has `stock_quantity > 0` in the database).
   * Click **Pay Now** to process the mock checkout.
   * Check your `products` table in Supabase. The product's `stock_quantity` will have decremented by 1, and the corresponding appointment status will have updated to `COMPLETED` automatically via the database trigger.

---

## Professional Staging & Deployment Workflow

We utilize **Vercel Preview Deployments** to safely test and rehearse changes before merging to production.

### 1. Git Branch Structure
- **`staging` Branch**: Used as our rehearsal sandbox. Push code changes here to generate preview deployments.
- **`main` Branch**: Production branch. Merging staging into main triggers a live build routed to your custom domain (`app.kasimshah.com`).

### 2. Deployment Steps
1. **Push to Staging**:
   ```bash
   git checkout staging
   # Make changes and commit...
   git push origin staging
   ```
2. **Review Preview URL**: Vercel automatically generates a unique live staging URL (e.g., `ks-os-git-staging-xxx.vercel.app`).
3. **Merge to Production**: Once verified, open a Pull Request to merge `staging` into `main`, or merge directly:
   ```bash
   git checkout main
   git merge staging
   git push origin main
   ```

### 3. Database Isolation (Supabase)
To prevent staging tests from modifying live customer data, we recommend setting up a secondary staging database:
- Create a duplicate free Supabase project named `KS OS - Staging`.
- In Vercel Project Settings, map the environment variables (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) for **Preview** environments to target the staging database credentials, while keeping **Production** variables pointing to the live database.
