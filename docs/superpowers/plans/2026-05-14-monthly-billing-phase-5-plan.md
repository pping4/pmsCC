# Monthly Billing — Phase 5 Implementation Plan

> **For agentic workers:** Use `subagent-driven-development`. Tasks largely independent except 5.1→5.2 (service depends on schema) and 5.3→5.5 (UI depends on API).

**Goal:** Make every line on a monthly bill carry a precise period (start–end), support **recurring services** (TV, Internet, ค่าบริการ — auto-add to every cycle until removed), let managers **manually trigger** a bill for any monthly booking, and let them **edit the cycle period** before approving.

**Architecture:** Add a `RecurringCharge` model linked to Booking; on every `generateDraftInvoice` call, the service pulls active recurring charges whose date range overlaps the cycle and adds them as `FolioLineItem(billingStatus='DRAFT')` with `serviceDate=cycle.start` + `periodEnd=cycle.end`. Extend `EditDraftDialog` to accept `periodStart`/`periodEnd` + automatic rent re-pro-rate. Add "🧾 สร้างบิลรอบถัดไป" button on the booking detail panel and "▶️ Run cron now" on `/billing-cycle`. Invoice and receipt templates render each line's period as `YYYY-MM-DD ถึง YYYY-MM-DD`.

**Spec basis:** This plan supplements the monthly-billing-v2 design at `docs/superpowers/specs/2026-05-13-monthly-billing-utility-review-design.md`. No new high-level architectural decisions — refinements only.

---

## Conventions (re-stated from Phase 0-4)

- All Prisma writes inside `prisma.$transaction(async (tx) => …)`.
- Service functions take `tx: Prisma.TransactionClient`.
- Every API route: `getServerSession` + `requireRole` first, then Zod, then service call.
- Money math via `Prisma.Decimal`.
- Dates displayed via `@/lib/date-format` (`fmtDate`, `fmtDateTime`, `fmtBaht`).
- Typed errors continue the `BillingStateError` / `UtilityValidationError` pattern.
- Tests: `scripts/_verify-*.ts` for pure-fn assertions, `scripts/e2e-*.ts` for service+API flows.

---

## Task 5.1 — Schema: `RecurringCharge` model

**File:** `prisma/schema.prisma`

Add the model:

```prisma
model RecurringCharge {
  id          String   @id @default(uuid())
  bookingId   String   @map("booking_id")
  chargeType  FolioChargeType  @map("charge_type")  // typically EXTRA_SERVICE or OTHER
  description String                                 // "ค่าเช่า TV", "Internet", "ค่าบริการ"
  amount      Decimal  @db.Decimal(10, 2)            // baht per cycle (flat, not pro-rated by default)
  startDate   DateTime @db.Date @map("start_date")
  endDate     DateTime? @db.Date @map("end_date")    // null = forever (until booking ends)
  status      RecurringChargeStatus @default(active)
  notes       String?
  createdBy   String   @map("created_by")
  createdAt   DateTime @default(now()) @map("created_at")
  cancelledAt DateTime? @map("cancelled_at")
  cancelledBy String?  @map("cancelled_by")

  booking Booking @relation(fields: [bookingId], references: [id], onDelete: Restrict)

  @@index([bookingId, status])
  @@index([startDate, endDate])
  @@map("recurring_charges")
}

enum RecurringChargeStatus {
  active
  cancelled
}
```

Add reverse relation on `Booking`: `recurringCharges RecurringCharge[]`.

**Migration name:** `add_recurring_charges`. Use the same manual `prisma db execute` + `prisma migrate resolve --applied` pattern Phase 0 used (P1014 workaround on `refund_records`).

**Commit:** `feat(schema): RecurringCharge model — TV, Internet, monthly services`

---

## Task 5.2 — Service: `recurring.service.ts` + integrate into `generateDraftInvoice`

**Files:**
- Create: `src/services/recurring.service.ts`
- Modify: `src/services/billing.service.ts` (add recurring-pull step in `generateDraftInvoice`)
- Create: `scripts/_verify-recurring-service.ts`
- Create: `scripts/e2e-recurring-in-cycle.ts`

### 5.2.a — `recurring.service.ts`

