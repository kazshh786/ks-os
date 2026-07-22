# Redesign System Inventory (KS-OS Redesign)

This document provides a detailed inventory of the React redesign in **KS-OS/ks-os**, representing the desired user experience, styling guidelines, layouts, components, and workflows.

## 1. Directory Structure and Files

```
KS-OS/ks-os/
├── src/
│   ├── assets/                       # UI assets and icons
│   ├── components/                   # Redesigned workspace views
│   │   ├── AgencyAdmin.tsx           # Agency dashboard & SaaS billing configuration
│   │   ├── BookingWizard.tsx         # Client public scheduling journey
│   │   ├── ClientCRM.tsx             # CRM client timeline, formulas & test details
│   │   ├── CompetitorFeatures.tsx    # Marketing comparative UI panels
│   │   ├── ConsentFormBuilder.tsx    # Digital intake questionnaires builder
│   │   ├── POSCheckout.tsx           # Product catalog POS checkouts & till drawer
│   │   ├── ReceptionDesk.tsx         # Diary scheduler, waitlist & status controls
│   │   ├── SaaSDashboard.tsx         # Main salon overview analytical KPIs dashboard
│   │   ├── SettingsManager.tsx       # Salon hours, white-labeling & colors manager
│   │   └── StaffCalendar.tsx         # Staff calendar grid (drag & drop, column layouts)
│   ├── App.tsx                       # Redesign core wrapper state & navigation
│   ├── index.css                     # Tailwind / custom global typography rules
│   ├── main.tsx                      # Vite React client bootstrap entry
│   ├── mockData.ts                   # In-memory LocalStorage engine & seeded constants
│   └── types.ts                      # Client-side TypeScript interface contracts
├── index.html
├── metadata.json
├── package.json                      # Build configs & frontend dependencies
├── tsconfig.json
└── vite.config.ts
```

---

## 2. Core Screens and Intended Workflows

### 1. SaaS Dashboard (`SaaSDashboard.tsx`)
- **Key Indicators**: Sparklines and cards for Gross Booking Value (GBV), occupancy utilization percentage, pending/completed schedule counts, and client roster size.
- **Financial Visualizer**: Custom SVG line chart plotting earnings and booking volumes across time scopes (Today, last 7 Days, last 30 Days).
- **Shortcut Hub**: Redirect shortcuts to Diary room, Desk walk-in, CRM Client files, and POS checkout.
- **System Insights**: AI-generated suggestions regarding stylist utilization and system safeguards.
- **Activity Log**: Event activity stream displaying real-time booking lifecycle records (e.g. Created, Checked out, Cancelled).

### 2. Staff Diary Calendar (`StaffCalendar.tsx` & `ReceptionDesk.tsx`)
- **Layouts**: Three display styles: Weekly calendar (days list), Staff columns (stylist schedules side-by-side), and Resource columns (physical rooms/chairs).
- **Controls**: Date selector dropdown, next/prev navigation, and today jump shortcut.
- **Booking Rules**: Toggle option to allow/disallow overbooking ("Permit Overbooking" warning banner).
- **Time Blocks**: Ability to click a slot or block out busy durations (e.g., lunch breaks).
- **Interactions**: Drag-and-drop to reschedule, drag-to-resize, and click-to-book form.
- **Waitlist Control**: Displays a waitlist matching panel to fill gaps in the schedule when slots become free.

### 3. Client CRM Directory (`ClientCRM.tsx`)
- **Search Panel**: Instant client database filtering matching name, phone, or email queries.
- **CRM Profiles**: Detailed profile cards showing:
  - **Financial Metrics**: Accumulated loyalty points, credit account wallet balance, gift card values, and lifetime spend values (LTV).
  - **Safety Indicators**: Allergies list and medical notes (e.g., Retinols, eczema).
  - **Styling Records**: Grade/Technical color formulas, patch test dates (via custom calendar widget), and patch test results (Pending, Positive, Negative).
  - **Packages**: Pre-bought treatment packages tracking remaining session counts.
  - **Visit Registry**: Historical chronological logs of client visits.

### 4. Till register (`POSCheckout.tsx`)
- **Double Column Layout**: Product and service catalogs on the left; active cart register on the right.
- **Cart Handling**: Adjust item quantity, apply tips (preset percentages or custom amounts), and view grand totals.
- **Adjustments**: Automatic deduction of online deposits if checked out from a booking.
- **Settlement Modes**: Split payments options allocating amounts between Cash and Card (with manual input controls).
- **Stock & Loyalty Execution**: Simulates stock decrement, credits loyalty points, and prints styled transaction success receipts.

### 5. Client Online Booking Wizard (`BookingWizard.tsx`)
- **Visual Design**: Customizable branding colors matching individual tenants.
- **Steps**:
  1. **Selection**: Choose a service category and staff member (or "Any Professional").
  2. **Diary**: Custom inline date picker and available time slots grouped by Morning, Afternoon, and Evening.
  3. **Contact details**: Name, email, phone, and optional mobile address input (Street, City, Postcode, access notes) if Mobile Visit is selected.
  4. **Payment Options**: Support for "Pay Online Deposit", "Pay Full Service Price", or "Pay Later at Salon" based on business settings, complete with card validation fields.
- **Success Screen**: Shows reservation summaries, reference IDs, and maps coordinates.

---

## 3. Visual Specifications and Design Language

- **Colors**: Slate backgrounds (`#0f172a`, `#1e293b`), indigo highlights (`#4f46e5`, `#6366f1`), and emerald success signals (`#10b981`). Uses dynamic brand coloring styles fetched from tenant tables.
- **Layouts**: Responsive flex headers, sticky lists, rounded action cards (`rounded-2xl`, `rounded-3xl`), bento grids, and slide-over drawers.
- **Transitions**: Smooth micro-animations for list sorting, hover states, status updates, and interactive modal displays.
- **Icons**: Lucide React iconography.
- **Typography**: Sans-serif Outfit/Inter font weights, large bold numbers for metrics, and monospaced indicators for IDs and invoices.
