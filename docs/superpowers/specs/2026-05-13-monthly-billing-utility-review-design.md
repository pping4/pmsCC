# Monthly Billing + Utility — Manager Review Workflow

> **Status:** Draft (awaiting user review)
> **Author:** brainstormed 2026-05-13
> **Target branch:** `feat/receipt-standardization` (or a fresh `feat/monthly-billing-v2`)
> **Approach chosen:** C — daily cron generates **draft invoices** → manager reviews on `/billing-cycle` → bulk approve commits ledger.

---

## 1. Problem

The current monthly billing pipeline cannot produce a correct invoice for a
**monthly-short (วันชนวัน)** stay and has no path to attach **utility readings**
to monthly invoices automatically. Observable consequences today:

- `BK-2026-0005` (monthly_short, ฿15,000/เดือน, 12 พ.ค.–11 ก.ค.) shows
  *"รวมทั้งสิ้น ฿900,000"* (60 × 15,000) instead of ฿30,000 (2 × 15,000) —
  fixed cosmetically at [DetailPanel.tsx:1063+](../../../src/app/(dashboard)/reservation/components/DetailPanel.tsx), but the
  underlying engine still doesn't know how to bill rolling cycles.
- `/api/billing/generate-monthly` runs as one batch using
  `nextBillingDate(checkInDate, …)` for ALL monthly bookings, ignoring the
  fact that `Contract.billingCycle` could be `calendar` (sum-of-month) vs
  `rolling` (day-to-day).
- `UtilityReading` is keyed `[roomId, month]` (calendar-month) — no slot to
  hold a reading taken between cycles for a rolling booking, and no flow that
  pulls the latest reading into a draft invoice.

The fix needs to land before any monthly_short stay graduates from "deposit
collected" to "first month's rent invoice" — currently no production rolling
stay is being billed correctly.

## 2. Business rules (confirmed in brainstorm)

| Rule | Resolution |
|---|---|
| `BookingType` ↔ `Contract.billingCycle` mapping | **Deterministic**: `monthly_short` → `rolling`, `monthly_long` → `calendar`. Booking type is the single source of truth; `Contract.billingCycle` becomes derived (set at draft creation, immutable thereafter). |
| Invoice timing | **Rent paid in advance, utility billed in arrears, one invoice combining both.** Bill is cut ~1 day before the next cycle starts. |
| Meter reading workflow | Admin/staff records a reading **whenever** (no calendar boundary enforced). Each draft invoice picks the latest reading per room before the bill date, diffs against the reading used on the previous invoice. |
| Last partial cycle | **Pro-rate by day count.** A stay of 2.5 cycles produces 3 invoices: 2 full + 1 partial; the partial covers the actual days lived + utility for those days. |
| Trigger | **Daily cron** generates drafts → manager reviews on `/billing-cycle` → bulk approve. No auto-post. |
| Reading missing at bill time | **Block approval of that single row** (warning chip in UI). Other draft rows still approvable. Operator must record reading → row clears the warning → row becomes approvable. |
| Contract required? | **No** for billing to function. Booking-level `rate` + RoomRate fallback works without a Contract. Contract adds lock-in, late fee schedule, custom utility rates. |
| VAT on monthly rent | Out of scope for this spec — current code treats monthly rent as `taxType=no_tax`. If VAT is needed it lands in a follow-up. |
| Other extras (laundry/minibar/parking) | Continue to use existing `add-service` flow → `INV-EX` immediately. **Not bundled** into monthly draft. |

## 3. Architecture