```ts
import { Prisma } from '@prisma/client';
type Tx = Prisma.TransactionClient;

export type RecurringErrorCode = 'NOT_FOUND' | 'ALREADY_CANCELLED' | 'INVALID_DATES';

export class RecurringValidationError extends Error {
  constructor(public code: RecurringErrorCode, msg: string) {
    super(msg); this.name = 'RecurringValidationError';
  }
}

export interface CreateRecurringInput {
  bookingId:   string;
  chargeType:  'EXTRA_SERVICE' | 'OTHER';
  description: string;
  amount:      number;
  startDate:   Date;
  endDate?:    Date | null;
  notes?:      string;
  createdBy:   string;
}

export async function createRecurringCharge(tx: Tx, input: CreateRecurringInput) {
  if (input.amount <= 0) throw new RecurringValidationError('INVALID_DATES', 'amount must be > 0');
  if (input.endDate && input.endDate < input.startDate) {
    throw new RecurringValidationError('INVALID_DATES', 'endDate must be >= startDate');
  }
  return tx.recurringCharge.create({
    data: {
      bookingId: input.bookingId,
      chargeType: input.chargeType,
      description: input.description,
      amount: new Prisma.Decimal(input.amount),
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      notes: input.notes,
      createdBy: input.createdBy,
      status: 'active',
    },
  });
}

export async function cancelRecurringCharge(
  tx: Tx,
  id: string,
  cancelledBy: string,
): Promise<void> {
  const existing = await tx.recurringCharge.findUnique({ where: { id }, select: { status: true } });
  if (!existing) throw new RecurringValidationError('NOT_FOUND', `RecurringCharge ${id} not found`);
  if (existing.status === 'cancelled') {
    throw new RecurringValidationError('ALREADY_CANCELLED', 'Already cancelled');
  }
  await tx.recurringCharge.update({
    where: { id },
    data: { status: 'cancelled', cancelledAt: new Date(), cancelledBy },
  });
}

export async function listActiveForBooking(tx: Tx, bookingId: string) {
  return tx.recurringCharge.findMany({
    where: { bookingId, status: 'active' },
    orderBy: { startDate: 'asc' },
  });
}

/**
 * Returns recurring charges whose [startDate, endDate or +∞] range overlaps
 * the given cycle window [cycleStart, cycleEnd]. These are the lines that
 * should be added to the cycle's draft invoice.
 *
 * Overlap test: charge.startDate <= cycleEnd AND (charge.endDate IS NULL OR charge.endDate >= cycleStart)
 */
export async function listForCycle(
  tx: Tx,
  bookingId: string,
  cycleStart: Date,
  cycleEnd: Date,
) {
  return tx.recurringCharge.findMany({
    where: {
      bookingId,
      status: 'active',
      startDate: { lte: cycleEnd },
      OR: [
        { endDate: null },
        { endDate: { gte: cycleStart } },
      ],
    },
    orderBy: { startDate: 'asc' },
  });
}
```

### 5.2.b — Integrate into `generateDraftInvoice`

In `src/services/billing.service.ts`, AFTER the utility charges block (around line 605) and BEFORE the `createInvoiceFromFolio` call, add:

```ts
// 3) Recurring charges (TV, Internet, ค่าบริการ) — pull active charges that
//    overlap this cycle and add one DRAFT line item each.
const recurring = await listForCycle(tx, booking.id, period.start, period.end);
for (const rc of recurring) {
  // Pro-rate by overlap days if the charge's date range partially covers the cycle.
  const effStart = rc.startDate > period.start ? rc.startDate : period.start;
  const effEnd   = (rc.endDate && rc.endDate < period.end) ? rc.endDate : period.end;
  const overlapDays = Math.round((effEnd.getTime() - effStart.getTime()) / 86_400_000) + 1;
  const cycleDays   = Math.round((period.end.getTime() - period.start.getTime()) / 86_400_000) + 1;
  const amount = overlapDays < cycleDays
    ? Number(new Prisma.Decimal(rc.amount).mul(overlapDays).div(cycleDays).toDecimalPlaces(2))
    : Number(rc.amount);
  await addCharge(tx, {
    folioId: folio.folioId,
    chargeType: rc.chargeType,
    description: overlapDays < cycleDays
      ? `${rc.description} (${overlapDays}/${cycleDays} วัน)`
      : rc.description,
    amount,
    serviceDate: effStart,
    periodEnd:   effEnd,
    referenceType: 'recurring_charge',
    referenceId:   rc.id,
    notes: `Cycle ${input.cycleIndex} · recurring ${rc.id}`,
    createdBy: input.createdBy,
    billingStatus: 'DRAFT',
  });
}
```

Add import: `import { listForCycle } from './recurring.service';`

### 5.2.c — Tests

