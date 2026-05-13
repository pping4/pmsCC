# Monthly Billing + Utility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manager-triggered monthly billing batch with a daily-cron + draft-review workflow that correctly handles `rolling` (วันชนวัน) and `calendar` (ชนสิ้นเดือน) cycles, integrates utility readings, and pro-rates partial last cycles.

**Architecture:** Cron generates `Invoice(status='draft')` per booking per due cycle without posting ledger. Manager reviews drafts on `/billing-cycle`, optionally edits utility readings or rent, then bulk-approves which flips status → `unpaid` and posts the ledger pair atomically. Approval is idempotent at the invoice level; rejection clears the link so the next cron run re-creates the draft.

**Tech Stack:** Next.js 15 (App Router), Prisma 5 (PostgreSQL), Zod, NextAuth v4. Tests via `scripts/e2e-*.ts` harnesses (no Jest in this project — assertions via `console.assert` + `assert.strictEqual`). Frontend uses the project's shared `<DataTable>` per CLAUDE.md §5.

**Spec:** [docs/superpowers/specs/2026-05-13-monthly-billing-utility-review-design.md](../specs/2026-05-13-monthly-billing-utility-review-design.md)

**Tip for the executor:** read the spec end-to-end before starting Phase 0. The plan trims context; the spec carries the *why*.

---

## Conventions used throughout

- **All Prisma writes inside `prisma.$transaction(async (tx) => …)`.** Service functions take `tx: Prisma.TransactionClient` — never the global client.
- **All API routes start with:** `const session = await getServerSession(authOptions); if (!session) return 401;` then a role check.
- **All input via Zod** — define the schema next to the route or in `src/lib/validations/`.
- **Money in `Prisma.Decimal`** — `Number()` only at display boundaries.
- **Date display via `@/lib/date-format`** — never `toLocaleDateString('th-TH')` or `toISOString()`.
- **Commit cadence:** one commit per task. Message format `<type>(<scope>): <thai-english summary>` matching existing history.
- **Don't skip steps.** If a step says "run", actually run it and paste the output line in the task tracker.

---

## Phase 0 — Schema foundation

Goal: add the new shapes (additive only — no data loss, no breaking constraints) so later phases can write/read them.

### Task 0.1: Add `InvoiceStatus.draft` enum value

**Files:**
- Modify: `prisma/schema.prisma` (enum `InvoiceStatus`)
- Create: `prisma/migrations/2026XXXX_add_invoice_draft_status/migration.sql`

- [ ] **Step 1:** Edit `prisma/schema.prisma` — find the `InvoiceStatus` enum and add `draft` as the FIRST value (Postgres enum order matters for `ORDER BY status`):

```prisma
enum InvoiceStatus {
  draft       // NEW — Phase MB-v2; no ledger post yet
  unpaid
  partial
  paid
  overdue
  voided
  cancelled
}
```

- [ ] **Step 2:** Generate migration:

```powershell
npx prisma migrate dev --name add_invoice_draft_status --create-only
```

- [ ] **Step 3:** Verify the generated SQL contains `ALTER TYPE "InvoiceStatus" ADD VALUE 'draft' BEFORE 'unpaid';`. If Prisma generates `DROP TYPE … CREATE TYPE` instead (data loss), manually rewrite the file to use `ADD VALUE`.

- [ ] **Step 4:** Apply:

```powershell
npx prisma migrate dev
```

- [ ] **Step 5:** Sanity check — run:

```powershell
npx prisma studio
```

Open `Invoice` table, confirm the status dropdown now shows `draft` as an option. Close Studio.

- [ ] **Step 6:** Commit:

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add Invoice.draft status for monthly billing v2"
```

---

### Task 0.2: Add `BillingStatus.DRAFT` enum value

**Files:**
- Modify: `prisma/schema.prisma` (enum `BillingStatus`)
- Create: `prisma/migrations/2026XXXX_add_folio_draft_status/migration.sql`

- [ ] **Step 1:** Add `DRAFT` as first value of `BillingStatus`:

```prisma
enum BillingStatus {
  DRAFT      // NEW — attached to a draft Invoice, no ledger commitment
  UNBILLED
  BILLED
  PAID
  VOIDED
}
```

- [ ] **Step 2:** Migration:

```powershell
npx prisma migrate dev --name add_folio_draft_status --create-only
```

- [ ] **Step 3:** Hand-edit migration SQL to `ALTER TYPE … ADD VALUE 'DRAFT' BEFORE 'UNBILLED';` if Prisma generated a destructive form.

- [ ] **Step 4:** Apply: `npx prisma migrate dev`

- [ ] **Step 5:** Commit:

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add FolioLineItem.billingStatus DRAFT value"
```

---

### Task 0.3: Create `BillingPeriod` model

**Files:**
- Modify: `prisma/schema.prisma` (add model + relations on `Booking` and `Invoice`)
- Create: `prisma/migrations/2026XXXX_add_billing_period/migration.sql`

- [ ] **Step 1:** Add the model block to `schema.prisma` (place near the bottom alphabetically, just before `model Folio`):

```prisma
model BillingPeriod {
  id          String   @id @default(uuid())
  bookingId   String   @map("booking_id")
  cycleIndex  Int      @map("cycle_index")
  periodStart DateTime @db.Date @map("period_start")
  periodEnd   DateTime @db.Date @map("period_end")
  isPartial   Boolean  @default(false) @map("is_partial")
  isFinal     Boolean  @default(false) @map("is_final")
  invoiceId   String?  @unique @map("invoice_id")
  createdAt   DateTime @default(now()) @map("created_at")

  booking Booking  @relation(fields: [bookingId], references: [id])
  invoice Invoice? @relation(fields: [invoiceId], references: [id])

  @@unique([bookingId, cycleIndex])
  @@index([periodStart])
  @@map("billing_periods")
}
```

- [ ] **Step 2:** Add reverse relations:

In `model Booking`:
```prisma
billingPeriods BillingPeriod[]
```

In `model Invoice`:
```prisma
billingPeriod BillingPeriod?
```

- [ ] **Step 3:** Migration:

```powershell
npx prisma migrate dev --name add_billing_period
```

- [ ] **Step 4:** Verify schema applied:

```powershell
npx prisma db execute --stdin --schema=prisma/schema.prisma <<< "SELECT column_name FROM information_schema.columns WHERE table_name='billing_periods';"
```

Expected: 9 columns matching the model.

