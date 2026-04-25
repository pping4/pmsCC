# Sprint 2b — Housekeeping Request Model + Table-First UX

**Context:** Sprint 2 added auto-checkout cleaning. This sprint covers the **mid-stay cleaning** cases the user described:

- **รายวัน (daily booking):** Default = ทำความสะอาดทุกวัน. ระบบต้องสร้าง task ให้อัตโนมัติทุกคืน **เว้นแต่** ลูกค้าแจ้ง **ไม่เอา** (แขวนป้าย DND / โทรลงมา / กดผ่านระบบ) → ยกเลิก task ของวันนั้น (opt-out model).
- **รายเดือน (monthly booking):** ไม่ทำอัตโนมัติ. พนักงาน Front ต้อง **เก็บค่าบริการ** + สั่งงานแม่บ้านเอง. รองรับ **จองล่วงหน้า / recurring** (เช่น ทุกวันศุกร์).
- **Night audit:** สร้าง daily-cleaning tasks ให้ทุก daily booking ที่ active + generate recurring schedules สำหรับ monthly + advisory report.
- **UX:** ใช้ `GoogleSheetTable` filter/group/sort ให้เต็มประสิทธิภาพ. แทนที่จะสร้างหน้าใหม่เยอะ ใช้ table view เดิมต่อยอด.

---

## Design Overview

### New concept: **Request source** on HK task

ทุก `HousekeepingTask` มี `requestSource` บอกว่าทำไมถึงเกิด:

| requestSource | ใครสร้าง | Chargeable? | ตัวอย่าง |
|---|---|---|---|
| `auto_checkout` | system | ❌ | เช็คเอาท์ (Sprint 2 existing) |
| `daily_auto` | system (night audit) | ❌ | รายวัน — auto-create ทุกคืน |
| `guest_decline` | front staff / guest app | ❌ | ลูกค้ารายวันแจ้งไม่เอา → **cancel** daily task นั้น |
| `guest_request` | front staff on behalf / guest app | ⚠ optional | ขอพิเศษ (เช่น ขอเพิ่มรอบ) |
| `monthly_scheduled` | front staff | ✅ default | รายเดือน รายครั้ง |
| `recurring_auto` | system (cron) | ✅ | จาก `CleaningSchedule` (รายเดือนเท่านั้น) |
| `manual` | front/hk staff | configurable | ad-hoc เช่น deep clean |
| `maintenance_followup` | system | ❌ | หลัง maintenance ยังคงเดิม |

**Note:** `guest_decline` ไม่ใช่ task type — เป็น action ที่ **cancel** daily task ที่ระบบสร้างไว้ (status → `cancelled`, เก็บ reason + channel ใน metadata). Decline เป็น log entry ที่ต้องค้นย้อนดูได้ (ใคร/เมื่อไหร่/ช่องทางไหน).

### Chargeable cleaning → folio line item

ถ้า `chargeable=true && fee>0` และ booking ยัง `checked_in`:
- สร้าง `FolioLineItem` type `HOUSEKEEPING` (ใหม่) ใน folio ของ booking นั้น
- เก็บเงินตอน billing cycle ปกติ / invoice ถัดไป
- ใช้ `folio.service.addCharge` ที่มีอยู่

---

## Data Model

### 1. Extend `HousekeepingTask`

```prisma
model HousekeepingTask {
  // ... existing fields
  requestSource       HKRequestSource @default(manual) @map("request_source")
  chargeable          Boolean         @default(false)
  fee                 Decimal?        @db.Decimal(10,2)
  bookingId           String?         @map("booking_id")       // ⬅ NEW: link for chargeable
  folioLineItemId     String?         @map("folio_line_item_id") @unique
  scheduleId          String?         @map("schedule_id")      // ⬅ NEW: if from CleaningSchedule
  requestedAt         DateTime?       @map("requested_at")     // when guest/staff requested
  requestedBy         String?         @map("requested_by")     // staff userId or 'guest'
  requestChannel      HKRequestChannel? @map("request_channel") // door_sign|phone|app|front_desk|system

  booking             Booking?        @relation(fields: [bookingId], references: [id])
  folioLineItem       FolioLineItem?  @relation(fields: [folioLineItemId], references: [id])
  schedule            CleaningSchedule? @relation(fields: [scheduleId], references: [id])
}

enum HKRequestSource {
  auto_checkout
  guest_request
  monthly_scheduled
  recurring_auto
  manual
  maintenance_followup
}

enum HKRequestChannel {
  door_sign
  phone
  guest_app
  front_desk
  system
}
```

