

# Financial OS: Absolute Truth Infrastructure

## Overview
Build the database foundation and verification UI for your Financial OS, implementing the Absolute Truth Protocol formula: **S = (R - P) - (O + V + D + A)**

---

## Phase 1: Database Infrastructure

### Table 1: AI Audit Log
Stores the raw receipt/document data before processing:
- Unique ID (uuid) and created_at timestamp
- **raw_json (JSONB)** - structured AI processing output
- image_url (text) - original document reference
- user_id for RLS privacy

### Table 2: Financial Ledger
The core transaction table implementing your V5.7 Logic:
- Transaction date and vendor_name
- **category** (R, P, O, V, D, A) - the Absolute Truth variables
- **pot_id** - Strategic Budget Buckets (P1, P2, O1, etc.)
- net_amount, vat_amount, gross_amount (numeric)
- **metadata (JSONB)** - enables multi-line item splits
- audit_id (foreign key → ai_audit_log)
- user_id for RLS privacy

### Computed View: Absolute Truth Calculator
A database view that calculates **S** in real-time:
- Sums net_amount grouped by category
- Returns R, P, O, V, D, A totals
- Computes S = (R - P) - (O + V + D + A)
- Respects RLS for user-specific calculations

### Security
- Row Level Security enabled on both tables
- Users can only read/write their own data

---

## Phase 2: Verification UI

### Verification Dashboard
A clean, data-focused interface to prove the pipeline:

1. **Category Summary Cards**
   - Six cards showing running totals for R, P, O, V, D, A
   - Color-coded for quick identification
   - Pulls from the computed view

2. **Absolute Truth Display**
   - Prominent display of the S calculation
   - Shows formula breakdown: (R - P) - (O + V + D + A)
   - Real-time updates from the database view

3. **Ledger Table**
   - All transactions with Date, Vendor, Category, Pot ID
   - Net, VAT, and Gross columns
   - **VAT Sentinel Indicator**: For Category R entries, flags any row where VAT ≠ Net ÷ 6 (highlights deviation from the 1/6th rule)
   - Sortable and filterable

4. **Upload Button**
   - Placeholder button for future Edge Function
   - Shows "Coming Soon" toast on click
   - Ready for receipt scanning integration

---

## Design Elements
- Clean, verification-focused layout
- Sentinel warnings in amber/orange for VAT deviations
- Category color scheme: R (green), P (red), O (blue), V (purple), D (orange), A (teal)
- Mobile-responsive for on-the-go verification

