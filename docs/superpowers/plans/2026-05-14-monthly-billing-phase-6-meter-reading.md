# Monthly Billing — Phase 6: Meter Reading Flow

> **For agentic workers:** Use `subagent-driven-development`. Backend (6.1–6.4) and UI (6.5–6.8) split into 2 sequential dispatches.

**Goal:** Close the meter-reading data-flow gap — capture initial reading at monthly check-in (CRITICAL — otherwise cycle 2's utility charge uses baseline=0 → wildly wrong), capture final reading at checkout, expose meter history per booking in DetailPanel, revamp `/utilities` admin page.

**Architecture:** No new schema. Reuse `UtilityReading` (Phase 0) + `utility.service` (Phase 1) + existing `RecordReadingDialog` component (Phase 3). Add a hook in `/api/checkin` and `/api/checkout` to record reading inline. Add a per-booking history endpoint. New DetailPanel section. /utilities page revamp.

**Spec basis:** Spec §10.3-10.4 (parked open questions now closed in this plan).

---

## Conventions (continuing from Phase 0–5)

- `tx: Prisma.TransactionClient` first arg on all service functions.
- API: `getServerSession + requireRole` then Zod then service.
- Money via `Prisma.Decimal`. Display via `@/lib/date-format`.
- Typed errors: `UtilityValidationError(FUTURE_DATE | BACKDATED)` from Phase 1.
- Tests: `scripts/e2e-*.ts` shape with `prisma.$transaction` cleanup.

---

## Task 6.1 — API: `GET /api/bookings/[id]/readings`

**File:** `src/app/api/bookings/[id]/readings/route.ts` (new)

Role: admin / manager / staff. Returns `UtilityReading[]` for this booking, ordered by `readingDate desc`.

```ts
const session = await getServerSession(authOptions);
if (!session) return 401;
const forbidden = requireRole(session, ['admin','manager','staff']);
if (forbidden) return forbidden;

const readings = await prisma.utilityReading.findMany({
  where: { bookingId: params.id },
  orderBy: { readingDate: 'desc' },
  select: {
    id: true, readingDate: true,
    prevWater: true, currWater: true, waterRate: true,
    prevElectric: true, currElectric: true, electricRate: true,
    notes: true, recordedBy: true, recordedAt: true,
  },
});

return NextResponse.json(
  readings.map(r => ({
    id: r.id,
    readingDate: r.readingDate?.toISOString().slice(0,10) ?? null,
    prevWater: Number(r.prevWater),
    currWater: Number(r.currWater),
    waterRate: Number(r.waterRate),
    prevElectric: Number(r.prevElectric),
    currElectric: Number(r.currElectric),
    electricRate: Number(r.electricRate),
    waterUsage: Number(r.currWater) - Number(r.prevWater),
    electricUsage: Number(r.currElectric) - Number(r.prevElectric),
    notes: r.notes,
    recordedBy: r.recordedBy,
    recordedAt: r.recordedAt?.toISOString() ?? null,
  })),
);
```

Commit: `feat(api): GET /api/bookings/[id]/readings — per-booking meter history`

## Task 6.2 — Check-in initial reading (CRITICAL)

**Files:**
- `src/app/api/checkin/route.ts` — extend Zod + handler
- `src/app/(dashboard)/checkin/page.tsx` — add input fields for monthly bookings
- `scripts/e2e-checkin-init-reading.ts` — new

### 6.2.a — API

Extend `/api/checkin` Zod body:

```ts
initialReading: z.object({
  currWater:    z.number().nonnegative().max(1_000_000),
  currElectric: z.number().nonnegative().max(1_000_000),
  notes:        z.string().max(500).optional(),
}).optional(),
```

In the handler (inside the existing `$transaction`):

```ts
const isMonthly = booking.bookingType === 'monthly_short' || booking.bookingType === 'monthly_long';

// Require initialReading for monthly bookings (Phase 6.2):
if (isMonthly && !body.initialReading) {
  return NextResponse.json(
    { error: 'ต้องจดเลขมิเตอร์น้ำและไฟเริ่มต้นสำหรับการเข้าพักรายเดือน' },
    { status: 422 },
  );
}

// If provided (any booking type), persist before invoice generation so the
// reading is the baseline for cycle 2+.
if (body.initialReading) {
  await recordReading(tx, {
    roomId: booking.roomId,
    bookingId: booking.id,
    readingDate: new Date(now.toISOString().slice(0,10) + 'T00:00:00.000Z'),
    currWater: body.initialReading.currWater,
    currElectric: body.initialReading.currElectric,
    notes: body.initialReading.notes ?? 'Initial reading at check-in',
    recordedBy: userId,
  });
}
```

Import `recordReading` from `@/services/utility.service` at the top.

Note: `recordReading` enforces `readingDate <= today` and back-date guard. At check-in, `readingDate = today` so both pass.

### 6.2.b — Check-in UI

In `src/app/(dashboard)/checkin/page.tsx`, add a "📊 จดเลขมิเตอร์เริ่มต้น" section for monthly bookings (visible only when `booking.bookingType !== 'daily'`):

- Two number inputs: "เลขมิเตอร์น้ำ (หน่วย)" + "เลขมิเตอร์ไฟ (หน่วย)"
- Required for monthly (block submit if empty)
- Optional textarea for notes
- Send as `initialReading: { currWater, currElectric, notes }` in the POST body to `/api/checkin`

Add a hint: "ค่าน้ำ-ไฟตั้งแต่เดือนที่ 2 จะคำนวณจากเลขนี้เป็น baseline"

### 6.2.c — E2E test

`scripts/e2e-checkin-init-reading.ts`:
1. Create monthly_short booking (confirmed state) with rate 15000, 3 months
2. POST `/api/checkin` WITHOUT `initialReading` → expect 422
3. POST `/api/checkin` WITH `initialReading: { currWater: 100, currElectric: 2000 }` → expect 200
4. Query DB: assert UtilityReading row exists with `bookingId`, `readingDate=today`, `currWater=100`, `currElectric=2000`, `prevWater=0` (or prev reading if room had one)
5. Generate cycle 2 draft: assert utility charges computed from baseline 100/2000 (not 0/0)
6. Cleanup

Commit: `feat(checkin): require initial meter reading for monthly bookings (CRITICAL fix)`

## Task 6.3 — Checkout final reading

**Files:**
- `src/app/api/checkout/route.ts`
- `src/app/(dashboard)/checkout/page.tsx` (find via `grep`)

### 6.3.a — API

Same Zod extension as check-in:

```ts
finalReading: z.object({
  currWater:    z.number().nonnegative().max(1_000_000),
  currElectric: z.number().nonnegative().max(1_000_000),
  notes:        z.string().max(500).optional(),
}).optional(),
```

For monthly bookings:
- If `finalReading` provided: `recordReading` BEFORE the final cycle's draft is generated (so the last cycle uses real numbers)
- If not provided: log a warning + proceed (don't block checkout)

Decision rationale: blocking checkout is bad UX (guest is leaving). Encourage via UI but don't enforce.

### 6.3.b — Checkout UI

Add "📊 จดเลขมิเตอร์ปิดงาน" section for monthly bookings. Same 2 number inputs + optional notes. NOT required (just warn if empty).

Commit: `feat(checkout): final meter reading for monthly bookings (optional)`

## Task 6.4 — Extend smoke E2E

Add 2 new cases to `scripts/e2e-api-billing-v2.ts` (or create dedicated `scripts/e2e-meter-flow.ts`):
1. Monthly booking flow: check-in with init → cycle 1 draft (no utility — first cycle) → record cycle-end reading → cycle 2 draft (utility computed from delta) → approve.
2. Checkout with final reading → last cycle's utility uses final number.

Commit: `test(billing): e2e meter flow — init reading at check-in + final at checkout`

---

## Task 6.5 — DetailPanel "📊 มิเตอร์" section

**File:** `src/app/(dashboard)/reservation/components/DetailPanel.tsx`

Add a new collapsible section UNDER the บิล tab (or as a sub-tab in the tab strip — match the existing pattern). Only visible when `booking.bookingType !== 'daily'`.

Content:
- Header "📊 มิเตอร์น้ำ-ไฟ" + "+ จดมิเตอร์" button
- Reading history table:
  | วันจด | น้ำ (prev → curr · ใช้ X หน่วย) | ไฟ (prev → curr · ใช้ Y หน่วย) | ผู้จด | หมายเหตุ |
- Empty state: "ยังไม่มีบันทึกมิเตอร์"
- Lazy fetch on tab/section expand via `GET /api/bookings/[id]/readings`
- Click "+ จดมิเตอร์" → reuse `RecordReadingDialog` from Phase 3 (it accepts roomId + bookingId + readingDate + currWater + currElectric + notes)

State: `meterReadings: Reading[]` + `meterLoading: boolean` + `meterDialogOpen: boolean`. Mirror the pattern of the existing `recurringCharges` state added in Phase 5.

Commit: `feat(ui): DetailPanel meter reading section — history + add (Phase 6.5)`

## Task 6.6 — Checkin page meter input

**File:** `src/app/(dashboard)/checkin/page.tsx`

For monthly bookings, add a step/section before the "ยืนยัน check-in" submit button:

```
┌─ 📊 จดเลขมิเตอร์เริ่มต้น (จำเป็นสำหรับรายเดือน) ──┐
│ เลขมิเตอร์น้ำ:  [___________] หน่วย                │
│ เลขมิเตอร์ไฟ:   [___________] หน่วย                │
│ หมายเหตุ:       [_____________________________]    │
│ ℹ️ ค่าน้ำ-ไฟตั้งแต่เดือนที่ 2 จะคำนวณจากเลขนี้      │
└────────────────────────────────────────────────────┘
```

Pre-fill with last reading for the room (if exists, fetch on mount via `GET /api/rooms/[id]/last-reading` or via the new `/api/bookings/[id]/readings` querying the room). Validate non-negative + below threshold. Block submit if monthly + empty.

Send as `initialReading` in POST body to `/api/checkin`.

Commit: `feat(checkin): UI for initial meter reading on monthly check-in`

## Task 6.7 — Checkout page meter input

**File:** `src/app/(dashboard)/checkout/page.tsx`

Same shape as 6.6 but optional (don't block submit). Pre-fill with last reading for context.

Commit: `feat(checkout): UI for final meter reading on monthly checkout`

## Task 6.8 — `/utilities` admin page revamp

**File:** `src/app/(dashboard)/utilities/page.tsx`

Current page is legacy (per-month read, just-patched-for-readingDate). Revamp:
- DataTable (`GoogleSheetTable`) per CLAUDE.md §5
- Columns: ห้อง / วันจด / น้ำ (prev/curr/usage) / ไฟ (prev/curr/usage) / ผู้จด / หมายเหตุ
- Filters: per-column (room, date range, user)
- "+ จดมิเตอร์ใหม่" button → opens RecordReadingDialog (any room, any booking, any date)
- Optional: bulk-add helper (one row per room with pre-filled prev)

Commit: `feat(utilities): admin page revamp — DataTable + bulk add (Phase 6.8)`

---

## Dispatch order

**Dispatch 1 — Backend + critical (6.1 + 6.2 + 6.3 + 6.4):** APIs, /api/checkin and /api/checkout extensions, E2E tests. UI for check-in + checkout is part of this since they're tightly coupled.

**Dispatch 2 — UI only (6.5 + 6.8):** DetailPanel meter section + /utilities revamp.

(Task 6.6 and 6.7 UI live with Dispatch 1 so the flow is testable end-to-end.)

## Risk / invariants

- No schema changes — no migration risk.
- No new ledger entries — meter readings don't post to ledger directly; they influence INV-MN amounts via `generateDraftInvoice` only.
- 7 ledger invariants untouched.
- Check-in 422 gate for missing initial reading on monthly is a UX behavior change (existing monthly check-ins would have continued working without). Acceptable since the bug it fixes (baseline=0 wrong calculation) is critical.

## Out of scope

- Photo upload of meter (defer).
- OCR of meter image (defer).
- Multi-property scaling (defer — single property today).
- Notification when reading is overdue (e.g., "5 days before bill date, no reading recorded yet").
