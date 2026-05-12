# Phase I — Polish & Connect: Detailed Sprint Plan

> **Context for the implementing agent:** This plan polishes three rough edges in
> the existing PMS (Thai hotel, Next.js 15 + Prisma + PostgreSQL). Financial flow
> (cashier → ledger → money overview → statements) already works end-to-end.
> These sprints tighten UX feedback, fix a real sync bug, and complete two stubs.
>
> **Conventions:** follow `CLAUDE.md` at repo root — admin/accountant RBAC on all
> mutations, Zod on all API boundaries, `$transaction` for multi-step writes,
> `fmtDate`/`fmtBaht` from `@/lib/date-format`, never `th-TH` locale, never
> `toISOString` for display. UI uses CSS vars (`var(--surface-card)`, etc.) and
> `className="pms-card pms-transition"` for cards.
>
> **Commit cadence:** one commit per numbered task unless otherwise noted.

---

## Sprint 1 — Cashier / CashBox UX Tightening

**Goal:** ให้ `/settings/accounts` แสดงสถานะลิ้นชักแบบ real-time (เปิดกะโดยใคร
เมื่อไหร่ ยอดเปิดเท่าไหร่) + กันปิดลิ้นชักที่มีกะเปิดอยู่ + ให้แคชเชียร์คลิกดู
ledger ของกะตัวเองได้.

**Why:** ผู้ใช้สับสนว่า CashBox กับ CashSession ซ้ำกันหรือไม่. จริงๆ ไม่ซ้ำ
(static vs runtime) แต่ UI ไม่ได้เชื่อมให้เห็นภาพ.

### Files involved
- `prisma/schema.prisma` — `CashBox` (line 1133–1158), `CashSession` (1160–1182)
- `src/app/(dashboard)/settings/accounts/page.tsx` — cash-box tab
- `src/app/(dashboard)/cashier/page.tsx` — active session view + history
- `src/app/api/cash-boxes/route.ts`, `[id]/route.ts`
- `src/app/api/cash-sessions/route.ts`, `[id]/route.ts`
- `src/services/cashSession.service.ts` (check if exists; otherwise create)

### Tasks

**S1.1 — Extend `/api/cash-boxes` GET to include active-session info**
- In the existing list endpoint, add to each row:
  ```
  activeSession: { id, openedByName, openedAt, openingBalance } | null
  ```
- Use one query: `include: { sessions: { where: { status: 'OPEN' }, select: {…}, take: 1 } }` to avoid N+1. Map to `activeSession = sessions[0] ?? null` before returning.
- Do NOT return full session list — only the active one.

**S1.2 — Show active-session badge in cash-box tab UI**
- `settings/accounts/page.tsx` — in the cash-box table, add column **"สถานะกะ"**:
  - If `activeSession === null`: แสดง badge สีเทา `"ว่าง"`.
  - If present: แสดง badge สีเขียว `"🟢 เปิดกะโดย {openedByName}"` + สอง sub-lines:
    - `เปิดเมื่อ {fmtDateTime(openedAt)}`
    - `ยอดเปิด ฿{fmtBaht(openingBalance)}`
- Make the badge clickable → router.push(`/cashier?sessionId={activeSession.id}`).

**S1.3 — Block delete/deactivate when session is OPEN**
- `DELETE /api/cash-boxes/[id]` already blocks if `_count.sessions > 0`. Change
  the block rule to: block only if any session with `status='OPEN'` exists.
  Closed historical sessions should not prevent deactivation — soft-delete is
  fine there (set `isActive=false`).
- Return 409 with Thai message:
  `"ลิ้นชักนี้มีกะเปิดอยู่ ({openedByName}) — ปิดกะก่อนจึงจะปิดลิ้นชักได้"`
- Update the UI delete confirmation to surface this message.

**S1.4 — "ดู ledger ของกะนี้" link from cashier page**
- `cashier/page.tsx` history table — add action column with link:
  `/finance?sessionId={session.id}&from={openedAt}&to={closedAt ?? now}`.
  (Reuses existing `/finance` ledger filter — see if `sessionId` param already
  supported; if not, add it to `/api/ledger` or equivalent. Read
  `src/app/api/ledger/route.ts` first.)
- For OPEN session (top of page): add inline button "ดูรายการเดินบัญชีกะนี้" → same link.

**S1.5 — Prevent double-open on same CashBox**
- `POST /api/cash-sessions` — before insert, check:
  ```ts
  if (input.cashBoxId) {
    const conflict = await tx.cashSession.findFirst({
      where: { cashBoxId: input.cashBoxId, status: 'OPEN' }, select: { id: true, openedByName: true },
    });
    if (conflict) throw new Error(`ลิ้นชักนี้ถูกใช้งานอยู่โดย ${conflict.openedByName}`);
  }
  ```