`scripts/_verify-recurring-service.ts`: unit-level
- create → list → list-for-cycle (overlap, no-overlap, partial-overlap)
- cancel → list (empty) → list-for-cycle (empty even within original range)

`scripts/e2e-recurring-in-cycle.ts`: integration
- seed monthly booking
- create recurring "เช่า TV ฿500/cycle, start 2026-06-01, no end"
- `generateDraftInvoice(cycleIndex=2)` where cycle = 12 มิ.ย.–11 ก.ค.
  - assert draft has 1 ROOM line + 1 EXTRA_SERVICE line with amount ≈ ฿500 (full overlap)
- approveDraft → ledger pair correct
- create recurring "ค่า Internet ฿800/cycle, start 2026-06-20, end null"
- generate cycle 3 → recurring partial-overlap: starts mid-cycle → amount = 500 * (12/30) ≈ 200
  - actually wait, the description says "start 2026-06-20" — for cycle 3 (12 ก.ค.–11 ส.ค.) it covers all 30 days. For cycle 2 (12 มิ.ย.–11 ก.ค.), startDate=20 มิ.ย. so days = 22 (20 มิ.ย. - 11 ก.ค.). Adjust assertions accordingly.

**Commits:**
- `feat(billing): recurring.service — CRUD + listForCycle`
- `feat(billing): generateDraftInvoice pulls recurring charges + pro-rates partial overlap`

---

## Task 5.3 — Per-line period for water/electric

**File:** `src/services/billing.service.ts` — modify the utility `addCharge` calls in `generateDraftInvoice`

Currently (Phase 1):
```ts
await addCharge(tx, {
  folioId: folio.folioId, chargeType: 'UTILITY_WATER',
  amount: waterCharge,
  serviceDate: period.start,
  referenceType: 'monthly_draft', referenceId: '...',
  createdBy: input.createdBy, billingStatus: 'DRAFT',
});
```
No `periodEnd`. Same for electric.

Update BOTH to include `periodEnd: period.end`:
```ts
await addCharge(tx, {
  folioId: folio.folioId, chargeType: 'UTILITY_WATER',
  amount: waterCharge,
  serviceDate: period.start,
  periodEnd:   period.end,  // ← NEW
  referenceType: 'monthly_draft', referenceId: '...',
  createdBy: input.createdBy, billingStatus: 'DRAFT',
});
```

The ROOM line in `generateDraftInvoice` already sets `periodEnd` — preserve.

**Tests:** extend `scripts/e2e-draft-generation.ts` (or rolling/calendar e2es) to assert `FolioLineItem.periodEnd` is non-null on water/electric lines.

**Commit:** `feat(billing): set periodEnd on water/electric draft lines`

---

## Task 5.4 — Edit cycle period in EditDraftDialog

**Files:**
- Modify: `src/app/api/billing/drafts/[id]/edit/route.ts` — accept new optional `periodStart` / `periodEnd` fields
- Modify: `src/app/(dashboard)/billing-cycle/components/EditDraftDialog.tsx` — add date inputs

### 5.4.a — API

Add to Zod body:
```ts
const Body = z.object({
  rentAmount:    z.number().nonnegative().optional(),
  waterUsage:    z.number().nonnegative().optional(),
  electricUsage: z.number().nonnegative().optional(),
  periodStart:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodEnd:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:         z.string().max(500).optional(),
})
.refine(
  (d) => /* at least one field required */,
  ...
)
.refine(
  (d) => !d.periodEnd || !d.periodStart || d.periodEnd >= d.periodStart,
  { message: 'periodEnd must be >= periodStart', path: ['periodEnd'] },
);
```

Inside the transaction:
- If `periodStart` or `periodEnd` provided:
  - Parse dates; if both provided update the Invoice.billingPeriodStart/End columns
  - Also update the ROOM line's `serviceDate`/`periodEnd` to match
  - **Re-pro-rate rent** if `rentAmount` was NOT explicitly provided in this same request: compute new rent as `bookingRate * newDays / fullCycleDays` and update the ROOM line's amount + invoice.subtotal/grandTotal
  - If `rentAmount` WAS provided, trust the explicit value and skip re-pro-rate

Return: `{ ok: true, newGrandTotal: number, newPeriodStart?: string, newPeriodEnd?: string }`

### 5.4.b — UI

In `EditDraftDialog.tsx`, add two date inputs side-by-side: "ตั้งแต่วันที่" and "ถึงวันที่". Both default to the draft's current period. Show a hint: "เปลี่ยนช่วงวันที่จะคำนวณค่าเช่าใหม่ตามจำนวนวันโดยอัตโนมัติ ยกเว้นกรอกค่าเช่าเอง"