### 2. New model `CleaningSchedule` (recurring)

```prisma
model CleaningSchedule {
  id              String   @id @default(cuid())
  roomId          String   @map("room_id")
  bookingId       String?  @map("booking_id")   // scope to a specific stay
  // Recurrence: either cadenceDays OR weekdays (bitmask Mon..Sun) but not both
  cadenceDays     Int?     @map("cadence_days") // e.g., every 3 days
  weekdays        Int?                           // bitmask: 0b0000001=Mon .. 0b1000000=Sun
  timeOfDay       String?  @map("time_of_day")  // "10:00" default
  activeFrom      DateTime @map("active_from")
  activeUntil     DateTime? @map("active_until")
  fee             Decimal? @db.Decimal(10,2)    // inherited to each generated task
  chargeable      Boolean  @default(true)
  notes           String?
  priority        HKPriority @default(normal)
  createdBy       String?  @map("created_by")
  createdAt       DateTime @default(now()) @map("created_at")
  isActive        Boolean  @default(true) @map("is_active")

  room     Room     @relation(fields: [roomId], references: [id])
  booking  Booking? @relation(fields: [bookingId], references: [id])
  tasks    HousekeepingTask[]

  @@index([roomId, isActive])
  @@index([bookingId])
  @@map("cleaning_schedules")
}
```

### 3. Migration safety
- All new columns/tables nullable + additive
- Backfill: `requestSource` on existing rows → infer from `taskType` (`checkout_cleaning` → `auto_checkout`, rest → `manual`)

---

## Tasks

### S2b.1 — Schema + migration (foundation)
**File:** `prisma/schema.prisma` + new migration folder
- Add enums `HKRequestSource`, `HKRequestChannel`
- Extend `HousekeepingTask` with fields above
- Create `cleaning_schedules` table
- Backfill script in migration SQL for existing `request_source`

**Acceptance:**
- `npx prisma migrate deploy` applies cleanly
- Existing HK tasks show `requestSource='auto_checkout'` (if checkout type) else `'manual'`

---

### S2b.2 — Service layer: `housekeeping.service.ts` expansion
**File:** `src/services/housekeeping.service.ts`

Add functions:
```ts
createDailyAutoTask(tx, { roomId, bookingId, forDate })       // night audit, daily booking
cancelDailyTaskAsDecline(tx, { taskId, channel, requestedBy, notes })
createGuestRequestTask(tx, { roomId, bookingId, channel, requestedBy, notes, chargeable?, fee? })
createScheduledTask(tx, { roomId, bookingId, scheduleId?, scheduledAt, fee, priority, notes })
createManualTask(tx, { ... })  // generalize existing
generateTasksFromSchedule(tx, { scheduleId, forDate }) // called by cron
```

Behavior:
- All create paths still dedupe against OPEN tasks (`pending`/`in_progress`) for same room
- If `chargeable=true && bookingId`: call `folio.service.addCharge(chargeType='HOUSEKEEPING')` inside same tx; link `folioLineItemId` on the task
- Add `chargeType='HOUSEKEEPING'` to folio charge types (schema + enum)

**Acceptance:**
- Unit-ish test: creating a chargeable task on a checked-in booking creates matching folio line item
- Removing the task (cancel) voids the line item

---

### S2b.3 — API routes

**New:**
- `POST /api/housekeeping/guest-request` — ขอพิเศษ/ขอเพิ่มรอบ. Body: `{ roomId, bookingId?, channel, notes?, chargeable?, fee? }`
- `POST /api/housekeeping/[id]/decline` — ลูกค้ารายวันแจ้งไม่เอา. Body: `{ channel, requestedBy?, notes? }`. Cancels a `pending` daily_auto task. Returns 409 if task already `in_progress`/`completed`.
- `POST /api/housekeeping/schedule` — create `CleaningSchedule` (monthly only enforced at service layer)
- `GET /api/housekeeping/schedule?roomId=&bookingId=` — list
- `PATCH /api/housekeeping/schedule/[id]` — pause/resume/edit
- `DELETE /api/housekeeping/schedule/[id]` — soft delete (`isActive=false`)