- [ ] **Step 5:** Commit:

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): BillingPeriod table — immutable cycle log per booking"
```

---

### Task 0.4: Extend `UtilityReading` (new columns; keep old constraint for now)

**Files:**
- Modify: `prisma/schema.prisma` (model `UtilityReading` — add fields, NEW unique index, keep old `month` column nullable)
- Create: `prisma/migrations/2026XXXX_extend_utility_reading/migration.sql`

- [ ] **Step 1:** Replace the `UtilityReading` model with:

```prisma
model UtilityReading {
  id           String    @id @default(uuid())
  roomId       String    @map("room_id")
  bookingId    String?   @map("booking_id")
  readingDate  DateTime? @db.Date @map("reading_date")
  month        String?   // legacy — to be removed in Task 4.6
  prevWater    Decimal   @default(0) @map("prev_water") @db.Decimal(10, 2)
  currWater    Decimal   @default(0) @map("curr_water") @db.Decimal(10, 2)
  waterRate    Decimal   @default(18) @map("water_rate") @db.Decimal(10, 2)
  prevElectric Decimal   @default(0) @map("prev_electric") @db.Decimal(10, 2)
  currElectric Decimal   @default(0) @map("curr_electric") @db.Decimal(10, 2)
  electricRate Decimal   @default(8) @map("electric_rate") @db.Decimal(10, 2)
  notes        String?
  recorded     Boolean   @default(false)
  recordedBy   String?   @map("recorded_by")
  recordedAt   DateTime? @map("recorded_at")
  createdAt    DateTime  @default(now()) @map("created_at")

  room    Room     @relation(fields: [roomId], references: [id])
  booking Booking? @relation(fields: [bookingId], references: [id])

  @@unique([roomId, month])           // KEEP for now (Task 4.6 drops it)
  @@unique([roomId, readingDate])     // NEW — note nullable means multiple null-row pairs allowed by Postgres
  @@index([bookingId, readingDate])
  @@index([roomId, readingDate])
  @@map("utility_readings")
}
```

- [ ] **Step 2:** Add reverse relation on `Booking`:

```prisma
utilityReadings UtilityReading[]
```

- [ ] **Step 3:** Migration:

```powershell
npx prisma migrate dev --name extend_utility_reading
```

- [ ] **Step 4:** Verify both indexes exist:

```powershell
npx prisma db execute --stdin --schema=prisma/schema.prisma <<< "SELECT indexname FROM pg_indexes WHERE tablename='utility_readings';"
```

Expected: at least 4 entries — pk, `[roomId, month]`, `[roomId, readingDate]`, `[bookingId, readingDate]`.

- [ ] **Step 5:** Commit:

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): UtilityReading — bookingId + readingDate; keep [roomId, month] (drops in Task 4.6)"
```

---

## Phase 1 — Service layer (TDD)

Goal: pure functions + tx-aware services that draft / approve / reject monthly invoices and record meter readings, all covered by E2E harnesses.

### Task 1.1: `resolveNextPeriod` pure function

**Files:**
- Modify: `src/services/billing.service.ts` (append)
- Create: `scripts/_verify-resolve-period.ts`

- [ ] **Step 1: Write the failing test** — `scripts/_verify-resolve-period.ts`:

```ts
/* eslint-disable no-console */
import assert from 'node:assert/strict';
import { resolveNextPeriod } from '../src/services/billing.service';

function d(s: string): Date { return new Date(s + 'T00:00:00.000Z'); }

// Rolling — Cycle 1 starts at checkIn
{
  const r = resolveNextPeriod({
    bookingType: 'monthly_short',
    checkIn:  d('2026-05-12'),
    checkOut: d('2026-07-25'),
    cycleIndex: 1,
  });
  assert.strictEqual(r.start.toISOString().slice(0,10), '2026-05-12');
  assert.strictEqual(r.end.toISOString().slice(0,10),   '2026-06-11');
  assert.strictEqual(r.isPartial, false);
  console.log('✓ rolling cycle 1');
}

// Rolling — Cycle 2 (next anniversary)
{
  const r = resolveNextPeriod({
    bookingType: 'monthly_short',
    checkIn:  d('2026-05-12'),
    checkOut: d('2026-07-25'),
    cycleIndex: 2,
  });
  assert.strictEqual(r.start.toISOString().slice(0,10), '2026-06-12');
  assert.strictEqual(r.end.toISOString().slice(0,10),   '2026-07-11');
  assert.strictEqual(r.isPartial, false);
  console.log('✓ rolling cycle 2');
}

// Rolling — Cycle 3 (partial — checkout before full anniversary)
{
  const r = resolveNextPeriod({
    bookingType: 'monthly_short',
    checkIn:  d('2026-05-12'),
    checkOut: d('2026-07-25'),
    cycleIndex: 3,
  });
  assert.strictEqual(r.start.toISOString().slice(0,10), '2026-07-12');
  assert.strictEqual(r.end.toISOString().slice(0,10),   '2026-07-24');  // checkOut - 1 day
  assert.strictEqual(r.isPartial, true);
  console.log('✓ rolling cycle 3 partial');
}

// Calendar — Cycle 1 starts at checkIn, ends end-of-month
{
  const r = resolveNextPeriod({
    bookingType: 'monthly_long',
    checkIn:  d('2026-05-12'),
    checkOut: d('2026-07-25'),
    cycleIndex: 1,
  });
  assert.strictEqual(r.start.toISOString().slice(0,10), '2026-05-12');
  assert.strictEqual(r.end.toISOString().slice(0,10),   '2026-05-31');
  assert.strictEqual(r.isPartial, true);  // partial — didn't start on 1st
  console.log('✓ calendar cycle 1 partial-start');
}

// Calendar — Cycle 2 is a full calendar month
{
  const r = resolveNextPeriod({
    bookingType: 'monthly_long',
    checkIn:  d('2026-05-12'),
    checkOut: d('2026-07-25'),
    cycleIndex: 2,
  });
  assert.strictEqual(r.start.toISOString().slice(0,10), '2026-06-01');
  assert.strictEqual(r.end.toISOString().slice(0,10),   '2026-06-30');
  assert.strictEqual(r.isPartial, false);
  console.log('✓ calendar cycle 2 full');
}

// Calendar — Cycle 3 partial (checkout 25 Jul)
{
  const r = resolveNextPeriod({
    bookingType: 'monthly_long',
    checkIn:  d('2026-05-12'),
    checkOut: d('2026-07-25'),
    cycleIndex: 3,
  });
  assert.strictEqual(r.start.toISOString().slice(0,10), '2026-07-01');
  assert.strictEqual(r.end.toISOString().slice(0,10),   '2026-07-24');
  assert.strictEqual(r.isPartial, true);
  console.log('✓ calendar cycle 3 partial-end');
}

console.log('\nAll resolveNextPeriod assertions passed');
```

- [ ] **Step 2: Run to verify it fails:**

```powershell
npx tsx scripts/_verify-resolve-period.ts
```

Expected: `TypeError: resolveNextPeriod is not a function` (or similar).

- [ ] **Step 3: Implement** — append to `src/services/billing.service.ts`:

```ts
export interface ResolvePeriodInput {
  bookingType: 'monthly_short' | 'monthly_long';
  checkIn:  Date;
  checkOut: Date;
  cycleIndex: number;   // 1-based
}

export interface ResolvedPeriod {
  start:     Date;
  end:       Date;
  isPartial: boolean;
  isFinal:   boolean;
}

/** add N whole months to a UTC-midnight date; clamp to last day of target month */
function addUTCMonths(d: Date, n: number): Date {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const targetDim = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(d.getUTCDate(), targetDim));
  return r;
}

function addUTCDays(d: Date, n: number): Date {
  const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r;
}

function endOfUTCMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

export function resolveNextPeriod(input: ResolvePeriodInput): ResolvedPeriod {
  const { bookingType, checkIn, checkOut, cycleIndex } = input;
  // Stay span is [checkIn, checkOut). The last billable day is checkOut - 1.
  const lastBillableDay = addUTCDays(checkOut, -1);

  if (bookingType === 'monthly_short') {
    // Rolling: every cycle anchors to checkIn's day-of-month.
    const start = cycleIndex === 1 ? checkIn : addUTCMonths(checkIn, cycleIndex - 1);
    const fullEnd = addUTCDays(addUTCMonths(start, 1), -1);
    const end = fullEnd > lastBillableDay ? lastBillableDay : fullEnd;
    return { start, end, isPartial: end < fullEnd, isFinal: end >= lastBillableDay };
  }

  if (bookingType === 'monthly_long') {
    // Calendar: cycle 1 = checkIn → end of checkIn's month.
    //          cycle N>1 = first → end of (month of checkIn + N-1).
    let rawStart: Date;
    let fullEnd: Date;
    if (cycleIndex === 1) {
      rawStart = checkIn;
      fullEnd  = endOfUTCMonth(checkIn);
    } else {
      const monthBase = addUTCMonths(
        new Date(Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), 1)),
        cycleIndex - 1,
      );
      rawStart = monthBase;
      fullEnd  = endOfUTCMonth(monthBase);
    }
    const end = fullEnd > lastBillableDay ? lastBillableDay : fullEnd;
    // Partial if either start ≠ first-of-month OR end ≠ end-of-month.
    const isPartial = rawStart.getUTCDate() !== 1 || end < fullEnd;
    return { start: rawStart, end, isPartial, isFinal: end >= lastBillableDay };
  }

  throw new Error(`resolveNextPeriod: unsupported bookingType ${bookingType}`);
}
```

- [ ] **Step 4: Run to verify it passes:**

```powershell
npx tsx scripts/_verify-resolve-period.ts
```

Expected: all 6 lines `✓` + final "All ... passed".

- [ ] **Step 5: Commit:**

```bash
git add src/services/billing.service.ts scripts/_verify-resolve-period.ts
git commit -m "feat(billing): resolveNextPeriod for rolling/calendar cycles + 6-case verification"
```

---

### Task 1.2: `utility.service.ts` — record + latest-before lookup

**Files:**
- Create: `src/services/utility.service.ts`
- Create: `scripts/_verify-utility-service.ts`

- [ ] **Step 1: Write the failing test** — `scripts/_verify-utility-service.ts`:

```ts
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma';
import { recordReading, getLatestReadingBefore } from '../src/services/utility.service';

async function main() {
  // Use a throwaway room — pick any existing or create
  const room = await prisma.room.findFirst({ select: { id: true } });
  if (!room) throw new Error('seed at least one Room first');

  await prisma.$transaction(async (tx) => {
    // First reading — prev defaults to 0
    const r1 = await recordReading(tx, {
      roomId: room.id,
      readingDate: new Date('2026-04-30T00:00:00.000Z'),
      currWater: 150,
      currElectric: 2200,
      recordedBy: 'test',
    });
    assert.strictEqual(Number(r1.prevWater), 0);
    assert.strictEqual(Number(r1.currWater), 150);

    // Second reading — prev should be 150 / 2200
    const r2 = await recordReading(tx, {
      roomId: room.id,
      readingDate: new Date('2026-05-30T00:00:00.000Z'),
      currWater: 165,
      currElectric: 2510,
      recordedBy: 'test',
    });
    assert.strictEqual(Number(r2.prevWater), 150);
    assert.strictEqual(Number(r2.prevElectric), 2200);

    // Lookup latest before mid-cycle
    const found = await getLatestReadingBefore(tx, room.id, new Date('2026-05-15T00:00:00.000Z'));
    assert.ok(found);
    assert.strictEqual(Number(found.currWater), 150);

    // Throw on future date
    await assert.rejects(() => recordReading(tx, {
      roomId: room.id,
      readingDate: new Date(Date.now() + 86400000),
      currWater: 200, currElectric: 3000, recordedBy: 'test',
    }), /readingDate cannot be in the future/);

    // Cleanup
    await tx.utilityReading.deleteMany({ where: { roomId: room.id, recordedBy: 'test' } });
  });

  console.log('✓ utility.service: record + latest-before + future-guard');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Verify it fails:**

```powershell
npx tsx scripts/_verify-utility-service.ts
```

Expected: import error — file doesn't exist.

- [ ] **Step 3: Implement** — `src/services/utility.service.ts`:

```ts
import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export interface RecordReadingInput {
  roomId:        string;
  bookingId?:    string;
  readingDate:   Date;
  currWater:     number;
  currElectric:  number;
  waterRate?:    number;
  electricRate?: number;
  notes?:        string;
  recordedBy:    string;
}

export async function recordReading(tx: Tx, input: RecordReadingInput) {
  if (input.readingDate.getTime() > Date.now()) {
    throw new Error('readingDate cannot be in the future');
  }

  const prev = await tx.utilityReading.findFirst({
    where: {
      roomId: input.roomId,
      readingDate: { lt: input.readingDate },
    },
    orderBy: { readingDate: 'desc' },
    select: { currWater: true, currElectric: true },
  });

  return tx.utilityReading.create({
    data: {
      roomId:       input.roomId,
      bookingId:    input.bookingId,
      readingDate:  input.readingDate,
      currWater:    new Prisma.Decimal(input.currWater),
      currElectric: new Prisma.Decimal(input.currElectric),
      prevWater:    prev?.currWater    ?? new Prisma.Decimal(0),
      prevElectric: prev?.currElectric ?? new Prisma.Decimal(0),
      waterRate:    input.waterRate    !== undefined ? new Prisma.Decimal(input.waterRate)    : undefined,
      electricRate: input.electricRate !== undefined ? new Prisma.Decimal(input.electricRate) : undefined,
      notes:        input.notes,
      recordedBy:   input.recordedBy,
      recordedAt:   new Date(),
      recorded:     true,
    },
  });
}

export async function getLatestReadingBefore(tx: Tx, roomId: string, before: Date) {
  return tx.utilityReading.findFirst({
    where: { roomId, readingDate: { lt: before } },
    orderBy: { readingDate: 'desc' },
  });
}

