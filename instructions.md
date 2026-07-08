# Integration Instructions: Lean Salon Growth OS

These instructions outline where to locate each file inside your Next.js application directory and how to connect the pieces.

---

## File Hierarchy

Ensure the files are placed as follows:

```
lean-salon-os/
├── db/
│   └── schema.ts                      <-- Update existing with appended models (Modules 1-5)
├── utils/
│   ├── useRealtimeAppointments.ts     <-- Create new realtime custom hook (Module 2)
│   └── supabase/
│       └── client.ts                  <-- Supabase client component builder
├── app/
│   ├── globals.css                    <-- Global styles
│   ├── layout.tsx                     <-- Root HTML layout
│   ├── page.tsx                       <-- Global landing page index
│   ├── admin/
│   │   ├── onboard/
│   │   │   └── page.tsx               <-- Admin onboarding dashboard route
│   │   └── login/
│   │       ├── page.tsx               <-- Admin login page route
│   │       └── login.module.css       <-- CSS module for login page
│   └── _tenants/
│       └── [subdomain]/
│           └── page.tsx               <-- Salon tenant dashboard workspace route
├── components/
│   ├── calendar/
│   │   ├── WeeklyCalendar.tsx         <-- Create new calendar UI grid (Module 2)
│   │   ├── WeeklyCalendar.module.css  <-- Create CSS module for calendar (Module 2)
│   │   ├── TimeSlotPicker.tsx         <-- Create public scheduler widget (Module 2)
│   │   └── TimeSlotPicker.module.css  <-- Create CSS module for widget (Module 2)
│   ├── crm/
│   │   ├── ClientTimeline.tsx         <-- Create client profile chronological timeline (Module 3)
│   │   └── ClientTimeline.module.css  <-- Create CSS module for timeline (Module 3)
│   ├── forms/
│   │   ├── FormRenderer.tsx           <-- Create dynamic form engine (Module 3)
│   │   └── FormRenderer.module.css    <-- Create CSS module for dynamic forms (Module 3)
│   ├── pos/
│   │   ├── CheckoutDrawer.tsx         <-- Create sliding checkout drawer UI (Module 4)
│   │   └── CheckoutDrawer.module.css  <-- Create CSS module for checkout panel (Module 4)
│   └── admin/
│       ├── OnboardingWizard.tsx       <-- Create multi-step agency onboarding dashboard (Module 6)
│       └── OnboardingWizard.module.css <-- Create CSS module for onboarding wizard (Module 6)
```

---

## Setup & Setup Execution (Module 5)

### Step 1: Run SQL Scripts in Supabase
1. Go to your **Supabase Dashboard**.
2. Navigate to **SQL Editor** -> **New Query**.
3. Copy the contents of `module5_loyalty.sql` and run it. This will:
   * Add loyalty toggle settings to `tenants`.
   * Add points tracking to `clients`.
   * Create `loyalty_ledger` table with RLS rules.
   * Update the PL/pgSQL function `public.decrement_stock_on_transaction()` to automatically credit points (e.g. 1 point per $1 spent) to the client's balance whenever a checkout succeeds (if `enable_loyalty` is active on their tenant).

### Step 2: Display Loyalty Points in Client Timeline & Checkout
The loyalty balance updates automatically at the database layer. You can display it:
1. In the **Client Timeline Header**: the component already reads the client's details. You can display `clientInfo.loyalty_points` on their card.
2. In the **Checkout Drawer**: display a notice like `"You are earning X loyalty points on this purchase!"` by displaying `(grandTotal / 100) * tenant.loyaltyPointsPerDollar` points.

---

## Custom Theme & White-labeling (CSS Variables)

To dynamically adjust colors to match each salon's brand color schema, configure the top-level parent wrapper of your components with the tenant's brand settings fetched from the database:

```html
<div style={{
  '--primary-color': tenant.primaryColor,
  '--secondary-color': tenant.secondaryColor,
  '--accent-color': tenant.accentColor,
} as React.CSSProperties}>
  <WeeklyCalendar tenantId={tenant.id} staffMembers={staff} services={services} />
</div>
```
This feeds the custom CSS variables directly into our CSS modules for seamless white-labeling!