**Extend:**
- `POST /api/housekeeping` (existing) — accept `requestSource`, `chargeable`, `fee`, `bookingId`, `requestChannel`
- `GET /api/housekeeping` — expose new fields + filter params `requestSource`, `chargeable`, `scheduleId`

**Cron/night-audit (NEW route, idempotent):**
- `POST /api/cron/housekeeping-daily` — runs at 00:30
  1. **Daily bookings still checked-in** (not checking out today): create one `daily_auto` HK task for today per booking. Dedupe if already exists.
  2. **Checkout-today bookings**: skip (checkout flow already creates `auto_checkout`).
  3. **Active `CleaningSchedule`** whose recurrence matches today: create scheduled task (dedup).
  4. **Monthly bookings** with no cleaning in last 7 days AND no active schedule: log advisory to ActivityLog (severity='warning', category='night_audit') — do not auto-create.
  5. Write summary row: "night audit: D daily tasks, S scheduled tasks, A advisories".

**Idempotency key pattern:** `hk-daily-{bookingId}-{YYYY-MM-DD}` on task metadata → re-runs do not duplicate.

---

### S2b.4 — Table-first UX (the heart of this sprint)

Use existing `GoogleSheetTable<T>` everywhere. **No new bespoke components.**

#### A. `/housekeeping` page — rebuild as `GoogleSheetTable`
**File:** `src/app/(dashboard)/housekeeping/page.tsx`

Columns (all filter/sort/group via dropdown):
1. Task # (`taskNumber`)
2. ห้อง (`room.number`) — **group-by candidate**
3. ชั้น (`room.floor`)
4. ประเภทงาน (`taskType`) — badge
5. ที่มา (`requestSource`) — badge, colored:
   - `daily_auto` = emerald
   - `guest_request` = sky
   - `monthly_scheduled` / `recurring_auto` = violet
   - `auto_checkout` = gray
   - `manual` = slate
   - (decline shows as `cancelled` status + channel icon)
6. ช่องทาง (`requestChannel`) — door_sign 🏷️ / phone 📞 / guest_app 📱 / front_desk 🛎
7. สถานะ (`status`) — badge
8. ลำดับความสำคัญ (`priority`)
9. เก็บค่าบริการ (`chargeable` + `fee`) — ✅ ฿300 / —
10. ผู้รับผิดชอบ (`assignedTo`)
11. กำหนด (`scheduledAt`) — fmtDateTime
12. อายุงาน (derived: hours since `createdAt`) — sort
13. การกระทำ (buttons: Start / Complete / Cancel / Assign)

**KPI cards row** (required per CLAUDE.md):
- Pending count (with trend)
- In progress
- Overdue (scheduled past, not complete) — red
- ค่าบริการค้างเก็บ vs เก็บแล้ววันนี้ — mini bar
- วันนี้ต้องทำ (scheduled today) — daily/monthly split donut

**Default view groupings** (user can toggle via filter dropdown):
- By `status`
- By `room.floor` (shift-supervisor view)
- By `assignedTo`

#### B. `/housekeeping/schedules` page — new, also `GoogleSheetTable`
Lists all `CleaningSchedule` rows. Columns:
- ห้อง, Booking #, guest, รอบ (every X days / weekdays), ค่าบริการ, active until, สถานะ (active/paused)
- Row actions: Pause/Resume, Edit, Delete

"+ เพิ่มรอบทำความสะอาด" dialog: multi-step wizard per `.claude/skills/multi-step-dialog-wizard.md`
  1. เลือกห้อง/booking (prefilled if launched from booking detail)
  2. รอบทำความสะอาด (every N days vs weekdays picker)
  3. ค่าบริการ + chargeable toggle
  4. Summary

#### C. Per-room HK timeline (answers user Q3 "ประวัติห้องนี้")
**File:** `src/app/(dashboard)/rooms/components/RoomHistoryTab.tsx` (new)

Launch from existing room detail drawer. Content:
- KPI mini-cards: ทำความสะอาดทั้งหมด X ครั้ง (30d / all time), เฉลี่ยทุก Y วัน, ค่าบริการรวม ฿Z
- Small `GoogleSheetTable` with: `completedAt`, `taskType`, `requestSource`, `assignedTo`, `fee`, notes
- Tiny recharts bar chart: tasks per week (last 12 weeks)

#### D. Booking detail panel — "แจ้งทำความสะอาด" button
**File:** `src/app/(dashboard)/reservation/components/DetailPanel.tsx`