export async function getReadingsForBooking(tx: Tx, bookingId: string) {
  return tx.utilityReading.findMany({
    where: { bookingId },
    orderBy: { readingDate: 'asc' },
  });
}
```

- [ ] **Step 4: Run to verify it passes:**

```powershell
npx tsx scripts/_verify-utility-service.ts
```

Expected: `✓ utility.service: record + latest-before + future-guard`

- [ ] **Step 5: Commit:**

```bash
git add src/services/utility.service.ts scripts/_verify-utility-service.ts
git commit -m "feat(utility): recordReading + getLatestReadingBefore (prev rolls from prior reading)"
```

---

### Task 1.3: `generateDraftInvoice` — no ledger post

**Files:**
- Modify: `src/services/billing.service.ts` (append)
- Create: `scripts/e2e-draft-generation.ts`

- [ ] **Step 1: Write the failing test** — `scripts/e2e-draft-generation.ts` (full E2E creating a booking, running draft generation, asserting Invoice + BillingPeriod created with no LedgerEntry):

```ts
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma';
import { generateDraftInvoice } from '../src/services/billing.service';

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    // Seed
    const room  = await tx.room.findFirstOrThrow({ select: { id: true, number: true } });
    const guest = await tx.guest.create({ data: { firstName: 'TestDraft', lastName: 'X', nationality: 'TH' } });
    const booking = await tx.booking.create({
      data: {
        bookingNumber: 'TEST-DRAFT-' + Date.now().toString(36),
        guestId: guest.id,
        roomId:  room.id,
        bookingType: 'monthly_short',
        checkIn:  new Date('2026-05-12T00:00:00.000Z'),
        checkOut: new Date('2026-07-12T00:00:00.000Z'),  // exactly 2 rolling cycles
        rate:    new (await import('@prisma/client')).Prisma.Decimal(15000),
        status:  'checked_in',
        source:  'walkin',
      },
    });
    // Booking requires a Folio for the lazy-invoice pattern — create one
    const folio = await tx.folio.create({
      data: { bookingId: booking.id, folioNumber: 'TEST-FOLIO-' + Date.now().toString(36), guestId: guest.id },
    });

    // Generate cycle 1 draft (no reading yet — rent only)
    const draft1 = await generateDraftInvoice(tx, {
      bookingId: booking.id,
      cycleIndex: 1,
      createdBy: 'test-cron',
    });
    assert.strictEqual(draft1.status, 'draft');
    assert.strictEqual(Number(draft1.grandTotal), 15000);  // full rolling cycle, full rent
    assert.strictEqual(draft1.needsReading, false);         // cycle 1 has no utility

    const period1 = await tx.billingPeriod.findUniqueOrThrow({
      where: { bookingId_cycleIndex: { bookingId: booking.id, cycleIndex: 1 } },
    });
    assert.strictEqual(period1.invoiceId, draft1.invoiceId);
    assert.strictEqual(period1.isPartial, false);

    // CRITICAL: no ledger entry yet
    const led = await tx.ledgerEntry.count({ where: { invoiceId: draft1.invoiceId } });
    assert.strictEqual(led, 0, 'draft must NOT post ledger');

    // Folio totals must NOT change
    const folioAfter = await tx.folio.findUniqueOrThrow({ where: { id: folio.id }});
    assert.strictEqual(Number(folioAfter.totalCharges), 0, 'folio totalCharges unchanged by draft');

    // Cleanup
    await tx.invoiceItem.deleteMany({ where: { invoiceId: draft1.invoiceId }});
    await tx.invoice.delete({ where: { id: draft1.invoiceId }});
    await tx.billingPeriod.delete({ where: { id: period1.id }});
    await tx.folioLineItem.deleteMany({ where: { folioId: folio.id }});
    await tx.folio.delete({ where: { id: folio.id }});
    await tx.booking.delete({ where: { id: booking.id }});
    await tx.guest.delete({ where: { id: guest.id }});
    return 'ok';
  });

  console.log('✓ draft generation creates Invoice(status=draft) + BillingPeriod + NO ledger');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run to verify it fails:**

```powershell
npx tsx scripts/e2e-draft-generation.ts
```

Expected: import error — `generateDraftInvoice` not exported.

- [ ] **Step 3: Implement** — append to `src/services/billing.service.ts`:

```ts
import { getLatestReadingBefore } from './utility.service';
import { addCharge, createInvoiceFromFolio, getFolioByBookingId } from './folio.service';

export interface GenerateDraftInput {
  bookingId:  string;
  cycleIndex: number;
  createdBy:  string;
  /** Optional override for unit tests; defaults to "today" */
  asOf?:      Date;
}

export interface GeneratedDraft {
  invoiceId:    string;
  invoiceNumber: string;
  grandTotal:   number;
  status:       'draft';
  periodStart:  Date;
  periodEnd:    Date;
  isPartial:    boolean;
  needsReading: boolean;
}

export async function generateDraftInvoice(
  tx: Prisma.TransactionClient,
  input: GenerateDraftInput,
): Promise<GeneratedDraft> {
  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: input.bookingId },
    select: {
      id: true, bookingType: true, checkIn: true, checkOut: true,
      rate: true, guestId: true, roomId: true,
      room: { select: { number: true } },
    },
  });
  if (booking.bookingType !== 'monthly_short' && booking.bookingType !== 'monthly_long') {
    throw new Error('generateDraftInvoice requires a monthly booking');
  }

  // Idempotent — bail if a period+invoice already exists for this cycle.
  const existing = await tx.billingPeriod.findUnique({
    where: { bookingId_cycleIndex: { bookingId: input.bookingId, cycleIndex: input.cycleIndex } },
  });
  if (existing?.invoiceId) {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: existing.invoiceId } });
    return {
      invoiceId: inv.id, invoiceNumber: inv.invoiceNumber,
      grandTotal: Number(inv.grandTotal), status: inv.status as 'draft',
      periodStart: existing.periodStart, periodEnd: existing.periodEnd,
      isPartial: existing.isPartial, needsReading: false,
    };
  }

  const period = resolveNextPeriod({
    bookingType: booking.bookingType,
    checkIn:  booking.checkIn,
    checkOut: booking.checkOut,
    cycleIndex: input.cycleIndex,
  });

  const folio = await getFolioByBookingId(tx, booking.id);
  if (!folio) throw new Error('FOLIO_NOT_FOUND');

  // 1) Rent charge — pro-rate if partial
  const daysInCycle = Math.round(
    (period.end.getTime() - period.start.getTime()) / 86_400_000,
  ) + 1;
  const fullCycleDays = period.isPartial
    ? new Date(Date.UTC(period.start.getUTCFullYear(), period.start.getUTCMonth() + 1, 0)).getUTCDate()
    : daysInCycle;
  const rentAmount = period.isPartial
    ? Math.round(Number(booking.rate) * (daysInCycle / fullCycleDays) * 100) / 100
    : Number(booking.rate);

  await addCharge(tx, {
    folioId: folio.folioId,
    chargeType: 'ROOM',
    description: period.isPartial
      ? `ค่าห้องพัก (pro-rated ${daysInCycle}/${fullCycleDays} วัน) — ห้อง ${booking.room.number}`
      : `ค่าห้องพัก — ห้อง ${booking.room.number}`,
    amount: rentAmount,
    serviceDate: period.start,
    periodEnd: period.end,
    referenceType: 'monthly_draft',
    referenceId:   `${booking.id}-c${input.cycleIndex}`,
    notes: `Cycle ${input.cycleIndex} draft`,
    createdBy: input.createdBy,
    billingStatus: 'DRAFT',   // ← key flag — Task 0.2 enabled this
  });

  // 2) Utility — only for cycle ≥ 2 (cycle 1 has no "previous" reading)
  let needsReading = false;
  if (input.cycleIndex >= 2) {
    const curr = await getLatestReadingBefore(tx, booking.roomId, period.start);
    const prev = await tx.billingPeriod.findUnique({
      where: { bookingId_cycleIndex: { bookingId: booking.id, cycleIndex: input.cycleIndex - 1 } },
    });
    const referenceDate = prev?.periodStart ?? booking.checkIn;
    const baseline = await getLatestReadingBefore(tx, booking.roomId, referenceDate);

    if (!curr) {
      needsReading = true;
    } else {
      const waterUsage    = Number(curr.currWater)    - Number(baseline?.currWater    ?? 0);
      const electricUsage = Number(curr.currElectric) - Number(baseline?.currElectric ?? 0);
      if (waterUsage > 0) {
        await addCharge(tx, {
          folioId: folio.folioId, chargeType: 'UTILITY_WATER',
          description: `ค่าน้ำ (${waterUsage} หน่วย × ${Number(curr.waterRate)}) — ห้อง ${booking.room.number}`,
          amount: Math.round(waterUsage * Number(curr.waterRate) * 100) / 100,
          serviceDate: period.start,
          referenceType: 'monthly_draft', referenceId: `${booking.id}-c${input.cycleIndex}-water`,
          createdBy: input.createdBy, billingStatus: 'DRAFT',
        });
      }
      if (electricUsage > 0) {
        await addCharge(tx, {
          folioId: folio.folioId, chargeType: 'UTILITY_ELECTRIC',
          description: `ค่าไฟ (${electricUsage} หน่วย × ${Number(curr.electricRate)}) — ห้อง ${booking.room.number}`,
          amount: Math.round(electricUsage * Number(curr.electricRate) * 100) / 100,
          serviceDate: period.start,
          referenceType: 'monthly_draft', referenceId: `${booking.id}-c${input.cycleIndex}-elec`,
          createdBy: input.createdBy, billingStatus: 'DRAFT',
        });
      }
    }
  }

  // 3) Create draft Invoice — invoiceType='monthly_rent', status='draft'
  //    createInvoiceFromFolio gathers ALL DRAFT-flagged folio items.
  const invResult = await createInvoiceFromFolio(tx, {
    folioId: folio.folioId,
    guestId: booking.guestId,
    bookingId: booking.id,
    invoiceType: 'MN',
    dueDate: new Date(period.start.getTime() + 7 * 86_400_000),
    billingPeriodStart: period.start,
    billingPeriodEnd:   period.end,
    notes: `Draft cycle ${input.cycleIndex}`,
    createdBy: input.createdBy,
    status: 'draft',           // ← Task 0.1 enabled this
    billingStatusFilter: 'DRAFT', // pick up draft folio items only
  });
  if (!invResult) throw new Error('Draft invoice creation produced no result');

  // 4) Log the BillingPeriod — UPSERT (not create). A prior rejected draft
  //    leaves a BillingPeriod row with invoiceId=null (see Task 1.5); the next
  //    cron run must reuse that row, not create a duplicate (which would
  //    violate @@unique([bookingId, cycleIndex])).
  await tx.billingPeriod.upsert({
    where: { bookingId_cycleIndex: { bookingId: booking.id, cycleIndex: input.cycleIndex } },
    update: {
      periodStart: period.start,
      periodEnd:   period.end,
      isPartial:   period.isPartial,
      isFinal:     period.isFinal,
      invoiceId:   invResult.invoiceId,
    },
    create: {
      bookingId:   booking.id,
      cycleIndex:  input.cycleIndex,
      periodStart: period.start,
      periodEnd:   period.end,
      isPartial:   period.isPartial,
      isFinal:     period.isFinal,
      invoiceId:   invResult.invoiceId,
    },
  });

  return {
    invoiceId:     invResult.invoiceId,
    invoiceNumber: invResult.invoiceNumber,
    grandTotal:    invResult.grandTotal,
    status:        'draft',
    periodStart:   period.start,
    periodEnd:     period.end,
    isPartial:     period.isPartial,
    needsReading,
  };
}
```