```
                 ┌─────────────────────────────────────────────────┐
                 │ cron (1×/day, 02:00)                            │
                 │ scripts/cron/generate-monthly-drafts.ts         │
                 └─────────────────────────────────────────────────┘
                                  │
                                  │ for each checked_in monthly booking
                                  ▼
            ┌────────────────────────────────────────────┐
            │ billing.service: generateDraftInvoice(tx)  │
            │  - resolve next period (rolling | calendar) │
            │  - read latest UtilityReading (lazy)        │
            │  - compute rent + water + electric          │
            │  - upsert Invoice(status='draft')           │
            │    + FolioLineItem(billingStatus='DRAFT')   │
            │    NO LEDGER POSTING                        │
            └────────────────────────────────────────────┘
                                  │
                                  ▼
              ┌────────────────────────────────────────┐
              │ /billing-cycle review UI (Phase 2)     │
              │  - DataTable of drafts                 │
              │  - per-row expand → history + readings │
              │  - bulk Approve → POST /approve-batch  │
              └────────────────────────────────────────┘
                                  │
                                  │ on approve (manager+)
                                  ▼
       ┌──────────────────────────────────────────────────────┐
       │ POST /api/billing/drafts/approve  (transactional)    │
       │  - flip Invoice.status='draft' → 'unpaid'            │
       │  - flip FolioLineItem.billingStatus='DRAFT'→'BILLED' │
       │  - postLedgerPair(DR AR / CR REVENUE) + utility legs │
       │  - emit ActivityLog(category='billing', …)           │
       └──────────────────────────────────────────────────────┘
```

**Two key invariants:**
- Draft invoice **never** posts a ledger entry. Folio totals do not change
  until approval. This protects the 7 phase-handoff invariants.
- Approval is **idempotent at the invoice level** — re-clicking approve on an
  already-approved invoice is a no-op (not a duplicate post). Enforced via
  `Invoice.status` guard inside the tx.

## 4. Schema changes

All changes additive or migration-safe. No data loss.

### 4.1 `Invoice` — add `draft` status

```prisma
enum InvoiceStatus {
  draft       // NEW — generated by cron, awaiting manager approval, NO ledger
  unpaid      // existing
  partial     // existing
  paid        // existing
  overdue     // existing
  voided      // existing
  cancelled   // existing
}
```