- Show: last cleaning date, today's task status (daily booking: "กำหนดทำ 10:00 โดย X" / "ลูกค้ายกเลิก 🚫 ทางโทรศัพท์ 08:45"), active schedule (monthly), pending tasks
- **Daily booking actions:**
  - Button "🚫 ลูกค้าแจ้งไม่เอา" (visible only when today's `daily_auto` task is `pending`) → mini dialog:
    - Channel: radio (door_sign / phone / guest_app / front_desk)
    - Notes (optional)
    - Submit → `POST /api/housekeeping/[id]/decline`
  - Button "+ ขอพิเศษ" → `guest_request` (ขอเพิ่มรอบ / ขอ deep clean)
- **Monthly booking actions:**
  - Button "+ แจ้งแม่บ้าน" → `POST /api/housekeeping/guest-request` (chargeable default on, fee from settings)
  - Button "+ ตั้งรอบประจำ" → schedule dialog from S2b.4.B

---

### S2b.5 — Night audit

**File:** `src/app/api/cron/housekeeping-daily/route.ts` (new)

- Protect via existing cron secret pattern (if any) or bearer token
- Runs the three sweeps from S2b.3
- Idempotent (can be re-run; dedupes)

**Advisory surface:**
- `/housekeeping` page KPI: "แจ้งเตือน night audit" — count of unread advisories (reads from ActivityLog)
- Dismiss per advisory → mark as read in ActivityLog metadata

---

### S2b.6 — Hotel settings

**File:** `src/app/(dashboard)/settings/housekeeping/page.tsx` (new or extend existing settings)

Single settings doc (seed one row):
- ค่าบริการทำความสะอาดรายเดือน default (฿)
- ค่าบริการ ad-hoc default (฿)
- เวลาเริ่มงานแม่บ้าน (morning shift)
- แจ้งเตือน: daily room ที่ค้างเกิน N คืนโดยไม่เคยขอทำความสะอาด — default N=3

Used by night audit + dialog default fee.

---

## File inventory (for executing agent)

**Schema/migration**
- `prisma/schema.prisma`
- `prisma/migrations/<date>_hk_request_model/migration.sql`

**Services**
- `src/services/housekeeping.service.ts` (extend)
- `src/services/folio.service.ts` (add `HOUSEKEEPING` chargeType)
- `src/services/cleaning-schedule.service.ts` (new)

**API**
- `src/app/api/housekeeping/route.ts` (extend)
- `src/app/api/housekeeping/guest-request/route.ts` (new)
- `src/app/api/housekeeping/schedule/route.ts` (new)
- `src/app/api/housekeeping/schedule/[id]/route.ts` (new)
- `src/app/api/cron/housekeeping-daily/route.ts` (new)

**UI**
- `src/app/(dashboard)/housekeeping/page.tsx` (rebuild on `GoogleSheetTable`)
- `src/app/(dashboard)/housekeeping/schedules/page.tsx` (new)
- `src/app/(dashboard)/housekeeping/components/RequestCleaningDialog.tsx` (new)
- `src/app/(dashboard)/housekeeping/components/ScheduleDialog.tsx` (new)
- `src/app/(dashboard)/rooms/components/RoomHistoryTab.tsx` (new — answers Q3)
- `src/app/(dashboard)/reservation/components/DetailPanel.tsx` (add section + buttons)

---

## Verification checklist

- [ ] รายวัน booking: night audit auto-creates one `daily_auto` task per day. Guest decline → task cancelled with channel logged.
- [ ] Daily decline: rejected (409) if task already `in_progress`/`completed`.
- [ ] รายเดือน booking: no auto task. Staff manually requests, fee lands on folio automatically.
- [ ] Recurring schedule (monthly): cron generates one task per day per schedule, deduped.
- [ ] Checkout still auto-creates HK task (Sprint 2 unchanged).
- [ ] `GoogleSheetTable` filter/sort/group works on every column listed in S2b.4.A.
- [ ] Per-room history tab shows chronological timeline + count + average cadence.
- [ ] All money formatted via `fmtBaht`; all dates via `fmtDate`/`fmtDateTime`.
- [ ] All API routes return JSON on error (top-level try/catch) — per Sprint 2 fix pattern.

---

## Out of scope (defer)

- Guest-facing mobile app request flow (only staff-on-behalf for now)
- SMS/push notification to HK staff (UI badge only)
- Photo upload proof-of-clean
- Supplies inventory depletion per task