- Return 409 with the message. UI shows toast.

### Acceptance criteria
- [ ] Open 2 cashiers trying to open the same CashBox → second gets 409.
- [ ] `/settings/accounts` (cash-box tab) shows which drawer is in use + by whom.
- [ ] Clicking the badge jumps to `/cashier` with the relevant session scrolled into view.
- [ ] Trying to delete an in-use drawer shows Thai error, blocks action.
- [ ] Cashier can click history row → sees ledger entries filtered to their shift window.

### Out of scope
- Multi-drawer per user, drawer handover / transfer between cashiers.
- Re-opening a closed session.

---

## Sprint 2 — Room ↔ Housekeeping Sync

**Goal:** ให้สถานะห้อง (`Room.status`) และ `HousekeepingTask.status` sync กัน
อัตโนมัติ — checkout → ห้องเปลี่ยนเป็น `cleaning` + มี task สร้างให้แม่บ้าน;
แม่บ้าน inspect เสร็จ → ห้องเปลี่ยนเป็น `available`.

**Why:** ปัจจุบัน checkout เปลี่ยน `Room.status = 'checkout'` แต่ไม่มี task
สร้างให้แม่บ้านอัตโนมัติ. Staff ต้องไปสร้างเองที่ `/housekeeping` → เสี่ยงลืม.
และการ `inspected` ที่ housekeeping ปัจจุบัน set room='available' แล้ว (OK)
แต่ `completed` (ยังไม่ได้ตรวจ) ไม่เปลี่ยน status — stale state.

### Files involved
- `prisma/schema.prisma` — `Room.status` enum (line 24–30), `HousekeepingTask` (line 330+ish — confirm)
- `src/app/api/checkout/route.ts` — add auto-task creation
- `src/app/api/housekeeping/[id]/route.ts` — status transition logic (line 26 already does 'inspected' → 'available')
- **NEW** `src/services/roomStatus.service.ts` — chokepoint for all Room.status writes
- `src/app/(dashboard)/rooms/page.tsx` — show housekeeping task badge per room

### Tasks

**S2.1 — Create `roomStatus.service.ts` as the single chokepoint**
- Define allowed transitions (explicit state machine):
  ```
  available  → occupied (check-in), reserved (booking), maintenance (admin)
  occupied   → checkout (check-out), maintenance
  reserved   → occupied, available (cancel)
  checkout   → cleaning (auto on task create)
  cleaning   → available (task inspected), maintenance
  maintenance→ available (maintenance done)
  ```
- Export:
  ```ts
  async function transitionRoom(tx, roomId, to: RoomStatus, reason: string, userId: string)
  ```
- Validates transition, writes to `Room.status`, and appends to `ActivityLog`
  (or create `RoomStatusLog` if ActivityLog doesn't take room events — check
  schema first).
- Throw a typed error for invalid transitions — caller translates to 409.

**S2.2 — Migrate existing writers to use `transitionRoom`**
- Grep for all `room.update({ data: { status:` or `room.status` writes:
  ```
  grep -rn "room.update.*status\|room\.status\s*=" src/
  ```
- Each writer should call `transitionRoom` instead. Keep behavior identical —
  just move through the chokepoint. Expected files: checkout route, check-in
  route, reservation, housekeeping `[id]`, roomChange.service, maintenance.

**S2.3 — Auto-create housekeeping task on checkout**
- `src/app/api/checkout/route.ts` — after folio close, in the same `$transaction`:
  ```ts
  // 1. transition room: occupied → checkout → cleaning
  await transitionRoom(tx, booking.roomId, 'cleaning', `checkout-${bookingNumber}`, userId);
  // 2. create housekeeping task
  await tx.housekeepingTask.create({
    data: {
      taskNumber: await nextHkNumber(tx),   // reuse existing helper if any
      roomId: booking.roomId,
      taskType: 'ทำความสะอาดหลังเช็คเอาท์',
      status: 'pending',
      priority: 'normal',
      scheduledAt: new Date(),
      notes: `Auto-generated from ${bookingNumber}`,
    },
  });
  ```
- If `nextHkNumber` helper doesn't exist, add one (similar to existing
  `generateInvoiceNumber`).
- Guard: if room is already in `cleaning` with an open task for this booking,
  skip (idempotent — useful if checkout is retried).