State the new field calls in body POST.

**Tests:** smoke test the API change in `scripts/e2e-api-billing-v2.ts` — edit period from 30 days → 15 days, assert ROOM amount halved, periodStart/End in Invoice updated.

**Commit:** `feat(api+ui): edit draft cycle period — auto re-pro-rate rent`

---

## Task 5.5 — Manual create bill UI

**Files:**
- Create: `src/app/api/bookings/[id]/billing/generate-next/route.ts` — POST endpoint
- Modify: `src/app/(dashboard)/reservation/components/DetailPanel.tsx` — add a button in the บิล tab
- Optionally modify: `src/app/(dashboard)/billing-cycle/page.tsx` — add "▶️ Run cron now" button

### 5.5.a — Per-booking generate-next API

Route: `POST /api/bookings/[id]/billing/generate-next`. Body: optional `{ cycleIndex?: number }` (if omitted, compute next cycle from max existing BillingPeriod + 1). Role: manager+.

Wraps `generateDraftInvoice` in `$transaction`. Returns `{ ok: true, invoiceId, cycleIndex, periodStart, periodEnd }`.

Maps `BillingStateError(BOOKING_NOT_MONTHLY)` → 422; `(FOLIO_NOT_FOUND)` → 422.

### 5.5.b — DetailPanel button

In the booking detail (open via tape chart click), under the บิล tab — if `bookingType !== 'daily'`, show:

```tsx
<button onClick={handleGenerateNextBill}>🧾 สร้างบิลรอบถัดไป</button>
```

Handler: confirm dialog → POST `/api/bookings/[bookingId]/billing/generate-next` → toast "สร้าง draft cycle N ที่ /billing-cycle" + link.

### 5.5.c — Run-cron-now button

In `/billing-cycle/page.tsx`, near the header (admin only): "▶️ Run cron now" button. Confirm dialog → POST `/api/cron/billing-draft` with the `CRON_SECRET` bearer. On success: refetch drafts list + toast count.

**Commit:** `feat(api+ui): manual generate-next bill button + run-cron-now`

---

## Task 5.6 — Per-line period display in invoice / receipt / UI

**Files:**
- Modify: `src/components/invoice/InvoiceDocument.tsx` — add period column to the line items table
- Modify: `src/components/receipt/ThermalReceipt.tsx` — add a period sub-line under each line item (compact form)
- Modify: `src/app/(dashboard)/billing-cycle/components/ExpandRow.tsx` — past-invoices table shows per-line period

### 5.6.a — InvoiceDocument

Locate the line items table inside this component (it renders `invoiceItems` → tr per item). For each item, if `folioLineItem.serviceDate` and `folioLineItem.periodEnd` are present, add a column "ช่วงวันที่" or render inside the description column as a sub-line:

```tsx
<div style={{ fontWeight: 600 }}>{item.description}</div>
{item.folioLineItem?.serviceDate && item.folioLineItem?.periodEnd && (
  <div style={{ fontSize: 11, color: '#6b7280' }}>
    {fmtDate(item.folioLineItem.serviceDate)} ถึง {fmtDate(item.folioLineItem.periodEnd)}
  </div>
)}
```

The current component may not select `folioLineItem` — extend the select chain in `/api/invoices/[id]/document/route.ts` (or wherever the document data is gathered).

### 5.6.b — ThermalReceipt

Same pattern but on the 80mm format — sub-line in 10pt. Use `fmtDate`.

### 5.6.c — ExpandRow past invoices table

Already shows per-cycle invoices. For each invoice's breakdown, show per-line period. May need an additional API field: extend `GET /api/bookings/[id]/billing-history` to include `folioLineItem.serviceDate` and `periodEnd` per line item.

**Tests:** none required (display-only); verify visually in browser.

**Commit:** `feat(ui): per-line period display in InvoiceDocument + ThermalReceipt + ExpandRow`

---

## Task 5.7 — RecurringCharge management UI

**Files:**
- Create: `src/app/api/bookings/[id]/recurring-charges/route.ts` — GET (list) + POST (create)
- Create: `src/app/api/recurring-charges/[id]/route.ts` — DELETE (cancel)
- Modify: `src/app/(dashboard)/reservation/components/DetailPanel.tsx` — add section in the บิล tab (or new tab "บริการต่อเนื่อง")

### 5.7.a — API