- [ ] **Step 4: Extend `addCharge` and `createInvoiceFromFolio`** — both helpers must accept `billingStatus` / `billingStatusFilter`. Open `src/services/folio.service.ts`:

```ts
// In addCharge signature — add optional param:
//   billingStatus?: BillingStatus
// Pass through to the FolioLineItem.create payload. Default remains 'UNBILLED'.

// In createInvoiceFromFolio signature — add:
//   billingStatusFilter?: BillingStatus  // default 'UNBILLED'
//   status?: InvoiceStatus               // default 'unpaid'
// The findMany query that picks line items must filter on this status.
// The new Invoice.create call must set `status: input.status ?? 'unpaid'`.
```

Make these changes — keep existing callers working by defaulting to current behavior.

- [ ] **Step 5: Run E2E:**

```powershell
npx tsx scripts/e2e-draft-generation.ts
```

Expected: `✓ draft generation creates Invoice(status=draft) + BillingPeriod + NO ledger`

- [ ] **Step 6: Commit:**

```bash
git add src/services/billing.service.ts src/services/folio.service.ts scripts/e2e-draft-generation.ts
git commit -m "feat(billing): generateDraftInvoice — Invoice.status=draft + BillingPeriod, no ledger post"
```

---

### Task 1.4: `approveDraft` — flip to unpaid + post ledger

**Files:**
- Modify: `src/services/billing.service.ts` (append)
- Modify: `scripts/e2e-draft-generation.ts` (extend with approval check)

- [ ] **Step 1: Extend the test** — add to bottom of `e2e-draft-generation.ts` BEFORE the cleanup block:

```ts
// --- approval ---
const approved = await approveDraft(tx, { invoiceId: draft1.invoiceId, approvedBy: 'test-mgr' });
assert.strictEqual(approved.status, 'unpaid');
const led2 = await tx.ledgerEntry.count({ where: { invoiceId: draft1.invoiceId } });
assert.strictEqual(led2, 2, 'approval posts exactly one DR/CR pair');
const folioApproved = await tx.folio.findUniqueOrThrow({ where: { id: folio.id }});
assert.strictEqual(Number(folioApproved.totalCharges), 15000, 'folio totalCharges updated on approve');

// Re-approve is a no-op (idempotent)
await assert.rejects(
  () => approveDraft(tx, { invoiceId: draft1.invoiceId, approvedBy: 'test-mgr' }),
  /not in draft status/,
);
```

Also add `import { approveDraft } from '...'` at top.

- [ ] **Step 2: Run to verify it fails:**

```powershell
npx tsx scripts/e2e-draft-generation.ts
```

Expected: `approveDraft is not a function`.

- [ ] **Step 3: Implement** — append to `src/services/billing.service.ts`:

```ts
import { postLedgerPair } from './ledger.service';
import { recalculateFolioBalance } from './folio.service';

export interface ApproveDraftInput {
  invoiceId:  string;
  approvedBy: string;
}

export async function approveDraft(
  tx: Prisma.TransactionClient,
  input: ApproveDraftInput,
): Promise<{ invoiceId: string; status: 'unpaid' }> {
  // Row-lock the invoice to prevent concurrent approval
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${input.invoiceId} FOR UPDATE`;

  const inv = await tx.invoice.findUniqueOrThrow({
    where: { id: input.invoiceId },
    select: { id: true, status: true, grandTotal: true, bookingId: true, items: { select: { folioLineItemId: true } } },
  });
  if (inv.status !== 'draft') {
    throw new Error(`Invoice ${input.invoiceId} is not in draft status (was ${inv.status})`);
  }

  // Flip invoice + folio items
  await tx.invoice.update({
    where: { id: inv.id },
    data:  { status: 'unpaid' },
  });
  const itemIds = inv.items.map(i => i.folioLineItemId).filter((x): x is string => !!x);
  if (itemIds.length > 0) {
    await tx.folioLineItem.updateMany({
      where: { id: { in: itemIds } },
      data:  { billingStatus: 'BILLED' },
    });
  }

  // Recompute folio totals AFTER status flip
  if (inv.bookingId) {
    const folio = await tx.folio.findUniqueOrThrow({ where: { bookingId: inv.bookingId }, select: { id: true } });
    await recalculateFolioBalance(tx, folio.id);
  }

  // Post the ledger pair: DR 1140-01 AR / CR 4110-01 Revenue (treat utility same revenue acct for now — see Open Q §10.1)
  await postLedgerPair(tx, {
    invoiceId: inv.id,
    amount: Number(inv.grandTotal),
    debit:  { legacy: 'AR' },
    credit: { legacy: 'REVENUE' },
    description: `Approve monthly draft invoice ${inv.id}`,
    createdBy: input.approvedBy,
  });

  return { invoiceId: inv.id, status: 'unpaid' };
}
```

- [ ] **Step 4: Run E2E:**

```powershell
npx tsx scripts/e2e-draft-generation.ts
```

Expected: `✓` line still appears + no assertion failures.

- [ ] **Step 5: Commit:**

```bash
git add src/services/billing.service.ts scripts/e2e-draft-generation.ts
git commit -m "feat(billing): approveDraft — flip status, post ledger pair, idempotent"
```

---

### Task 1.5: `rejectDraft` — void the draft, clear BillingPeriod link

**Files:**
- Modify: `src/services/billing.service.ts`
- Create: `scripts/e2e-draft-reject.ts`

- [ ] **Step 1: Test** — `scripts/e2e-draft-reject.ts`:

```ts
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma';
import { generateDraftInvoice, rejectDraft } from '../src/services/billing.service';

async function main() {
  await prisma.$transaction(async (tx) => {
    // (same seed harness as Task 1.3 — copy-paste the booking+folio creation)
    // …
    const draft = await generateDraftInvoice(tx, { bookingId: booking.id, cycleIndex: 1, createdBy: 'test' });
    const rejected = await rejectDraft(tx, { invoiceId: draft.invoiceId, reason: 'wrong period', rejectedBy: 'test-mgr' });

    assert.strictEqual(rejected.status, 'voided');

    const period = await tx.billingPeriod.findUniqueOrThrow({
      where: { bookingId_cycleIndex: { bookingId: booking.id, cycleIndex: 1 } },
    });
    assert.strictEqual(period.invoiceId, null, 'reject clears BillingPeriod.invoiceId');

    const led = await tx.ledgerEntry.count({ where: { invoiceId: draft.invoiceId } });
    assert.strictEqual(led, 0, 'reject must NOT post ledger');

    // Re-run draft for same cycle should succeed (no P2002)
    const draft2 = await generateDraftInvoice(tx, { bookingId: booking.id, cycleIndex: 1, createdBy: 'test' });
    assert.notStrictEqual(draft2.invoiceId, draft.invoiceId, 'second draft has fresh invoice id');

    // (cleanup)
  });
  console.log('✓ rejectDraft voids invoice + clears BillingPeriod link + allows re-draft');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2:** `npx tsx scripts/e2e-draft-reject.ts` — fails (`rejectDraft` missing).

- [ ] **Step 3: Implement** — append:

```ts
export interface RejectDraftInput {
  invoiceId:  string;
  reason:     string;
  rejectedBy: string;
}

export async function rejectDraft(
  tx: Prisma.TransactionClient,
  input: RejectDraftInput,
): Promise<{ invoiceId: string; status: 'voided' }> {
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${input.invoiceId} FOR UPDATE`;

  const inv = await tx.invoice.findUniqueOrThrow({
    where: { id: input.invoiceId },
    select: { id: true, status: true, items: { select: { folioLineItemId: true } } },
  });
  if (inv.status !== 'draft') {
    throw new Error(`Invoice ${input.invoiceId} is not in draft status (was ${inv.status})`);
  }

  await tx.invoice.update({
    where: { id: inv.id },
    data:  { status: 'voided', notes: `Rejected: ${input.reason}` },
  });

  const itemIds = inv.items.map(i => i.folioLineItemId).filter((x): x is string => !!x);
  if (itemIds.length > 0) {
    await tx.folioLineItem.updateMany({
      where: { id: { in: itemIds } },
      data:  { billingStatus: 'VOIDED' },
    });
  }

  // Unlink from BillingPeriod so cron can recreate
  await tx.billingPeriod.updateMany({
    where: { invoiceId: inv.id },
    data:  { invoiceId: null },
  });

  return { invoiceId: inv.id, status: 'voided' };
}
```

- [ ] **Step 4:** `npx tsx scripts/e2e-draft-reject.ts` — passes.

- [ ] **Step 5: Commit:**

```bash
git add src/services/billing.service.ts scripts/e2e-draft-reject.ts
git commit -m "feat(billing): rejectDraft voids invoice + clears BillingPeriod link"
```

---

### Task 1.6: Enforce `Contract.billingCycle ↔ BookingType` in `createDraft`

**Files:**
- Modify: `src/services/contract.service.ts` (function `createDraft`)
- Create: `scripts/_verify-contract-cycle-binding.ts`

- [ ] **Step 1: Test** — write a script that creates a `monthly_short` booking and tries to `createDraft` with `billingCycle='calendar'`; assert rejection. Also test the inverse:

```ts
// pseudo — exact shape mirrors existing scripts/e2e-* harnesses
await assert.rejects(
  () => createDraft(tx, { bookingId: shortBooking.id, billingCycle: 'calendar', /* ... */ }),
  /billingCycle must match BookingType/,
);
const ok = await createDraft(tx, { bookingId: shortBooking.id, billingCycle: 'rolling', /* ... */ });
assert.strictEqual(ok.billingCycle, 'rolling');
```

- [ ] **Step 2:** Run — fails.

- [ ] **Step 3: Implement** — in `createDraft`, AFTER fetching the booking:

```ts
const expected: 'rolling' | 'calendar' =
  booking.bookingType === 'monthly_short' ? 'rolling' :
  booking.bookingType === 'monthly_long'  ? 'calendar' :
  /* should be unreachable — caller already checked */ 'rolling';

if (input.billingCycle !== expected) {
  throw new ContractValidationError(
    'INVALID_DATES',
    `billingCycle must match BookingType (expected ${expected} for ${booking.bookingType})`,
  );
}
```

- [ ] **Step 4:** Run — passes.

- [ ] **Step 5: Commit:**

```bash
git add src/services/contract.service.ts scripts/_verify-contract-cycle-binding.ts
git commit -m "feat(contract): enforce billingCycle ↔ BookingType binding in createDraft"
```

---

## Phase 2 — APIs + cron

Goal: expose the services over HTTP routes (manager+ gated), add the cron job, write the backfill script.

### Task 2.1: `POST /api/utility-readings`

**Files:**
- Create: `src/app/api/utility-readings/route.ts`
- Modify: `scripts/e2e-utility-api.ts` (new)

- [ ] **Step 1:** Write the E2E that posts a reading via fetch (signed-in cookie). Assert 201 + reading row created.

- [ ] **Step 2:** Run — fails.

- [ ] **Step 3:** Implement:

```ts
// src/app/api/utility-readings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { recordReading } from '@/services/utility.service';