Default unchanged. Existing code that checks `status='unpaid'` continues to
work (drafts simply aren't in that set yet).

### 4.2 `FolioLineItem.billingStatus` — add `DRAFT`

```prisma
enum BillingStatus {
  DRAFT      // NEW — attached to a draft Invoice, not yet committed to ledger
  UNBILLED
  BILLED
  PAID
  VOIDED
}
```

Approval flips `DRAFT → BILLED`. Reject flips `DRAFT → VOIDED` (with reason).

### 4.3 `BillingPeriod` (new) — per-booking immutable log

```prisma
model BillingPeriod {
  id              String    @id @default(uuid())
  bookingId       String    @map("booking_id")
  cycleIndex      Int       @map("cycle_index")     // 1, 2, 3, ...
  periodStart     DateTime  @db.Date @map("period_start")
  periodEnd       DateTime  @db.Date @map("period_end")  // inclusive
  isPartial       Boolean   @default(false) @map("is_partial")
  isFinal         Boolean   @default(false) @map("is_final")
  invoiceId       String?   @unique @map("invoice_id")   // nullable while draft
  createdAt       DateTime  @default(now())

  booking         Booking   @relation(fields: [bookingId], references: [id])
  invoice         Invoice?  @relation(fields: [invoiceId], references: [id])

  @@unique([bookingId, cycleIndex])
  @@index([periodStart])
  @@map("billing_periods")
}
```

**Why:** authoritative log of "what period was billed in which invoice".
Lets the cron answer "what's the next period for this booking" without
re-walking history every run, and gives the review-history UI a stable
key per cycle.

### 4.4 `UtilityReading` — broaden scope, deprecate `month` uniqueness

```prisma
model UtilityReading {
  id           String    @id @default(uuid())
  roomId       String    @map("room_id")
  bookingId    String?   @map("booking_id")          // NEW — links the reading to a stay
  readingDate  DateTime  @db.Date @map("reading_date") // NEW — when the meter was actually read
  month        String?   // KEEP for backward-compat; new readings may omit it
  currWater    Decimal   @default(0) @db.Decimal(10, 2)
  currElectric Decimal   @default(0) @db.Decimal(10, 2)
  prevWater    Decimal   @default(0) @db.Decimal(10, 2)  // computed at read-time from prior reading
  prevElectric Decimal   @default(0) @db.Decimal(10, 2)
  waterRate    Decimal   @default(18) @db.Decimal(10, 2)
  electricRate Decimal   @default(8)  @db.Decimal(10, 2)
  notes        String?
  recordedBy   String?   @map("recorded_by")          // NEW — user ref
  recordedAt   DateTime? @map("recorded_at")
  createdAt    DateTime  @default(now())

  room         Room      @relation(fields: [roomId], references: [id])
  booking      Booking?  @relation(fields: [bookingId], references: [id])

  // Replace [roomId, month] with: at most one reading per room per calendar day.
  // Multiple readings allowed across the booking lifecycle.
  @@unique([roomId, readingDate])
  @@index([bookingId, readingDate])
  @@index([roomId, readingDate])
  @@map("utility_readings")
}
```

**Migration:** keep existing rows by backfilling `readingDate := first-of(month)`
when the new col is null. The old `[roomId, month]` unique is dropped in the
same migration; replaced by `[roomId, readingDate]`. The `month` column
remains nullable for reads of legacy data.

### 4.5 `Contract.billingCycle` — derive from `Booking.bookingType`

No schema change; document that contract.service must set it deterministically
at draft creation. Add a CHECK constraint as a follow-up if drift becomes a
concern. Today the codebase already implies the mapping but doesn't enforce
it — we tighten in the `createDraft` service function.

## 5. Service layer

### 5.1 New: `billing.service.ts: generateDraftInvoice(tx, input)`

Replaces today's `generateMonthlyInvoice` for the cron path. Two strategies
selected by `bookingType`:

```ts
function resolveNextPeriod(b: Booking, cycleIndex: number): { start, end, isPartial } {
  if (b.bookingType === 'monthly_short') {       // rolling
    const dayOfMonth = b.checkIn.getDate();
    const start = (cycleIndex === 1) ? b.checkIn
                                     : addMonths(b.checkIn, cycleIndex - 1);
    const tentativeEnd = addMonths(start, 1).minus(1 day);
    const end = min(tentativeEnd, b.checkOut.minus(1 day));
    return { start, end, isPartial: end < tentativeEnd };
  }
  if (b.bookingType === 'monthly_long') {        // calendar
    let start: Date, end: Date;
    if (cycleIndex === 1) {
      start = b.checkIn;
      end   = min(endOfMonth(b.checkIn), b.checkOut.minus(1 day));
    } else {
      const baseMonth = addMonths(startOfMonth(b.checkIn), cycleIndex - 1);
      start = baseMonth;
      end   = min(endOfMonth(baseMonth), b.checkOut.minus(1 day));
    }
    return { start, end, isPartial: end < endOfMonth(start) || start > startOfMonth(start) };
  }
  throw new Error('NOT_MONTHLY');
}
```

Then for the chosen period:

1. Query `BillingPeriod[bookingId, cycleIndex]` — if exists with an invoice,
   skip (idempotent).
2. Compute **rent** charge:
   - Full month → `monthlyRate`.
   - Partial → `(days / daysInMonth(start)) * monthlyRate`, rounded to 2dp.
3. Compute **utility** charges (skipped for cycleIndex=1 — no prior reading):
   - `prev = UtilityReading.findFirst({bookingId, readingDate ≤ priorPeriodStart, orderBy desc})`
   - `curr = UtilityReading.findFirst({bookingId, readingDate ≤ thisPeriodStart, orderBy desc})`
   - Water: `(curr.water - prev.water) * waterRate`; if Contract has
     `waterRateMin`, apply min charge if usage × rate < min.
   - Electric: `(curr.electric - prev.electric) * electricRate`.
   - **If `curr` is missing,** the row is still created with `utility=null` and
     a flag `needsReading=true` (Invoice schema gains a transient flag, or
     stored on `BillingPeriod`); UI shows ⚠️ and approval is blocked.
4. Create `Invoice(status='draft')` + `FolioLineItem(billingStatus='DRAFT')`
   for each charge, link via `BillingPeriod`.
5. **No ledger post.** No `recalculateFolioBalance`. Folio totals are NOT
   touched on draft creation.

### 5.2 New: `billing.service.ts: approveDraft(tx, invoiceId, userRef)`

```
1. Lock Invoice row FOR UPDATE; reject if status !== 'draft'.
2. Flip Invoice.status → 'unpaid'; FolioLineItem.billingStatus → 'BILLED'.
3. Call recalculateFolioBalance(tx, folioId).
4. postLedgerPair(tx) — DR 1140-01 AR / CR 4110-01 Revenue (rent) + CR utility revenue accounts (need new accounts? see §10).
5. logActivity(tx, 'billing.approved', …) referencing BillingPeriod.id.
```

### 5.3 New: `billing.service.ts: rejectDraft(tx, invoiceId, reason, userRef)`

```
1. Lock Invoice row FOR UPDATE; reject if status !== 'draft'.
2. Flip Invoice.status → 'voided'; FolioLineItem.billingStatus → 'VOIDED'.
3. NO ledger post (no posting ever happened).
4. Set BillingPeriod.invoiceId = null so the next cron run can re-attempt.
5. logActivity(tx, 'billing.rejected', { reason }, …).
```

### 5.4 New: `utility.service.ts` (new file)

Houses reading entry + history lookup:
- `recordReading(tx, { roomId, bookingId, readingDate, water, electric, notes, recordedBy })`
  - Compute `prev*` from previous reading on same room.
  - Throw if `readingDate > today` (sanity).
- `getReadingsForBooking(tx, bookingId)`
- `getLatestReadingBefore(tx, roomId, date)` (used by `generateDraftInvoice`)

## 6. API endpoints

| Method | Path | Role | Purpose |
|---|---|---|---|
| `POST` | `/api/cron/billing-draft` | system cron token | trigger draft generation for all eligible bookings (idempotent) |
| `GET`  | `/api/billing/drafts` | manager+ | list drafts for `/billing-cycle` review |
| `GET`  | `/api/billing/drafts/[id]` | manager+ | single draft + billing history of that booking |
| `POST` | `/api/billing/drafts/approve` | manager+ | body `{ invoiceIds: string[] }` — bulk approve in one tx |
| `POST` | `/api/billing/drafts/[id]/reject` | manager+ | body `{ reason }` |
| `POST` | `/api/billing/drafts/[id]/edit` | manager+ | body `{ rentAmount?, waterUsage?, electricUsage?, notes? }` — edit before approve |
| `POST` | `/api/utility-readings` | manager+ / staff | record new reading (manual entry, any day) |
| `GET`  | `/api/bookings/[id]/billing-history` | manager+ | invoices + payments + readings for expand row (lazy-loaded) |

Auth via `getServerSession + requireRole`. All mutation routes wrapped in
`prisma.$transaction`. All inputs Zod-validated.

## 7. UI

### 7.1 `/billing-cycle` — Manager Review Table

Located at `src/app/(dashboard)/billing-cycle/page.tsx` (already exists as a
stub — fold in here). Built on the shared `<DataTable>` component (CLAUDE.md
§5 — required).

**Columns** (per the v2 mockup):
- Checkbox (select)
- ห้อง / แขก / contract # (clickable → expand row)
- Cycle badge (`rolling` amber / `calendar` purple)
- รอบบิล (`12 พ.ค.–11 มิ.ย.`)
- ค่าห้อง, น้ำ, ไฟ, รวม (right-aligned)
- พฤติกรรม (avg days late from prior bills — `✓ ตรงเวลา` / `⚠️ จ่ายช้า · เฉลี่ย +N วัน`)
- Action (✏️ edit)

**Bulk bar** (sticky on top when ≥ 1 selected):
- Count + ยอดรวม
- ✅ Approve, ❌ Reject, 📋 ดูบิลรวม (PDF preview), Export CSV

**Expand row** content (lazy-loaded from `/api/bookings/[id]/billing-history`):
- 5-card summary strip — เข้าพัก, มัดจำสถานะ, จำนวนบิลที่ออกแล้ว, ยอดค้างชำระ, จ่ายตรงเฉลี่ย
- Past invoices table — รอบ, บิลเลขที่, breakdown, paid amount, paid date, days late, status
- Meter reading history — date, recorder, water/electric units, notes
- Quick links — เปิด booking detail, ดูสัญญา, จด reading

**Guards:**
- Row with missing reading shows ⚠️ chip + amber background; checkbox disabled
  unless reading recorded. Bulk approve filters out blocked rows
  automatically with a toast count.

### 7.2 `/utility-readings/new` modal

Reuse from any row's "📊 จด reading" action. Accessible standalone too.
Fields: room, reading date, water, electric, notes. Submit → `POST
/api/utility-readings`.

### 7.3 No changes needed in DetailPanel (this iteration)

The estimate `~2 เดือน` shown today remains acceptable until billing-history
endpoint is wired in. A follow-up spec can replace `nights/30` with a real
"based on contract" total once `BillingPeriod` rows exist.

## 8. Cron job

- **Where:** `scripts/cron/generate-monthly-drafts.ts` (new), invoked by host
  cron (Railway/Render — see `render.yaml`) at 02:00 daily.
- **Behavior:** for each `Booking` with `bookingType ∈ {monthly_short,
  monthly_long}` AND `status='checked_in'`, compute `nextDueDate` from the
  highest existing `BillingPeriod.cycleIndex`; if `nextDueDate − 1 day ≤
  today`, run `generateDraftInvoice`. Idempotent on (bookingId, cycleIndex).
- **Lock:** wrap each booking in `prisma.$transaction` + `SELECT FOR UPDATE`
  on the booking row to prevent two cron runs colliding.
- **Failure mode:** on per-booking error, log to `ActivityLog(severity=error)`
  and continue. Exit code 0 unless every booking failed.

## 9. Migration / rollout

Order matters — schema changes must land before code that reads them.

1. **Migration A** — additive: `BillingPeriod` table, `InvoiceStatus.draft`,
   `BillingStatus.DRAFT`, `UtilityReading` extensions (new cols, indexes;
   keep old uniqueness for now to avoid existing-row conflicts).
2. **Backfill** — `scripts/backfill-billing-periods.ts` walks every existing
   monthly invoice and writes a matching `BillingPeriod` row (preserving the
   historical link so cron doesn't re-bill paid cycles).
3. **Code rollout** — ship new services + APIs behind a feature flag
   (`BILLING_V2_ENABLED` env). Old `/api/billing/generate-monthly` still
   works during dual-write window.
4. **Migration B** — once verified: drop the old `[roomId, month]`
   `UtilityReading` unique index; cron-only path enabled by default; old
   batch endpoint marked deprecated (warns in response header).
5. **Migration C** — after a full cycle of validation: remove the deprecated
   endpoint.

## 10. Open questions (parked — answered in follow-up spec or by user)

These do not block landing this design — but each will surface during implementation:

1. **Chart of accounts for utility** — currently `4110-01 รายได้ค่าห้องพัก`
   covers rent. Need `4120-01 รายได้ค่าน้ำ` + `4121-01 รายได้ค่าไฟ` (or one
   `4120-01 รายได้ค่าสาธารณูปโภค`). Decide before service §5.2 ships.
2. **Late fee posting** — Contract has `lateFeeSchedule` (tiered per day).
   Where do we post when bill is overdue? Append to next month's draft as a
   `PENALTY` charge? Or auto-cut `INV-PEN` on overdue trigger? Today's
   `billing.service.ts` has `generatePenaltyInvoiceNumber` — direction unclear.
3. **Initial reading at check-in** — no explicit flow today. Recommendation:
   include a "จดเลขมิเตอร์เริ่มต้น" step in `/checkin` for monthly bookings.
   Out of scope here, but the absence will cause cycle-2 utility to compute
   wrong unless caught.
4. **Final reading at checkout** — same as above for the close.
5. **VAT (ภพ.30) on monthly rent** — currently `no_tax`. If property is
   VAT-registered for long-stay rentals, this is incorrect.
6. **Lock-in enforcement on early termination** — `Contract.lockInMonths` +
   `earlyTerminationRule` already in schema; the termination flow at
   `/contracts/[id]/terminate` consumes them but the **billing** side doesn't
   know to stop generating drafts after a `terminated` contract. Easy fix:
   skip bookings whose linked contract status is `terminated`.

## 11. Out of scope (explicit non-goals for this spec)

- Yearly contracts / `quarterly` billing cycle — not used today.
- Multi-currency — THB only.
- Auto-email/SMS of approved invoices — manual download/print today.
- Tax invoice (ใบกำกับภาษี) numbering separate from receipt — already handled
  in `invoice-number.service.ts`.
- The 3 follow-up items from the code review (P2034 retry / lock-order doc /
  integration test for drag-resize race) — those land in a separate
  concurrency-hardening spec.

## 12. Test coverage

E2E harnesses (`scripts/e2e-*.ts` pattern matching existing harnesses):

| Script | Asserts |
|---|---|
| `e2e-rolling-cycle.ts` | 2.5-month rolling stay: 3 draft invoices in correct periods, partial last cycle pro-rated, reading diff math, approval posts ledger pair, idempotent approve. |
| `e2e-calendar-cycle.ts` | Same shape but for monthly_long with calendar anchoring. |
| `e2e-reading-missing.ts` | Cron creates draft with `needsReading=true`; manager approve returns 422; after `POST /api/utility-readings`, draft becomes approvable. |
| `e2e-bulk-approve.ts` | Bulk approve of mixed (rolling + calendar) drafts in one tx; one row blocked by missing reading is skipped; remaining 2 commit. |
| `e2e-draft-reject.ts` | Reject draft → `BillingPeriod.invoiceId` cleared; next cron run regenerates same period without P2002. |

Existing E2E (Phase 1–6 harnesses) must continue to pass — schema changes
are additive so this is the safety net.

## 13. Risk register

| Risk | Mitigation |
|---|---|
| Concurrent cron + manual approval racing on same draft | Approve path takes `SELECT FOR UPDATE` on Invoice row; cron does the same per booking |
| Migration drops `[roomId, month]` unique → app reads stale code expecting the constraint | Code change ships **before** Migration B; constraint drop is the final step |
| Manager approves a draft with wrong utility numbers (typo in reading) | Reading is editable up until approval; expanded history row shows prior consumption so anomalies are visible |
| `monthly_short` booking with `Contract.billingCycle = calendar` (drift) | `createDraft` enforces match; existing rows audited by `scripts/audit-contract-cycle-mismatch.ts` (one-off) |
| Performance: 200+ bookings × 30 days history per row | `/api/bookings/[id]/billing-history` is lazy-loaded only on expand; main table query stays cheap |

---

## Implementation plan (placeholder — to be authored next)

Per the brainstorming workflow, the next step is to invoke the `writing-plans`
skill to produce a step-by-step implementation plan from this design. Plan
will be saved to `docs/superpowers/plans/2026-05-13-monthly-billing-utility-plan.md`.
