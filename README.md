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

# PostgreSQL direct database connection string (used by Drizzle ORM)
# Find this under Project Settings -> Database -> Connection Strings (URI) inside Supabase
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.your-project-id.supabase.co:6543/postgres
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
*Note: Alternatively, you can paste the SQL scripts (`moduleX_schema.sql` files) directly into your Supabase SQL Editor dashboard.*

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