**S2.4 — Task status → room status side effects**
- `src/app/api/housekeeping/[id]/route.ts`:
  - `pending → in_progress`: no room change.
  - `in_progress → completed`: no room change (still dirty until inspected).
  - `completed → inspected`: room → `available` (existing behavior; move to
    `transitionRoom`).
  - `any → cancelled`: no room change.
- All via `transitionRoom` so activity log is consistent.

**S2.5 — Rooms page shows housekeeping state**
- `src/app/(dashboard)/rooms/page.tsx` — for each room card:
  - Fetch `latest open HousekeepingTask` (status in `pending|in_progress|completed`).
  - Show inline badge: icon + assignee name if present.
  - Click → opens `/housekeeping?roomId={id}` (prefilter).
- Add to room cards only, don't alter layout.

### Acceptance criteria
- [ ] Check a guest out → `/rooms` shows the room as `cleaning` + a task appears in `/housekeeping` with status `pending`.
- [ ] Mark task `completed` → room stays `cleaning`.
- [ ] Mark task `inspected` → room → `available`, `/rooms` updates on refresh.
- [ ] Try to set a room from `available → checkout` directly via API → 409 invalid transition.
- [ ] ActivityLog has an entry for every room status change with reason.
- [ ] Existing checkout regression: re-running checkout on the same booking doesn't create duplicate tasks.

### Out of scope
- Configurable cleaning type per room type (quick clean vs deep clean).
- SLA timers on cleaning.
- Mobile housekeeping app.

---

## Sprint 3 — Stub Completion (Payouts + Renewals)

**Goal:** เติมส่วนที่ยังเป็น stub สองจุด: ค่ารอบแม่บ้าน (housekeeping payouts)
และรอบบิลต่อสัญญา (billing cycle renewal).

**Why:** Tabs เหล่านี้มีอยู่ใน UI แล้วแต่ยังไม่ทำงาน → ทีมเก่งผู้ใช้จริงจะ
สะดุดเมื่อกดเข้าไป.

### Part A — Housekeeping Payouts

#### Files involved
- `prisma/schema.prisma` — `MaidPayout` model exists (line 724–736, maidId/amount/payDate/status), `HousekeepingTask.payoutAmount` field
- `src/app/(dashboard)/housekeeping/components/PayoutsTab.tsx` — current stub (~50 lines)
- **NEW** `src/app/api/payouts/route.ts`, `src/app/api/payouts/[id]/route.ts`
- **NEW** `src/services/maidPayout.service.ts`

#### Tasks

**S3.A.1 — Payout calculation service**
- Create `services/maidPayout.service.ts` with:
  ```ts
  async function calculatePendingPayouts(tx, { from, to, maidId? }): Promise<Array<{
    maidId: string; maidName: string;
    taskCount: number; totalAmount: number;
    tasks: Array<{ id, roomNumber, taskType, completedAt, payoutAmount }>;
  }>>
  ```
- Query `HousekeepingTask` where `status='inspected'`, `completedAt` in range,
  AND no existing `MaidPayout` link yet (add `maidPayoutId` nullable FK on
  `HousekeepingTask` in a new migration — required for idempotency).
- Group by `assignedTo` (maid id). Sum `payoutAmount`.

**S3.A.2 — Create payout (admin only)**
- `POST /api/payouts` — input: `{ maidId, from, to, payMethod }`.
- Inside `$transaction`:
  1. Recompute pending for that maid/range.
  2. Create `MaidPayout` row.
  3. Mark involved tasks → set `maidPayoutId`.
  4. Post ledger: `DR EXPENSE (wages sub-account) / CR CASH|BANK`
     (use `postLedgerPair` with debitSubKind='WAGES' or `'OTHER_EXPENSE'` if no
     wages subkind yet — add one to `AccountSubKind` enum if missing).

**S3.A.3 — PayoutsTab UI**
- Two views toggled by tab inside PayoutsTab:
  1. **"รอจ่าย"** — list pending groups from
     `GET /api/payouts/pending?from=…&to=…`. Each row expandable to see tasks.
     Button "จ่าย" → confirm modal → calls POST.
  2. **"ประวัติ"** — list `MaidPayout` rows with filter by date range.
- Use `GoogleSheetTable<T>` per CLAUDE.md §5. KPI cards on top:
  - จำนวนแม่บ้านที่รอจ่าย, ยอดรวมรอจ่าย, จ่ายไปแล้วเดือนนี้.

**S3.A.4 — Void payout (admin)**
- `DELETE /api/payouts/[id]` — within `$transaction`:
  1. Unmark tasks (`maidPayoutId = null`).
  2. Post reversal ledger pair.
  3. Set `MaidPayout.status = 'voided'`, `voidedAt`, `voidedBy`.

