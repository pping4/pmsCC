# PMS System Overview — Ground-Truth Reference

> **Authoritative inventory of the PMS codebase.** Built from actual code inspection, not from stale plans.
> **Last verified:** 2026-04-21
> **Scope:** `C:\Users\pping\Desktop\pms\pms-next\`

> This file **replaces** the following (now stale):
> - `PROJECT_STATUS.md` (sprint snapshot — rot fast)
> - `PMS_SYSTEM_DOCUMENTATION.md` (parent-level master doc — overtaken by code)
> - `blueprint.md` (original architecture — superseded)
>
> Kept as living docs (not replaced):
> - `CLAUDE.md` — rules/standards for AI + devs
> - `docs/data-table-handoff.md` — shared DataTable component
> - `.claude/skills/*.md` — domain playbooks
> - `PLAN-*.md` — active feature plans (rate-recalc, drag-create, reservation tape chart)

---

## Table of Contents

1. [Tech Stack](#1-tech-stack)
2. [Folder Structure](#2-folder-structure)
3. [Prisma Schema — Models](#3-prisma-schema--models)
4. [Prisma Schema — Enums](#4-prisma-schema--enums)
5. [Migrations](#5-migrations)
6. [Dashboard Routes](#6-dashboard-routes)
7. [API Routes](#7-api-routes)
8. [Services](#8-services)
9. [Shared Components](#9-shared-components)
10. [Libraries (src/lib/)](#10-libraries-srclib)
11. [Skills (Playbooks)](#11-skills-playbooks)
12. [Auth & Authorization](#12-auth--authorization)
13. [Database Invariants](#13-database-invariants)
14. [Business Rules](#14-business-rules)
15. [Current Development State](#15-current-development-state)
16. [Backlog & Next Work](#16-backlog--next-work)
17. [Documentation Cleanup Plan](#17-documentation-cleanup-plan)
18. [Statistics](#18-statistics)

---

## 1. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript |
| UI | React 18, CSS modules + CSS variables (dark mode), Lucide icons |
| ORM | Prisma 5.x |
| Database | PostgreSQL 14+ (`postgresql://postgres:postgres@localhost:5433/pms_db`) |
| Auth | NextAuth.js v4 (JWT, credentials provider, 24h session) |
| Validation | Zod |
| Charts | Recharts |
| Dates | Native `Date` + centralized formatters (no moment/dayjs) |
| Currency | Prisma `Decimal` + `fmtBaht` |
| OCR | Google Vision API (ID card / passport) |
| Export | CSV (custom) + XLSX (`exceljs`) |

---

## 2. Folder Structure

```
pms-next/
├── prisma/
│   ├── schema.prisma              # 39 models, 31 enums (~1169 lines)
│   ├── seed.ts                    # test data
│   └── migrations/                # 11 migrations
├── src/
│   ├── app/
│   │   ├── (dashboard)/           # 20 feature routes
│   │   │   └── [feature]/
│   │   │       ├── page.tsx
│   │   │       ├── [id]/page.tsx   # (city-ledger only)
│   │   │       └── components/
│   │   └── api/                   # 87 route.ts files
│   ├── services/                  # 11 domain services (~4,173 LOC)
│   ├── components/
│   │   ├── data-table/            # MANDATORY shared grid
│   │   ├── ui/                    # primitives
│   │   ├── layout/                # Sidebar, Header, nav
│   │   └── [feature]/             # folio, invoice, receipt, payment
│   ├── lib/
│   │   ├── date-format.ts         # ⚠️ MANDATORY formatters
│   │   ├── prisma.ts, auth.ts, tax.ts, ocr.ts, ...
│   │   └── validations/           # Zod schemas
│   └── middleware.ts
├── docs/                          # SYSTEM_OVERVIEW.md (this), data-table-*, ACTIVITY_LOG_*
├── .claude/
│   └── skills/                    # 10 playbooks
├── CLAUDE.md                      # ⚠️ rules
├── PLAN-*.md                      # active feature plans
└── README.md / SETUP.md
```

### Naming Conventions
- Services: `[domain].service.ts`
- API: `[resource]/route.ts`, nested actions under `[resource]/[action]/route.ts`
- Pages: `page.tsx` (list), `[id]/page.tsx` (detail)
- Components: `PascalCase.tsx` grouped by feature namespace
- DB: snake_case columns → camelCase in Prisma (via `@map`)

---

## 3. Prisma Schema — Models (39 total)

### 3.1 Core Operational (Room / Guest / Booking)
| Model | Purpose |
|---|---|
| `Room` | Physical room: number, floor, type ref, current status |
| `RoomType` | Category (STD, SUP, DLX, STE) + base daily/monthly rates |
| `RoomRate` | Per-room pricing (daily / monthly_short / monthly_long) + water/electric rates + furniture allowance |
| `Guest` | Master record: ID/passport, visa, TM30, VIP, tags, emergency contact |
| `Booking` | Stay: checkIn/checkOut, rate, deposit, status, optional cityLedgerAccount link |
| `BookingCompanion` | Additional occupants (name, ID, OCR fields) |
| `BookingCompanionPhoto` | Photos (face / id_card / passport) |
| `UtilityReading` | Monthly water/electric readings per room |

### 3.2 Finance — Invoices / Payments / Ledger
| Model | Purpose |
|---|---|
| `Invoice` | Master invoice (types: daily_stay, monthly_rent, utility, deposit_receipt, city_ledger_summary, …) |
| `InvoiceItem` | Line items — **1:1 unique FK to `FolioLineItem` prevents double-billing** |
| `Payment` | Cash/transfer/card/promptpay/OTA with receipt #, void support |
| `PaymentAllocation` | Maps payment → specific invoices (partial payment) |
| `SecurityDeposit` | Booking deposit lifecycle: hold → deduct/refund/forfeit |
| `Folio` | 1 per booking — holds charges before they are invoiced |
| `FolioLineItem` | Charge line with `billingStatus` lock (UNBILLED → BILLED → PAID / VOIDED) |
| `LedgerEntry` | Double-entry ledger (DEBIT/CREDIT, 9 accounts) |
| `CashSession` | Daily cash drawer open/close + reconciliation |

### 3.3 City Ledger / Accounts Receivable
| Model | Purpose |
|---|---|
| `CityLedgerAccount` | Corporate account: code, creditLimit, creditTermsDays, balance cache, `version` (optimistic concurrency) |
| `CityLedgerTransaction` | Append-only log (CHARGE / PAYMENT / VOID / ADJUSTMENT / BAD_DEBT) + runningBalance cache |
| `CityLedgerPayment` | Corporate payment with `unallocatedAmount` |
| `CityLedgerAllocation` | Payment → invoice mapping |

### 3.4 Housekeeping / Maintenance / Operations
| Model | Purpose |
|---|---|
| `HousekeepingTask` | pending → in_progress → completed → inspected, with payout |
| `MaintenanceTask` | priority (low/medium/high/urgent), cost, status |
| `RoomInspection` | Inspection record + photos (cascade) |
| `RoomInspectionPhoto` | Photos |
| `Maid` | Staff member |
| `MaidTeam` | Group |
| `MaidTeamMember` | Junction |
| `MaidPayout` | Payout records |

### 3.5 Multi-Room Stays / Room Changes
| Model | Purpose |
|---|---|
| `BookingRoomSegment` | Ordered `[fromDate, toDate)` segments for multi-room stays |
| `RoomMoveHistory` | Immutable audit trail — `SHUFFLE` (pre-arrival same-type swap), `MOVE` (point-in-time change), `SPLIT` (explicit multi-room) |

### 3.6 Audit & Activity
| Model | Purpose |
|---|---|
| `ActivityLog` | Non-fatal operational log — never blocks parent transaction |
| `PaymentAuditLog` | Immutable audit: CREATE/UPDATE/VOID/REFUND/ALLOCATE/APPLY_DISCOUNT with before/after |
| `RateAudit` | Booking rate change history (previous/new rate, scenario) |

### 3.7 Users & System
| Model | Purpose |
|---|---|
| `User` | email + bcrypt password + role (admin/manager/staff) |
| `SavedView` | Per-user data-table state (filters, sort, visible cols, shared flag) |
| `Product` | Service catalog with unit price, tax type, category |
| `IdempotencyRecord` | Idempotency protection (key → result + expiry) |

---

## 4. Prisma Schema — Enums (31 total)

**Identity:** `Gender`, `IdType`
**Rooms / Bookings:** `RoomStatus`, `BookingType`, `BookingSource`, `BookingStatus`, `RoomChangeMode`
**Finance:** `InvoiceStatus`, `InvoiceType`, `PaymentStatus`, `PaymentMethod`, `DepositStatus`, `TaxType`, `DiscountCategory`
**Ledger:** `LedgerType`, `LedgerAccount` (CASH, BANK, AR, AR_CORPORATE, REVENUE, DEPOSIT_LIABILITY, PENALTY_REVENUE, EXPENSE, DISCOUNT_GIVEN)
**City Ledger:** `CityLedgerInvoiceStatus`, `CityLedgerAccountStatus`
**Folio:** `FolioChargeType` (ROOM / UTILITY_* / EXTRA_SERVICE / PENALTY / DISCOUNT / ADJUSTMENT / DEPOSIT_BOOKING / OTHER), `BillingStatus`
**Ops:** `HousekeepingStatus`, `MaintenanceStatus`, `MaintenancePriority`, `IssueCategory`, `IssueStatus`, `IssuePriority`
**Audit:** `AuditAction`, `SessionStatus`
**Users:** `UserRole`
**Products:** `ProductCategory`

---

## 5. Migrations (11, in execution order)

1. `20260315122040_init` — Initial schema
2. `20260316_add_actual_checkin_checkout` — Add actual timestamps to Booking
3. `20260319_add_room_rates` — RoomRate table
4. `20260330_add_activity_log` — ActivityLog
5. `20260330_add_booking_companions` — BookingCompanion + photos
6. `20260330_add_room_inspection` — RoomInspection + photos
7. `20260405_add_folio_billing` — Folio, FolioLineItem, CashSession
8. `20260406_add_missing_schema` — Bridge: RateAudit, RoomMoveHistory, BookingRoomSegment, PaymentAuditLog, SecurityDeposit, Maid*, Product
9. `20260413_add_city_ledger` — CL tables + enums
10. `20260418_add_product_description_unit` — Product.description + unit
11. `20260419_add_booking_room_segments` — Finalize segments for multi-room

---

## 6. Dashboard Routes (20)

| Route | LOC | Maturity | Purpose |
|---|---:|---|---|
| `dashboard` | 1015 | **FULL** | KPI: occupancy, revenue, upcoming checkouts, activity feed |
| `reservation` | 1036 | **FULL** | Tape chart w/ drag-create, multi-room, shuffle/move |
| `bookings` | 296 | **STUB** | Booking list (no inline actions) |
| `checkin` | 1192 | **FULL** | Search → companion capture (OCR) → confirm → folio preview |
| `guests` | 1030 | **FULL** | List + inline edit, VIP, tags, TM30 |
| `rooms` | 787 | **FULL** | Daily status, inspection, maintenance, summary |
| `housekeeping` | 55+ | **FULL** | Task boards + teams + payout (tabs split into components) |
| `maintenance` | 245 | **LIST** | Priority filter + status (detail minimal) |
| `tm30` | 292 | **LIST** | Guests needing TM30 report + bulk mark-done |
| `utilities` | 233 | **LIST** | Monthly water/electric per room |
| `products` | 751 | **FULL** | Service catalog |
| `sales` | 397 | **LIST** | Recharts: daily revenue, top sources — **legacy GoogleSheetTable** |
| `billing` | 421 | **LIST** | Folio → invoice creation |
| `billing-cycle` | 730 | **FULL** | Monthly recurring billing, penalties, exports |
| `cashier` | 560 | **FULL** | Open session → receive payment → allocate → close |
| `city-ledger` | 423 + detail | **FULL** | AR accounts + aging + statement |
| `finance` | 1293 | **FULL** | Cash flow, AR aging, bad debt, ledger, daily P&L |
| `bad-debt` | 456 | **LIST** | Write-off candidates + collected |
| `nightaudit` | 265 | **STUB** | Room snapshot + day-end posting |
| `settings` | 0 | **STUB** | Placeholder |

---

## 7. API Routes (87 total)

Grouped by feature:

### 7.1 Auth (1)
- `auth/[...nextauth]/route.ts`

### 7.2 Bookings (17)
- `bookings/route.ts` — LIST / CREATE
- `bookings/[id]/route.ts` — GET / PATCH
- `bookings/[id]/folio/route.ts`
- `bookings/[id]/payment-summary/route.ts`
- `bookings/[id]/proforma/route.ts`
- `bookings/[id]/pay/route.ts`
- `bookings/[id]/extend/route.ts`
- `bookings/[id]/renew/route.ts`
- `bookings/[id]/move-room/route.ts` (MOVE mode)
- `bookings/[id]/shuffle-room/route.ts` (SHUFFLE mode)
- `bookings/[id]/move-candidates/route.ts`
- `bookings/[id]/shuffle-candidates/route.ts`
- `bookings/[id]/segments/route.ts`
- `bookings/[id]/split-segment/route.ts`
- `bookings/[id]/add-service/route.ts`
- `bookings/companions/[id]/route.ts`
- `bookings/companions/photo/[id]/route.ts`

### 7.3 Check-in / Check-out (3)
- `checkin/route.ts`
- `checkin/search/route.ts`
- `checkout/route.ts`

### 7.4 Reservation (3)
- `reservation/route.ts`
- `reservation/check-overlap/route.ts`
- `reservation/preview-resize/route.ts`

### 7.5 Guests (4)
- `guests/route.ts`, `guests/[id]/route.ts`
- `guests/[id]/tm30/route.ts`
- `guests/birthdays/route.ts`

### 7.6 Rooms (8)
- `rooms/route.ts`, `rooms/[id]/route.ts`, `rooms/[id]/status/route.ts`, `rooms/[id]/history/route.ts`
- `rooms/rates/route.ts`, `rooms/rates/bulk/route.ts`, `rooms/rates/[roomId]/route.ts`
- `rooms/daily-report/route.ts`

### 7.7 Room Types (2)
- `room-types/route.ts`, `room-types/[id]/route.ts`

### 7.8 Housekeeping / Maintenance / Inspection (9)
- `housekeeping/route.ts`, `housekeeping/[id]/route.ts`, `housekeeping/bulk-assign/route.ts`
- `maintenance/route.ts`, `maintenance/[id]/route.ts`
- `inspection/route.ts`, `inspection/[id]/route.ts`, `inspection/photo/[id]/route.ts`

### 7.9 Folios / Invoices (6)
- `folios/[id]/route.ts`, `folios/[id]/charges/route.ts`
- `invoices/route.ts`, `invoices/[id]/route.ts`, `invoices/[id]/document/route.ts`, `invoices/[id]/receipt/route.ts`

### 7.10 Payments / Deposits / Cash (8)
- `payments/route.ts`, `payments/[id]/route.ts`, `payments/[id]/void/route.ts`
- `security-deposits/route.ts`, `security-deposits/[id]/route.ts`
- `cash-sessions/route.ts`, `cash-sessions/[id]/route.ts`, `cash-sessions/current/route.ts`

### 7.11 City Ledger (7)
- `city-ledger/route.ts`, `city-ledger/[id]/route.ts`, `city-ledger/summary/route.ts`
- `city-ledger/[id]/aging/route.ts`, `city-ledger/[id]/credit-limit/route.ts`
- `city-ledger/[id]/statement/route.ts`, `city-ledger/[id]/payments/route.ts`

### 7.12 Billing cycle (4)
- `billing/generate-monthly/route.ts`
- `billing/collection/route.ts`
- `billing/penalties/route.ts`
- `billing/migrate-folios/route.ts`

### 7.13 Maids / Payouts (5)
- `maids/route.ts`, `maids/[id]/route.ts`
- `maid-teams/route.ts`, `maid-teams/[id]/route.ts`
- `payouts/route.ts`

### 7.14 Products (2) • Activity (1) • Saved Views (2) • Utilities (1) • TM30 (1) • Finance (1) • Dashboard (1) • Night audit (1) • Debug/Setup (6)

---

## 8. Services (11, ~4,173 LOC)

| Service | LOC | Purpose |
|---|---:|---|
| `folio.service.ts` | 477 | **Core billing engine**: add UNBILLED charge → lock to BILLED via invoice → mark PAID / VOIDED; unique constraint prevents double-billing |
| `roomChange.service.ts` | 814 | **Largest** — orchestrates SHUFFLE / MOVE / SPLIT with rate recalc + audit |
| `cityLedger.service.ts` | 653 | AR ops: credit check, postInvoiceToCityLedger, receiveCityLedgerPayment, aging analysis, bad debt |
| `billing.service.ts` | 436 | Recurring monthly invoice generation, penalty application, collection rules |
| `payment.service.ts` | 373 | Capture → allocate → ledger post → idempotency check |
| `ledger.service.ts` | 325 | Double-entry posting for all financial events |
| `bookingRate.service.ts` | 315 | Rate calc: daily/monthly, tax, discount, promotion |
| `securityDeposit.service.ts` | 232 | Capture / hold / deduct / refund / forfeit + ledger |
| `cashSession.service.ts` | 189 | Drawer lifecycle + reconciliation |
| `invoice-number.service.ts` | 185 | Sequence generation: invoice/payment/receipt/folio/CL IDs |
| `activityLog.service.ts` | 174 | Non-fatal audit writer (tx-aware) |

---

## 9. Shared Components

### 9.1 Data Table (src/components/data-table/) — **MANDATORY for all list views**
`DataTable.tsx` • `ColFilterDropdown.tsx` • `ColVisibilityMenu.tsx` • `SavedViewsMenu.tsx` • `ExportMenu.tsx` • `DateRangeMenu.tsx` • `GroupByMenu.tsx` • `types.ts` • `lib/{url-state, export-csv, export-excel, export-shared, date-presets}.ts`

**See:** `docs/data-table-handoff.md` for props and rollout status.

### 9.2 UI Primitives (src/components/ui/)
`Button` • `Card` • `Dialog` • `Input` • `LoadingSpinner` • `Skeleton` • `Toast` • `ErrorBoundary`

### 9.3 Layout (src/components/layout/)
`Sidebar` • `Header` • `MobileNav` • `CommandPalette` (Cmd+K) • `navItems.ts`

### 9.4 Feature Components
- `folio/FolioLedger.tsx`
- `invoice/{InvoiceDocument, InvoiceModal, types}.tsx`
- `payment/PaymentCollectionModal.tsx`
- `receipt/{ReceiptModal, ThermalReceipt, types}.tsx`

---

## 10. Libraries (src/lib/)

| File | Purpose |
|---|---|
| `date-format.ts` | ⚠️ **MANDATORY** — `fmtDate`, `fmtTime`, `fmtDateTime`, `fmtDateTimeSec`, `fmtBaht`, `toDateStr`, `fmtMonthShortTH`, `fmtMonthLongTH` |
| `prisma.ts` | Singleton Prisma client |
| `auth.ts` | NextAuth config (credentials, JWT 24h, role in token) |
| `tax.ts` | Thailand VAT 7% + service 10% order-of-ops, inclusive/exclusive |
| `invoice-utils.ts` | Subtotal / VAT / WHT / grand total calculation |
| `ocr.ts` | Google Vision API (ID card / passport extraction) |
| `room-rate-db.ts` | Rate lookup by type × booking_type |
| `receipt-config.ts` | Thermal receipt layout constants (80mm POS) |
| `id-generator.ts` | UUID/CUID helpers |
| `constants.ts` | Enum-to-label maps (ROOM_STATUSES, BOOKING_TYPES, …) |
| `theme.tsx` | Theme provider + CSS variable dark mode |
| `utils.ts` | className merge, misc helpers |
| `validations/{payment, cashSession, cityLedger}.ts` | Zod schemas |

---

## 11. Skills (Playbooks — .claude/skills/)

| Skill | Focus |
|---|---|
| `finance-invariants.md` | Double-entry, posted-record immutability, idempotency, rounding |
| `prisma-money-transactions.md` | `$transaction` isolation, lock order, P2034 retry |
| `tax-thailand.md` | VAT 7% + service 10% order, inclusive/exclusive, WHT |
| `night-audit-checklist.md` | Day-close pre-checks, atomic postings, immutability |
| `money-formatting-rules.md` | `fmtBaht` only, right-align, credit display |
| `schema-migration-safety.md` | Red-zone tables, NOT NULL backfill, rollback |
| `multi-step-dialog-wizard.md` | Stepper + per-step validation + summary |
| `mutation-toast-pattern.md` | Guard → try/finally → toast + ConfirmDialog |
| `keyboard-first-flow.md` | Cmd+K, Esc, focus trap, ARIA |
| `google-sheet-filter-sort.md` | Per-column filter: getValue/getLabel/counts, Enter-to-apply |

---

## 12. Auth & Authorization

- **Provider:** NextAuth.js v4, credentials-only (no external OAuth)
- **Strategy:** JWT, 24h expiry
- **Password:** bcrypt
- **Session shape:** `{ id, email, name, role }` — role ∈ {admin, manager, staff}
- **Enforcement:** every API route + Server Action starts with `getServerSession(authOptions)` → 401 if missing
- **Redirect:** unauthenticated → `/login`

---

## 13. Database Invariants

### 13.1 Unique constraints
- `users.email`, `room_types.code`, `rooms.number`
- `room_rates.room_id`, `utility_readings(room_id, month)`
- `booking_number`, `invoice_number`, `payment_number`, `receipt_number`, `folio_number`
- `city_ledger_accounts.account_code`
- `payment_allocations(payment_id, invoice_id)`
- `city_ledger_allocations(cl_payment_id, invoice_id)`
- **`invoice_items.folio_line_item_id` — prevents double-billing (1:1)**
- `booking_room_segments(booking_id, from_date)`
- `maid_team_members(maid_id, maid_team_id)`
- `saved_views(user_id, table_key)`

### 13.2 Immutable (append-only, never UPDATE)
- `RoomMoveHistory`
- `PaymentAuditLog`
- `LedgerEntry`
- `CityLedgerTransaction`
- `RateAudit`

### 13.3 Referential integrity
- Mix of `onDelete: Cascade` (photos, line items) and `onDelete: Restrict` (financial records)
- `Booking.cityLedgerAccountId` nullable (corporate billing optional)
- `Invoice.bookingId` nullable (one-off invoices allowed)

---

## 14. Business Rules (enforced in schema + services)

### 14.1 Booking
- `Booking.rate` fixed at creation; changes go through RateAudit
- Multi-room stays via `BookingRoomSegment` (SPLIT mode)
- Room changes:
  - **SHUFFLE** — pre-arrival, same type, no cost
  - **MOVE** — point-in-time change, rate may adjust
  - **SPLIT** — explicit multi-room segments

### 14.2 Folio & Invoice
- 1 Booking = 1 Folio (created at booking time)
- Charges → `FolioLineItem(UNBILLED)`
- Invoice creation locks items to `BILLED` via unique `InvoiceItem.folioLineItemId`
- Invoice VOID → items revert to `UNBILLED`
- `Folio.balance` = totalCharges − totalPayments (cached)

### 14.3 Payment
- `Payment.amount` must be allocated to ≥ 1 invoice via `PaymentAllocation`
- Idempotency key prevents double-submit
- VOID reverses allocations + posts reversal ledger entries

### 14.4 City Ledger
- `CityLedgerAccount.currentBalance` = Σ outstanding invoices (cached)
- Credit check: `currentBalance + newInvoice.amount ≤ creditLimit` (else error)
- Every charge/payment creates `CityLedgerTransaction` with `runningBalance`
- Optimistic concurrency via `version` field

### 14.5 Security Deposit
- Capture at checkin → `DR CASH, CR DEPOSIT_LIABILITY`
- Use at checkout → `DR DEPOSIT_LIABILITY, CR REVENUE`
- Partial deduction / forfeiture / refund supported

### 14.6 Double-Entry Ledger
- Every financial event posts DEBIT + CREDIT
- Accounts: `CASH, BANK, AR, AR_CORPORATE, REVENUE, DEPOSIT_LIABILITY, PENALTY_REVENUE, EXPENSE, DISCOUNT_GIVEN`
- Examples:
  - Payment received → DR CASH, CR AR
  - Invoice issued → DR AR, CR REVENUE
  - CL payment received → DR CASH, CR AR_CORPORATE

### 14.7 Activity Log
- Side-effect only — **must never block parent transaction**
- Catch + `console.warn` on failure (see `activityLog.service.ts`)
- Categories: booking / checkin / checkout / room / payment / invoice / housekeeping / maintenance / guest / system / city_ledger

### 14.8 Date handling
- Dates stored as `@db.Date` (no time) for checkIn/checkOut/dueDate/issueDate
- Timestamps as `DateTime` only for audit (createdAt/updatedAt)
- **UI:** MUST use `fmtDate` / `fmtDateTime` — NEVER `toLocaleDateString('th-TH')` or `.toISOString()` for display

---

## 15. Current Development State (as of 2026-04-21)

### ✅ Production-ready
- Booking flow (check-in → check-out → folio → invoice → payment → receipt)
- Room status + room rates + utility readings
- Guest master + TM30 fields + OCR ID capture
- Folio-centric billing (UNBILLED → BILLED → PAID lock)
- Payment capture + allocation + double-entry ledger
- Security deposit lifecycle
- City Ledger / AR (credit check, posting, aging, statement)
- Cash session open/close
- Housekeeping tasks + teams + payouts
- Maintenance requests
- Activity log (tx-aware, non-fatal)
- Room inspection with photos
- Booking companions (multi-person stays)
- Multi-room segments (SPLIT) + room change (SHUFFLE / MOVE)
- Monthly billing cycle + penalties (partial UI)
- DataTable shared component (Phase 1–4b + rollout)
- Saved views (owner + shared)
- Tape chart reservation with drag-create

### 🟡 Partial / needs polish
- Bad debt workflow (schema + list ready, write-off action incomplete)
- TM30 bulk reporting UI
- Night audit (stub page — day-close logic needs scoping)
- Billing cycle preview tables (no DataTable `syncUrl` yet)
- City Ledger payment allocation UI (allocating one CL payment to multiple invoices)
- Thermal receipt printing (layout done, driver untested)

### ⚪ Not yet started
- Settings page
- User management UI (admin CRUD)
- Inventory / Purchasing / HR / Marketing modules
- Email / SMS notifications
- Scheduled report exports (PDF)
- Multi-property support
- API rate limiting
- Automated test suite (only `scripts/test-e2e.ts` exists with TS errors)

### ⚠️ Known technical debt
- 5 pre-existing TS errors (see `data-table-handoff.md` §5)
- 26 silent `any` casts across API routes
- ~284 "Maximum update depth" React warnings (stable, not growing)
- Prisma DLL lock on Windows (must stop dev server before `prisma generate`)
- Legacy `sales/components/GoogleSheetTable.tsx` — migrate to shared DataTable when touched

---

## 16. Backlog & Next Work (prioritized)

### 🔴 P0 — Financial correctness / data integrity
1. **Rate recalculation on resize** — see `PLAN-RATE-RECALCULATION.md`. `/api/reservation/preview-resize` exists but execute path + RateAudit writes need completion. Critical: affects real money.
2. **Double-booking guard on drag/resize** — `/api/reservation` PATCH should reject overlapping bookings (currently may allow).
3. **Timezone consistency** — API uses `T00:00:00.000Z` but UI parses as local — audit for off-by-one-day bugs.

### 🟠 P1 — Feature completion
4. **City Ledger phase 4–8** — detail 4-tab, `receiveCityLedgerPayment` UI, monthly statement PDF, credit hold on new booking, aging report, bad debt write-off (see `CityLedger_Implementation_Plan_FINAL.md`).
5. **DataTable Phase 5 P1** — bulk actions (multi-select), inline edit, server-side pagination for >5k rows (see `docs/data-table-handoff.md` §3).
6. **Night audit** — design real day-close logic (not just status snapshot).

### 🟡 P2 — UX polish
7. Tape chart bug fixes B1/B2/B6 (click-vs-drag, sticky column) — see `PLAN-RESERVATION-TAPECHART.md`.
8. Vertical drag (move booking across rooms) on tape chart.
9. DataTable Phase 5 P2 — pinned columns, expandable rows, conditional formatting.
10. Migrate legacy `sales/components/GoogleSheetTable.tsx` → shared `<DataTable>`.

### ⚪ P3 — Infrastructure & scale
11. Automated test suite (fix 5 TS errors in `scripts/test-e2e.ts` first).
12. Fix 26 `any` casts (use Zod response schemas).
13. Investigate "Maximum update depth" warnings (instrument before fixing).
14. API rate limiting.
15. Multi-property support.

---

## 17. Documentation Cleanup Plan

### Keep (living documents)
| File | Why |
|---|---|
| `pms-next/CLAUDE.md` | Rules/standards — always loaded |
| `CLAUDE.md` (parent) | Mirror of pms-next/CLAUDE.md — keep for parent-level context |
| `pms-next/README.md` | Project intro |
| `pms-next/SETUP.md` | Dev setup |
| `pms-next/docs/SYSTEM_OVERVIEW.md` | **THIS FILE — new single source of truth** |
| `pms-next/docs/data-table-handoff.md` | Shared component handoff |
| `pms-next/docs/data-table-roadmap.md` | DataTable long-term roadmap |
| `pms-next/docs/ACTIVITY_LOG_IMPLEMENTATION_PLAN.md` | Reference — already implemented but useful as pattern |
| `pms-next/PLAN-RATE-RECALCULATION.md` | ACTIVE feature plan (P0) |
| `pms-next/PLAN-DRAG-CREATE-BOOKING.md` | Reference (partially implemented) |
| `PLAN-RESERVATION-TAPECHART.md` (parent) | Bug/feature list still relevant |
| `pms-next/CityLedger_Implementation_Plan_FINAL.md` | Phases 4–8 still relevant |
| `.claude/skills/*.md` | Domain playbooks |

### 🗑️ Recommend DELETE (stale / replaced by this doc)
| File | Reason |
|---|---|
| `pms-next/PROJECT_STATUS.md` | Sprint snapshot — rot fast, replaced by §15 |
| `PMS_SYSTEM_DOCUMENTATION.md` (parent) | Master doc outdated — replaced by this file |
| `blueprint.md` (parent) | Original architecture — superseded |
| `CityLedger_Implementation_Plan_FINAL.md` (parent) | Duplicate of pms-next/ copy — keep only one |

### 🤔 Consider consolidating
- `PLAN-RESERVATION-TAPECHART.md` (parent) → move into `pms-next/docs/` alongside other plans
- Two `CLAUDE.md` files: keep pms-next/ one, delete parent duplicate OR reduce parent to a stub pointer

### Parent-level non-MD files (not touched here — user decision)
- `PMS-Production-Blueprint.docx`
- `PMS_Payment_Module_Blueprint_v1.6.docx`
- `daily-cashbook-design.html`
- `pms-prototype-ui.jsx`
- `report_roomList.php`, `report_roomList2.php`, `room_inspection*.php` — legacy PHP reports, likely pre-Next.js era

---

## 18. Statistics

| Metric | Count |
|---|---:|
| Prisma models | 39 |
| Prisma enums | 31 |
| Migrations | 11 |
| Dashboard routes | 20 |
| API routes (`route.ts`) | 87 |
| Services | 11 |
| Service LOC | ~4,173 |
| Shared component files | 31 |
| Library files | 14 |
| Zod schemas | 3 |
| Skills | 10 |
| LedgerAccount types | 9 |
| User roles | 3 |

---

**End of SYSTEM_OVERVIEW.md** — this document should be refreshed whenever a migration is added or a new feature domain comes online.