`GET /api/bookings/[id]/recurring-charges` — list active + cancelled (with `?status=active` filter).
`POST /api/bookings/[id]/recurring-charges` — create. Body Zod:
```ts
z.object({
  chargeType:  z.enum(['EXTRA_SERVICE', 'OTHER']),
  description: z.string().min(1).max(200),
  amount:      z.number().positive().max(1_000_000),
  startDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes:       z.string().max(500).optional(),
})
```
Role: manager+ for POST, manager+/staff for GET. Wraps `createRecurringCharge`.

`DELETE /api/recurring-charges/[id]` — soft cancel. Body Zod: `{ reason?: string }`. Wraps `cancelRecurringCharge`. Role: manager+.

### 5.7.b — DetailPanel UI

In the booking detail panel, add a section (with header "🔁 บริการต่อเนื่อง") under the บิล tab. Show:

- Table of active recurring charges: description / amount/เดือน / startDate / endDate (or "ไม่จำกัด") / action ([🛑 cancel])
- "+ เพิ่มบริการ" button → opens a modal:
  - chargeType (radio EXTRA_SERVICE / OTHER)
  - description ("เช่า TV", "Internet", "ค่าบริการ")
  - amount (THB)
  - startDate (default today)
  - endDate (optional, default empty = forever)
  - notes
  - submit → POST

Cancel button → confirm dialog → DELETE → refetch.

Only show this section if `booking.bookingType !== 'daily'`.

**Commit:** `feat(api+ui): RecurringCharge management — list, add, cancel from DetailPanel`

---

## Task 5.8 — Display polish: period format "ถึง"

Quick wins for clarity throughout the app:

- `/billing-cycle` row period column: from `2026-05-12 – 2026-06-11` → `2026-05-12 ถึง 2026-06-11`
- ExpandRow past invoices: same
- EditDraftDialog: same
- InvoiceDocument / ThermalReceipt: same

This is a 1-line tweak in each render site. Use a helper `formatPeriod(start: Date, end: Date)` in `@/lib/date-format`:
```ts
export function formatPeriod(start: Date, end: Date): string {
  return `${fmtDate(start)} ถึง ${fmtDate(end)}`;
}
```

**Commit:** `style(billing): period format uses 'ถึง' for clarity`

---

## Execution order

Phase 5 has 8 tasks. Sub-tree of dependencies:

```
5.1 (schema) ──┬─→ 5.2 (recurring service + integrate)
               │
5.3 (per-line periodEnd) — independent, can run in parallel with 5.2
5.4 (edit period) — depends on 5.3 being merged for full effect, but mostly independent
5.5 (manual create) — independent
5.6 (display per-line) — depends on 5.3 having data to display
5.7 (recurring CRUD UI) — depends on 5.1 + 5.2
5.8 (period 'ถึง' polish) — independent, can run last
```

**Recommended dispatch order:**
1. 5.1 — schema first (1 commit)
2. 5.2 + 5.3 — combine in one implementer pass (service + per-line periodEnd)
3. 5.4 + 5.5 + 5.7 — APIs in second pass
4. 5.6 + 5.8 — display polish in third pass (UI only)
5. Cross-cutting E2E

---

## Risk / 7 invariants

- `RecurringCharge` is a new model — adds NO ledger postings on its own. Lines created in `generateDraftInvoice` flow through the SAME `addCharge → DRAFT → approveDraft → postInvoiceAccrual` path. Revenue leg correctness preserved.
- Edit-period auto-pro-rate touches Invoice.subtotal/grandTotal but only while `status='draft'` — no ledger touched.
- Manual generate-next reuses `generateDraftInvoice` — concurrency guard (booking row lock) already in place.

## Test coverage target

- Unit: `_verify-recurring-service.ts` (10+ assertions: overlap math, cancel, list)
- E2E: `e2e-recurring-in-cycle.ts` (full cycle with active recurring), `e2e-recurring-mid-stay.ts` (recurring starts mid-stay, pro-rate first cycle)
- API smoke: extend `e2e-api-billing-v2.ts` for the 3 new endpoints (recurring CRUD, generate-next, edit-period)

---

## Out of scope (defer to Phase 6 / later)

- **Modify** an existing recurring charge (only create + cancel-and-recreate today)
- **Bulk** add recurring across multiple bookings
- **Templates** — predefined "เช่า TV", "Internet" preset that fills the form
- **Auto-link to Contract** — Contract has `phoneRate` etc., a future iteration may auto-create a recurring "ค่าโทรศัพท์" from Contract values
- **Indexing / search** — recurring list page across all bookings (current: per-booking only)