#### Acceptance criteria
- [ ] Mark 3 tasks inspected → PayoutsTab pending shows the maid with sum.
- [ ] Click "จ่าย" → MaidPayout created, tasks linked, ledger has DR EXPENSE / CR CASH (or BANK).
- [ ] `/finance` shows the new expense entry.
- [ ] Pending list no longer shows those tasks.
- [ ] Void → reverses everything.

---

### Part B — Billing Cycle Renewal

#### Files involved
- `prisma/schema.prisma` — `Invoice.billingPeriodStart/End` (line 531–533) already exist; `latePenalty` field (513)
- `src/app/(dashboard)/billing-cycle/page.tsx` — tab bar has "ต่อสัญญา" (renewal)
- `src/services/billing.service.ts` — existing monthly invoice logic
- **NEW** `src/app/(dashboard)/billing-cycle/components/RenewalTab.tsx`
- **NEW** `src/app/api/billing-cycle/renewals/route.ts`

#### Tasks

**S3.B.1 — Identify due bookings**
- `GET /api/billing-cycle/renewals?asOf=YYYY-MM-DD` — returns long-stay/monthly
  bookings (filter `bookingType='monthly'` and `status='checked_in'`) where
  the last invoice's `billingPeriodEnd < asOf + 7 days` OR no invoice exists
  for the next period.
- Return `{ bookingId, bookingNumber, guestName, roomNumber, rate, nextPeriodStart, nextPeriodEnd, daysUntilDue, lastInvoiceId|null }`.

**S3.B.2 — Generate renewal invoice**
- `POST /api/billing-cycle/renewals` — input: `{ bookingId, periodStart, periodEnd, dueDate, createdBy }`.
- Reuses `folio.service.createInvoiceFromFolio` under `$transaction`. First
  adds a `FolioLineItem` chargeType=`ROOM` for the new period (amount =
  rate × nights), then calls the folio invoice builder. Phase H VAT/service
  automatically applies if enabled.
- Return the created `Invoice`.

**S3.B.3 — RenewalTab UI**
- Table with due bookings, default date range = next 7 days.
- Row actions:
  - **"ดูใบล่าสุด"** → open last invoice in new tab.
  - **"ออกรอบใหม่"** → modal confirming period + dueDate → POST → toast.
- Bulk action: checkbox column + "ออกใบทั้งหมดที่เลือก" button. Use `Promise.all`
  on server (inside a single `$transaction`) — max 20 at a time to avoid long
  locks.
- KPI cards: ค้างออก, ออกเดือนนี้ไปแล้ว, ยอดรวมที่จะเก็บ.

**S3.B.4 — Auto-run scheduler (optional)**
- Add a cron-ready endpoint `POST /api/cron/billing-cycle` that runs
  `generate for all due today`. Guard with a header secret env var
  (`CRON_SECRET`). Do NOT wire to a real cron yet — just document in
  endpoint JSDoc.

#### Acceptance criteria
- [ ] A monthly booking near its period end appears in the renewal tab.
- [ ] Click "ออกรอบใหม่" → new Invoice created with correct period dates.
- [ ] VAT/service calculated per HotelSettings (if enabled).
- [ ] Idempotency: running again for the same period → skipped with message.
- [ ] Bulk flow creates N invoices in one transaction; failure rolls all back.

---

## Execution order & handoff notes

1. **Sprint 2 first** (the real bug), then **Sprint 1** (UX), then **Sprint 3** (stubs).
2. Each sprint should merge before the next starts — they touch different
   services so conflicts are minimal, but clean history helps.
3. Run after each sprint:
   - `npx prisma generate` (Sprint 2 adds columns; Sprint 3.A adds `maidPayoutId`)
   - `npx prisma migrate deploy`
   - `npm run typecheck`
   - Manually smoke-test the acceptance criteria list.
4. Never skip the `assertPeriodOpen` guard (already in `postLedgerPair`) —
   don't introduce back-dated payouts without opening the period.
5. On any UI, default to **read existing patterns** (GoogleSheetTable, KPI
   cards, CSS vars) rather than reinventing. See `/sales/page.tsx` as the
   reference implementation per `CLAUDE.md` §5.

## What NOT to do

- Don't refactor the existing cashier/housekeeping code beyond what the tasks
  require — we'll accumulate unrelated diffs and slow review.
- Don't add fancy real-time (WebSocket) — polling on navigation is fine.
- Don't introduce new role names; reuse `admin`/`accountant`/`manager`/`staff`.
- Don't change the `ledger_entries` immutability invariant. Reversals are
  always new entries with opposite signs.