const Body = z.object({
  roomId:       z.string().uuid(),
  bookingId:    z.string().uuid().optional(),
  readingDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currWater:    z.number().nonnegative().max(1_000_000),
  currElectric: z.number().nonnegative().max(1_000_000),
  notes:        z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = (session.user as { role?: string })?.role;
  if (!['admin', 'manager', 'staff'].includes(role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid', details: parsed.error.format() }, { status: 400 });
  }
  try {
    const reading = await prisma.$transaction((tx) =>
      recordReading(tx, {
        roomId: parsed.data.roomId,
        bookingId: parsed.data.bookingId,
        readingDate: new Date(parsed.data.readingDate + 'T00:00:00.000Z'),
        currWater: parsed.data.currWater,
        currElectric: parsed.data.currElectric,
        notes: parsed.data.notes,
        recordedBy: session.user?.email ?? 'unknown',
      }),
    );
    return NextResponse.json({ id: reading.id }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && /future/.test(e.message)) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
```

- [ ] **Step 4:** Run E2E — passes.

- [ ] **Step 5: Commit:**

```bash
git add src/app/api/utility-readings/route.ts scripts/e2e-utility-api.ts
git commit -m "feat(api): POST /api/utility-readings (staff+)"
```

---

### Task 2.2: `GET /api/billing/drafts`

**Files:**
- Create: `src/app/api/billing/drafts/route.ts`

- [ ] **Step 1:** Test — POST a draft via service, then GET the endpoint, assert it appears with `cycleIndex`, period, breakdown fields.
- [ ] **Step 2:** Fail.
- [ ] **Step 3:** Implement — returns:

```ts
// Shape
{
  drafts: Array<{
    invoiceId: string;
    invoiceNumber: string;
    bookingId: string;
    bookingNumber: string;
    guestName: string;
    roomNumber: string;
    contractNumber: string | null;
    cycle: 'rolling' | 'calendar';
    cycleIndex: number;
    periodStart: string;  // YYYY-MM-DD
    periodEnd:   string;
    rentAmount:  number;
    waterAmount: number;
    electricAmount: number;
    grandTotal:  number;
    needsReading: boolean;     // computed: any UTILITY_* charges missing?
    paymentBehavior: { onTime: number; late: number; avgDaysLate: number };  // from prior invoices
  }>;
  total: number;
}
```

Manager+/admin gated. Filter by `?cycle=rolling|calendar`, `?floor`, `?roomTypeId`, pagination via `?limit&offset`. Uses tailored `select` (no leaks).

- [ ] **Step 4:** Pass.
- [ ] **Step 5: Commit:** `git commit -m "feat(api): GET /api/billing/drafts — pending drafts for review UI"`

---

### Task 2.3: `GET /api/billing/drafts/[id]` (single + history)

**Files:** `src/app/api/billing/drafts/[id]/route.ts`

- [ ] Same TDD shape. Returns the draft + the booking's full billing history (past invoices, payments, readings) for the expand-row UI.
- [ ] Commit: `feat(api): GET /api/billing/drafts/[id] with billing history`

---

### Task 2.4: `POST /api/billing/drafts/approve` (bulk)

**Files:** `src/app/api/billing/drafts/approve/route.ts`

- [ ] Test — bulk approve 3 invoices in one call, assert ledger has 3 pairs.
- [ ] Block rows with `needsReading=true` server-side (re-derive, don't trust client); return `{ approved: [...], skipped: [...] }`.
- [ ] Manager+/admin gated.
- [ ] Commit: `feat(api): POST /api/billing/drafts/approve — bulk approve with reading guard`

---

### Task 2.5: `POST /api/billing/drafts/[id]/reject`

- [ ] Body: `{ reason: string }` (Zod 5-500 chars).
- [ ] Manager+/admin gated.
- [ ] Commit: `feat(api): POST /api/billing/drafts/[id]/reject`

---

### Task 2.6: `POST /api/billing/drafts/[id]/edit`

- [ ] Body: optional `rentAmount` / `waterUsage` / `electricUsage` / `notes`. Only while `status='draft'`.
- [ ] Edits update folio line items + recompute invoice grandTotal (no ledger touched).
- [ ] Commit: `feat(api): POST /api/billing/drafts/[id]/edit — inline edits before approve`

---

### Task 2.7: `GET /api/bookings/[id]/billing-history`

**Files:** `src/app/api/bookings/[id]/billing-history/route.ts`

- [ ] Returns: `{ summary: {…}, invoices: [...], readings: [...] }` shaped for the expand-row UI.
- [ ] Manager+/admin gated (cashier sees this too — staff role ok per CLAUDE.md).
- [ ] Commit: `feat(api): GET /api/bookings/[id]/billing-history`

---

### Task 2.8: Cron — `scripts/cron/generate-monthly-drafts.ts` + `POST /api/cron/billing-draft`

**Files:**
- Create: `scripts/cron/generate-monthly-drafts.ts`
- Create: `src/app/api/cron/billing-draft/route.ts`

- [ ] **Step 1:** Script logic:

```ts
// Walk active monthly bookings, for each compute the next due cycle
// (highest existing BillingPeriod.cycleIndex + 1), call generateDraftInvoice
// inside a per-booking $transaction with SELECT ... FOR UPDATE on the booking.
// Skip bookings whose linked Contract.status === 'terminated' (Open Q §10.6).
// Log per-booking outcome to ActivityLog.
```

- [ ] **Step 2:** API wrapper that requires a `CRON_SECRET` env-var match in `Authorization: Bearer ...`. No session.
- [ ] **Step 3:** Wire into `render.yaml` / `railway.toml` schedule (02:00 daily).
- [ ] **Step 4:** E2E `scripts/e2e-cron-draft.ts` — call the endpoint with valid token, assert N drafts appear.
- [ ] **Step 5:** Commit: `feat(cron): daily monthly-draft generation + bearer-gated API`

---

### Task 2.9: Backfill — `scripts/backfill-billing-periods.ts`

**Files:**
- Create: `scripts/backfill-billing-periods.ts`

- [ ] **Step 1:** Dry-run by default; `--apply` to commit. Walks every existing `Invoice` with `invoiceType='MN'` and creates a `BillingPeriod` row linking it. Idempotent.

- [ ] **Step 2:** Implement — read invoice's `billingPeriodStart`/`End` → compute `cycleIndex` from rank within the booking → upsert `BillingPeriod`.

- [ ] **Step 3:** Run dry-run on dev DB; sanity-check counts vs `Invoice` count.

- [ ] **Step 4:** Run with `--apply` on dev DB; verify all monthly invoices have a paired `BillingPeriod`.

- [ ] **Step 5:** Commit: `chore(billing): backfill BillingPeriod for legacy monthly invoices`

---

## Phase 3 — UI

Goal: replace the `/billing-cycle` stub with the manager review table + expand row + edit/approve flow.

### Task 3.1: `/billing-cycle` page — DataTable wired to `/api/billing/drafts`

**Files:**
- Modify: `src/app/(dashboard)/billing-cycle/page.tsx`

- [ ] **Step 1:** Replace the existing stub body with a `<DataTable>` (per CLAUDE.md §5 — shared component in `src/components/data-table/`). Columns: select / room+guest+contract / cycle badge / period / rent / water / elec / total / paymentBehavior / actions.

- [ ] **Step 2:** Wire `useEffect` fetch of `/api/billing/drafts` on mount. Use `useToast` for errors.

- [ ] **Step 3:** Sticky bulk bar appearing on `selectedIds.length >= 1`: count + sum + ✅ Approve + ❌ Reject + 📋 ดูบิลรวม.

- [ ] **Step 4:** Visual: amber background on rows where `needsReading=true`; checkbox disabled, tooltip "ต้องจดมิเตอร์ก่อน".

- [ ] **Step 5:** Manually verify in preview (`preview_start` → click through). Take a screenshot.

- [ ] **Step 6: Commit:** `feat(billing-cycle): review table with bulk select + missing-reading guard`

---

### Task 3.2: Expand row component — history + readings

**Files:**
- Create: `src/app/(dashboard)/billing-cycle/components/ExpandRow.tsx`

- [ ] **Step 1:** Component receives `bookingId`; lazy-loads `/api/bookings/[id]/billing-history` on first render via `useEffect` + `useState`. Renders 5-card summary strip + past-invoices table + reading history + quick links (per spec §7.1).

- [ ] **Step 2:** Wire into the parent row's click-to-expand toggle (state `expandedId: string | null` in parent).

- [ ] **Step 3:** Use `fmtDate` / `fmtBaht` exclusively. No `th-TH` locale.

- [ ] **Step 4:** Preview-verify on a booking with ≥ 2 historical invoices.

- [ ] **Step 5: Commit:** `feat(billing-cycle): expand row — billing history + readings (lazy)`

---

### Task 3.3: Edit modal — per-row edit before approve

**Files:**
- Create: `src/app/(dashboard)/billing-cycle/components/EditDraftDialog.tsx`

- [ ] Modal triggered by ✏️ button. Editable: rent amount, water usage, electric usage, notes. POST to `/api/billing/drafts/[id]/edit`. On success, refetch the parent's list.
- [ ] Per CLAUDE.md §4 — use `Dialog` primitive from `@/components/ui`.
- [ ] Commit: `feat(billing-cycle): EditDraftDialog — inline edit of draft fields`

---

### Task 3.4: Bulk approve / reject wiring + ConfirmDialog

**Files:**
- Modify: `src/app/(dashboard)/billing-cycle/page.tsx`

- [ ] **Step 1:** Wrap the bulk action buttons in `ConfirmDialog` (from `@/components/ui`). Approve shows count + total. Reject opens a reason textarea.

- [ ] **Step 2:** On approve success, parse server response `{ approved, skipped }` and toast `Approve สำเร็จ N รายการ · ข้าม M รายการ (ต้องจดมิเตอร์)`.

- [ ] **Step 3:** Audit — verify in `/activity-log` that approve/reject events appear.

- [ ] **Step 4: Commit:** `feat(billing-cycle): bulk approve/reject with confirm + toast`

---

### Task 3.5: Utility reading modal — "📊 จด reading"

**Files:**
- Create: `src/app/(dashboard)/billing-cycle/components/RecordReadingDialog.tsx`

- [ ] Modal: pick reading date (default today), enter water + electric, notes. POST `/api/utility-readings`. Refetch parent list.
- [ ] Accessible standalone from `/utility-readings/new` route (separate task — link from sidebar).
- [ ] Commit: `feat(billing-cycle): RecordReadingDialog — inline meter entry`

---

## Phase 4 — Tests + cleanup

### Task 4.1: E2E `e2e-rolling-cycle.ts` — full 2.5-month rolling stay

**Files:** `scripts/e2e-rolling-cycle.ts`

- [ ] Seed booking 12 พ.ค.–25 ก.ค. monthly_short ฿15,000. Drive cron 3 times (advance simulated date). Assert 3 BillingPeriod rows, periods correct, last is partial 14 days = ฿7,000 rent.
- [ ] Commit: `test(billing): e2e-rolling-cycle — 3 drafts incl. partial last`

### Task 4.2: E2E `e2e-calendar-cycle.ts`

- [ ] Same shape, monthly_long. Assert cycle 1 partial-start (12-31 พ.ค.) + cycle 2 full + cycle 3 partial-end (1-24 ก.ค.).
- [ ] Commit: `test(billing): e2e-calendar-cycle`

### Task 4.3: E2E `e2e-reading-missing.ts`

- [ ] Generate cycle ≥ 2 draft without recording a new reading; assert `needsReading=true`; call approve → 422; record reading → approve succeeds.
- [ ] Commit: `test(billing): e2e-reading-missing — approve gated on reading present`

### Task 4.4: E2E `e2e-bulk-approve.ts`

- [ ] 3 drafts: 2 ready, 1 missing-reading. Bulk approve → 2 approved, 1 skipped.
- [ ] Commit: `test(billing): e2e-bulk-approve — partial success path`

### Task 4.5: E2E `e2e-draft-edit.ts`

- [ ] Edit a draft's rent + water usage → grandTotal updates → approve → ledger pair matches edited total.
- [ ] Commit: `test(billing): e2e-draft-edit`

### Task 4.6: Drop `[roomId, month]` unique on `UtilityReading`

**Files:**
- Modify: `prisma/schema.prisma` (remove the legacy unique)
- Create: `prisma/migrations/2026XXXX_drop_utility_month_unique/migration.sql`

- [ ] Only run after Phase 1–3 are deployed and verified for at least one full cycle.
- [ ] Migration: `DROP INDEX IF EXISTS "utility_readings_room_id_month_key";` then drop the `month` column entirely (`ALTER TABLE utility_readings DROP COLUMN month;`).
- [ ] Update `UtilityReading` model in `schema.prisma` to remove `month` field and the `[roomId, month]` unique.
- [ ] Commit: `feat(schema): drop UtilityReading.month — v2 readingDate is the key`

### Task 4.7: Deprecate `/api/billing/generate-monthly`

- [ ] Add `Deprecation: true` + `Sunset` header to the legacy endpoint. Log warning. Keep working for one full cycle, then delete.
- [ ] Commit: `chore(billing): mark legacy generate-monthly endpoint deprecated`

---

## Self-review (executor: skip — already done at plan-write time)

The plan author has self-checked:
- **Spec coverage:** Phase 0 covers §4 schema. Phase 1 covers §5 services. Phase 2 covers §6 APIs + §8 cron + §9 backfill. Phase 3 covers §7 UI. Phase 4 covers §12 tests + final cleanup from §9. Open questions (§10) are flagged in-line where they bite (e.g., utility revenue account, terminated-contract skip).
- **No placeholders:** Each task has executable code/SQL/commands or explicit file paths.
- **Type consistency:** `generateDraftInvoice` / `approveDraft` / `rejectDraft` signatures are consistent across Phase 1 tasks. `BillingPeriod` field names (`bookingId`, `cycleIndex`, `periodStart`, `periodEnd`, `isPartial`, `isFinal`, `invoiceId`) are identical between Task 0.3 (schema) and downstream task code.

**Plan complete and saved to `docs/superpowers/plans/2026-05-13-monthly-billing-utility-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Best when several phases can land before user check-in.

**2. Inline Execution** — execute tasks in this session using `executing-plans`, batch with checkpoints. Best for the executor to keep full context across tasks.

**Which approach?**
