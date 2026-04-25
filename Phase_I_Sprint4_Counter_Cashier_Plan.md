# Sprint 4 — Counter-Centric Cashier Redesign

**Status:** DRAFT — รอรีวิวก่อนเริ่มทำ
**Owner:** PMS Team
**Date:** 2026-04-22
**Scope:** Cashier + Check-in/Check-out + Payment subsystem

---

## 0. ปัญหาที่ต้องแก้ (จากการสำรวจระบบ)

ระบบ CashBox/CashSession/Payment ที่มีอยู่ **ทำงานได้** แต่ลื่นเกินไป — ไม่มีอะไรแบ่งเคาน์เตอร์ชัด:

| # | ปัญหา | จุดที่เกิด |
|---|---|---|
| P1 | `CashBox` (counter) เป็น **nullable** บน CashSession — เปิดกะโดยไม่ผูกเคาน์เตอร์ก็ได้ | `cashSession.service.ts:24-59` |
| P2 | Payment service **ไม่ตรวจ ownership** ของ session — Cashier B ใส่ `cashSessionId` ของ Cashier A ก็ผ่าน | `payment.service.ts:79-92` |
| P3 | `GET /api/cash-sessions/[id]` ตรวจสิทธิ์ด้วย **name string** (BUG) ควรเป็น `id` | `cash-sessions/[id]/route.ts:32` |
| P4 | Check-in รับ `cashSessionId` จาก body **โดยไม่ตรวจ ownership** | `checkin/route.ts:157-161` |
| P5 | UI Check-in ต้องให้ผู้ใช้เลือก/พิมพ์ session — UX แย่, ผิดได้ง่าย | DetailPanel check-in dialog |
| P6 | Refund close-out **ไม่ filter ตาม session** — รวม refund ของกะอื่นมาด้วย | `cashSession.service.ts:118-128` |
| P7 | One user = one global session — ถ้า cashier ย้ายเคาน์เตอร์กลางวัน ระบบไม่รู้ | (architectural) |
| P8 | ไม่มี **shift handover** — เปลี่ยนกะระหว่างวันต้องปิด-เปิดใหม่แบบ manual | (architectural) |

**ผลกระทบ check-in:**
- ผู้ใช้ต้อง "เลือก cash session" จาก dropdown — สับสน, ไม่ใช่ภาษาธุรกิจ
- ถ้าลืมเปิดกะก่อน check-in → 422 error กลางทาง — UX แตก
- ถ้าเปิดกะ 2 อันโดยบังเอิญ → เงินไหลผิดเคาน์เตอร์

---

## 1. หลักการออกแบบใหม่ (Design Principles)

> **"Counter เป็นตัวตั้ง — ไม่ใช่เลือกเอง, ระบบรู้ให้"**

1. **Counter = เคาน์เตอร์กายภาพ**: ลิ้นชักเงิน + เครื่องคิดเงิน + ผู้ใช้ที่นั่งอยู่
2. **กฎเชิงโลกจริง:**
   - หนึ่งเคาน์เตอร์ → มีผู้ใช้ผูกอยู่ **ได้ครั้งละ 1 คน**
   - หนึ่งผู้ใช้ → ผูกได้ **ครั้งละ 1 เคาน์เตอร์**
   - ระหว่างวันมี **หลายเคาน์เตอร์** ทำงานพร้อมกันได้ (เช่น 2 เคาน์เตอร์ front desk)
3. **Cashier เปิดกะโดยเลือก Counter** — ไม่ใช่ "เปิด session แล้วหวังว่ามี counter"
4. **การ check-in/check-out/payment ทุกครั้ง** → server ใช้ session ของผู้ใช้ปัจจุบันโดย **อัตโนมัติ** (ผู้ใช้ไม่เห็น `cashSessionId`)
5. **Server-side ownership** เป็น layer สุดท้าย — ทุก write ตรวจ `session.openedBy === currentUser` + `session.cashBoxId` เป็น source of truth
6. **ไม่ break ข้อมูลเดิม** — migration backfill ทุกแถวเก่า

---

## 2. Data Model (ส่วนที่ต้องเปลี่ยน)

### 2.1 Rename เพื่อความชัดเจน (optional, low-risk)
**ไม่บังคับ rename** — ใช้ทับศัพท์ในแผนนี้:
- `CashBox` ⟷ "เคาน์เตอร์ / Counter" (UI label เป็นไทย, table name คงเดิม)
- `CashSession` ⟷ "กะ / Shift" (UI label, table คงเดิม)

### 2.2 Schema diff (additive)

```prisma
model CashSession {
  // ... existing fields ...

  // CHANGED: cashBoxId — was nullable, becomes REQUIRED after migration
  cashBoxId           String                          // ← drop ?
  cashBox             CashBox        @relation(...)   // ← drop ?
  // (Phase 1: เพิ่ม @default หรือ backfill ก่อนค่อย NOT NULL)

  // NEW: lifecycle markers ที่ละเอียดขึ้น
  handoverFromId      String?                         // ถ้ากะนี้รับช่วงต่อจากกะเก่า
  handoverFrom        CashSession?   @relation("Handover", fields: [handoverFromId], references: [id])
  handoverTo          CashSession?   @relation("Handover")

  // NEW: lock เพื่อป้องกันสองคนเปิดเคาน์เตอร์เดียวกัน
  // (ใช้คู่กับ unique partial index ด้านล่าง)
  @@index([cashBoxId, status])
}

// NEW: unique partial index — เคาน์เตอร์หนึ่งมี OPEN session ได้ครั้งเดียว
// (สร้างใน migration SQL — Prisma ยังไม่รองรับ partial index แบบ native)
// CREATE UNIQUE INDEX cash_session_one_open_per_box
//   ON "cash_sessions" ("cashBoxId") WHERE "status" = 'OPEN';

// NEW: unique partial index — ผู้ใช้หนึ่งคนมี OPEN session ได้ครั้งเดียว
// CREATE UNIQUE INDEX cash_session_one_open_per_user
//   ON "cash_sessions" ("openedBy") WHERE "status" = 'OPEN';

model CashBox {
  // ... existing fields ...

  // NEW: ใครกำลังนั่งอยู่ตอนนี้ (denormalized — sync ด้วย trigger หรือ service layer)
  currentSessionId    String?        @unique
  currentSession      CashSession?   @relation("Current", fields: [currentSessionId], references: [id])

  // NEW: ตำแหน่งทางกายภาพ (UX — แสดงในรายการเลือก)
  location            String?        // เช่น "Lobby - หน้าเคาน์เตอร์ 1"
  displayOrder        Int            @default(0)
}

model Payment {
  // ... existing fields ...

  // CHANGED: cashSessionId — ยังคง nullable เพราะ non-cash ไม่ต้องมี
  //   แต่เพิ่ม invariant ที่ service-layer:
  //   "ถ้า paymentMethod='cash' → cashSessionId NOT NULL"

  // NEW: ผูกกับเคาน์เตอร์โดยตรง (denormalized เพื่อ reporting ที่ไม่ต้อง join)
  cashBoxId           String?        // null สำหรับ non-cash
  cashBox             CashBox?       @relation(fields: [cashBoxId], references: [id])

  @@index([cashBoxId, paymentDate])
}
```

### 2.3 ทำไมต้อง denormalize `cashBoxId` ลง Payment?
- รายงาน "เงินสดที่เคาน์เตอร์ 1 วันนี้" → query ตรง ไม่ต้อง 2-hop
- audit trail แข็งแรง — ถ้า session ถูก soft-delete หรือ migrate id ก็ยังตามได้
- ตรง mental model ของ accountant

### 2.4 ข้อมูลเดิม — Migration plan
1. **Step 1 (additive)**: เพิ่ม columns `cashBoxId`, `currentSessionId`, `location`, `displayOrder`, `handoverFromId` แบบ nullable
2. **Step 2 (backfill)**:
   - สร้าง CashBox `LEGACY-COUNTER-1` ถ้าไม่มี
   - `UPDATE cash_sessions SET cashBoxId='LEGACY-COUNTER-1' WHERE cashBoxId IS NULL`
   - `UPDATE payments SET cashBoxId = (SELECT cashBoxId FROM cash_sessions WHERE cash_sessions.id = payments.cashSessionId)`
3. **Step 3 (constrain)**: `ALTER COLUMN cashBoxId SET NOT NULL` บน CashSession + เพิ่ม partial unique indexes
4. **Step 4**: drop `Phase B` doc-comment ใน schema

---

## 3. User Flows (ภาพใหญ่)

### 3.1 เริ่มกะ (Open Shift)
```
[Cashier login]
   │
   ▼
[หน้าแรก /cashier]
   ├── ถ้าไม่มี OPEN session → "เลือกเคาน์เตอร์เพื่อเริ่มกะ"
   │       │
   │       ▼
   │   [แสดง list เคาน์เตอร์ active ที่ยังว่าง]
   │       │  เคาน์เตอร์ 1  [ว่าง]  → คลิก
   │       │  เคาน์เตอร์ 2  [นาย A กำลังใช้]  → disabled
   │       │
   │       ▼
   │   [กรอกเงินเปิดลิ้นชัก ฿2,000] → บันทึก
   │       │
   │       ▼
   │   CashSession.create({ openedBy=me, cashBoxId=ที่เลือก, status=OPEN })
   │
   └── ถ้ามี OPEN session แล้ว → เข้าหน้าทำงานเลย
```

### 3.2 ระหว่างกะ — รับเงิน (โปร่งใสต่อผู้ใช้)
```
[Cashier ทำ check-in / check-out / รับชำระ]
   │
   ▼
[Frontend ไม่แสดง / ไม่ส่ง cashSessionId]
   │
   ▼
[API: server หา OPEN session ของ session.user.id เอง]
   │  ถ้าไม่เจอ + paymentMethod=cash → 412 PRECONDITION_FAILED
   │      "กรุณาเปิดกะก่อนรับเงินสด" + ปุ่มลิงก์ไปหน้าเปิดกะ
   │
   ▼
[Payment.create({ cashSessionId=auto, cashBoxId=auto, ... })]
```

### 3.3 ส่งกะ (Hand-over) — ต่อกะให้คนถัดไป
```
[Cashier A ต้องการส่งกะให้ B ที่เคาน์เตอร์เดียวกัน]
   │
   ▼
[หน้า /cashier กด "ส่งกะ"]
   │
   ▼
[Modal: นับเงินในลิ้นชัก ฿X,XXX]
   │
   ▼
[Modal: เลือกผู้รับช่วง = นาย B + กรอกรหัส B]
   │
   ▼
[Server transaction:
    1. close session A (closingBalance, postOverShort)
    2. open session B (handoverFromId=A.id, openingBalance=A.closingBalance, cashBoxId=เดิม)
    3. CashBox.currentSessionId → B.id
 ]
   │
   ▼
[B ล็อกอินและพร้อมใช้งานทันที — ไม่ต้องเปิดกะใหม่]
```

### 3.4 ปิดกะ (End-of-day)
```
[Cashier กด "ปิดกะ"]
   │
   ▼
[Modal นับเงิน → over/short]
   │
   ▼
[Confirm → close session, post over-short, CashBox.currentSessionId = NULL]
```

---

## 4. Service-layer Changes

### 4.1 `cashSession.service.ts`
- `openCashSession`: **บังคับ `cashBoxId`**, ตรวจ partial unique index จะ throw P2002 → translate เป็น `COUNTER_BUSY`
- เพิ่ม `getActiveSessionForUser(userId)` — helper เดี่ยว
- เพิ่ม `handoverSession(fromSessionId, toUserId, countedCash, openingBalance)` — close+open ใน 1 tx

### 4.2 `payment.service.ts`
- เพิ่ม **2 invariants**:
  1. ถ้า `paymentMethod='cash'` → ต้อง resolve `cashSessionId` จาก `currentUser` (ไม่รับจาก client)
  2. `cashBoxId` ต้อง = `session.cashBoxId` (denormalize ตอนเขียน)
- ลบ `cashSessionId` ออกจาก input shape ของ public API (อ่านจาก `Authorization`/session แทน)

### 4.3 `checkin.service` / route
- ลบ field `cashSessionId` และ `depositCashSessionId` จาก request body
- Server resolve session จาก `getActiveSessionForUser(currentUser)` ตอนรู้ว่าจะรับเงินสด
- ถ้าไม่มี session → 412 + body `{ code: 'NO_OPEN_SHIFT', cta: '/cashier/start' }`

### 4.4 `checkout` route — เหมือนกัน

---

## 5. API Changes (สรุปสั้น)

| Endpoint | Change |
|---|---|
| `POST /api/cash-sessions` | บังคับ `cashBoxId` ใน body, return 409 `COUNTER_BUSY` |
| `GET /api/cash-sessions/current` | คงเดิม (filter โดย openedBy) |
| `POST /api/cash-sessions/[id]/handover` | **ใหม่** — body: `{ toUserId, countedCash }` |
| `PUT /api/cash-sessions/[id]` (close) | ตรวจ ownership ด้วย `id` (แก้ P3 bug) |
| `GET /api/cash-boxes` | คงเดิม + เพิ่ม `currentSessionId`, `currentUser` ใน response |
| `GET /api/cash-boxes/available` | **ใหม่** — เคาน์เตอร์ที่ active + ไม่มี OPEN session |
| `POST /api/payments` | ลบ `cashSessionId` จาก body — server resolve เอง |
| `POST /api/checkin` | ลบ `cashSessionId`, `depositCashSessionId` |
| `POST /api/checkout` | ลบ `cashSessionId` |

**Backward compat:** เก็บ `cashSessionId` ใน body schema เป็น **deprecated optional** (warn log ถ้ามี); ลบจริงใน Sprint 5.

---

## 6. UI Changes

### 6.1 หน้า `/cashier` (รื้อใหม่)
**State 1 — ยังไม่เปิดกะ:**
- Card ใหญ่ "เลือกเคาน์เตอร์เพื่อเริ่มกะ"
- Grid เคาน์เตอร์: ว่าง (เขียว, คลิกได้) / มีคนใช้ (เทา, แสดงชื่อ)
- คลิก → modal กรอกเงินเปิด → POST → redirect

**State 2 — กะเปิดอยู่:**
- Header: "🟢 กะเปิดอยู่ — เคาน์เตอร์ {name} — เปิดมาแล้ว 2 ชม. 30 น."
- KPI: เงินสดรับวันนี้, จำนวน transaction
- Tab: รายการชำระวันนี้ (filter ตาม session) / Refund / สรุป
- ปุ่มมุมขวา: **ส่งกะ** | **ปิดกะ**

### 6.2 หน้า Check-in (DetailPanel) — เปลี่ยนเล็ก
- **ลบ** dropdown "เลือก cash session"
- **เพิ่ม** บรรทัด info เล็ก ๆ: "💰 เงินสดจะเข้ากะ: เคาน์เตอร์ 1 (คุณ)"
- ถ้าไม่มี OPEN shift และ user เลือก paymentMethod=cash → แสดง warning แดง + ปุ่ม "เปิดกะก่อน" (เปิด tab ใหม่ไป /cashier)

### 6.3 หน้า Cash Boxes (admin)
- เพิ่ม column "ผู้ใช้ปัจจุบัน" + "เปิดกะเมื่อ"
- เพิ่ม `location`, `displayOrder` ใน edit form

### 6.4 หน้า Cash Sessions (history)
- เพิ่ม filter ตาม CashBox (counter)
- เพิ่ม badge "ส่งกะมาจาก {previous user}" ถ้า `handoverFromId` มี
- คงรายการเดิมทุกอย่าง

---

## 7. Tasks Breakdown

### Phase 1 — Schema + service (foundation, 1 dev-day)
- **C1** Schema diff + migration script (additive, backfill, constrain)
- **C2** `cashSession.service` refactor + ownership helpers + `handoverSession`
- **C3** Service test: open conflict, handover, payment auto-resolve, ownership

### Phase 2 — APIs (0.5 dev-day)
- **C4** `POST /api/cash-sessions` strict
- **C5** `POST /api/cash-sessions/[id]/handover` ใหม่
- **C6** `GET /api/cash-boxes/available` ใหม่
- **C7** Refactor `POST /api/payments` — server-resolve session
- **C8** Fix bug `GET /api/cash-sessions/[id]` (name → id)
- **C9** Refactor `/api/checkin` + `/api/checkout` — drop cashSessionId

### Phase 3 — UI (1.5 dev-day)
- **C10** หน้า `/cashier` ใหม่ — Counter picker + open shift modal
- **C11** Active-shift dashboard (KPI + transaction list)
- **C12** Handover dialog (close+open atomic)
- **C13** Close shift dialog (เน้น over/short ก่อน confirm)
- **C14** DetailPanel check-in: ลบ session dropdown, เพิ่ม warning banner
- **C15** Cash boxes admin: เพิ่ม current-user column + location/order

### Phase 4 — Migration + verification (0.5 dev-day)
- **C16** Backfill script + dry-run + production migration
- **C17** End-to-end manual test:
  1. เปิดกะที่เคาน์เตอร์ 1 → check-in รับเงินสด → เห็นเงินใน /cashier
  2. คนที่ 2 พยายามเปิดเคาน์เตอร์ 1 → ถูก block
  3. คนที่ 2 เปิดเคาน์เตอร์ 2 → check-in อีกห้อง → เงินไหลแยกถูก
  4. ส่งกะ → ผู้ใช้ใหม่เห็น opening balance ตรง
  5. ปิดกะ → over/short post ถูก ledger account
  6. รายงาน Cash by Counter → ตัวเลขตรงกับลิ้นชัก

**รวม: ~3.5 dev-days**

---

## 8. Edge Cases / Decisions

| # | สถานการณ์ | การตัดสินใจ |
|---|---|---|
| E1 | Cashier ลืมปิดกะข้ามวัน | Cron 23:59 แจ้งเตือน + แสดงป้ายแดง "กะค้างจาก {date}" — ไม่ auto-close (อาจมีเงินค้างนับ) |
| E2 | เคาน์เตอร์เดียว 2 คนช่วยกัน (ตรวจคู่) | ห้าม — กฎ 1:1; ถ้าจำเป็น ใช้ handover ชั่วคราว |
| E3 | Power outage ระหว่างเปิดกะ | session คาอยู่ DB; login ใหม่ดึงต่อได้; ถ้าเครื่องคนละเครื่อง → ใช้ "ส่งกะให้ตัวเอง" |
| E4 | Manager บังคับปิดกะของ staff | API admin-only `POST /cash-sessions/[id]/force-close` (ออกบันทึก ActivityLog) |
| E5 | Payment เก่า (ก่อน migration) ไม่มี cashBoxId | Backfill จาก session.cashBoxId; ถ้า session ไม่มีด้วย → `LEGACY-COUNTER-1` |
| E6 | Refund หลังปิดกะ | Refund ต้องอ้าง original payment.cashBoxId; ถ้ากะปิดแล้ว → post เป็น "out-of-session refund" + แจ้ง manager |
| E7 | ออนไลน์ payment (PromptPay) ไม่ต้องผูก counter | `cashBoxId=null` คงเดิม — invariant คุมเฉพาะ cash |
| E8 | คนเดียวเปิดได้กี่กะ | กฎเข้ม: 1 — partial unique index บังคับ |
| E9 | Counter inactive (ปิดถาวร) | `isActive=false` → ไม่ขึ้นใน available list, แต่กะที่ยังเปิดอยู่ปิดได้ปกติ |
| E10 | Booking deposit รับล่วงหน้าก่อนเปิดกะ | ใช้ "Pending payment" (status=DRAFT) ไม่ผูก session; ตอนเปิดกะค่อย commit |

---

## 9. Out of Scope (ทำใน Sprint ต่อไป)

- **Multi-currency drawer** — รองรับ USD/EUR (Sprint 5+)
- **Counter-level commission/tip** — ผูกพนักงานกับ tip pool (Sprint 6)
- **Drawer denomination tracking** (กี่ใบ 1000/500/100) — ตอนนี้แค่ total
- **Tablet POS mode** — touch-first UI (Sprint 5)
- **Auto-print Z report on close** — ต้องคุยกับ printer service team

---

## 10. ความเสี่ยง / สิ่งที่ต้องตัดสินใจก่อนเริ่ม

> 🟠 **คำถาม 1:** จำนวน counter ที่จะมีในระบบจริง (1 / 2 / 3+)? มีผลกับ UI grid layout
>
> 🟠 **คำถาม 2:** ตอนปิดกะ → ระบบควร auto-print receipt summary หรือแค่แสดงบนจอ?
>
> 🟠 **คำถาม 3:** Hand-over ต้องใส่รหัสผู้รับช่วง (extra password) หรือใช้แค่ session login เดิมพอ?
>
> 🟠 **คำถาม 4:** หน้า `/cashier` เดิม (ที่ Sprint 1 ทำไว้) — เก็บ component ไหนได้บ้าง vs รื้อทั้งหมด?
>
> 🟠 **คำถาม 5:** ทำพร้อมกัน Sprint 3B Phase II (contract bills) หรือไม่? (ถ้าทำพร้อม — checkout flow ต้อง coordinate)

---

## 11. Handoff Summary

หลังจบ Sprint 4:
- ✅ Counter-bound shifts (1 user × 1 counter, enforced at DB level)
- ✅ Server-resolved cash session — UI ไม่ต้องส่ง `cashSessionId`
- ✅ Hand-over flow ระหว่างกะ
- ✅ Check-in/check-out ไม่ต้องเลือก session — ราบลื่น
- ✅ Reporting "เงินที่ counter X" query ตรง
- ✅ ข้อมูลเก่าทั้งหมด migrate ไปอยู่ `LEGACY-COUNTER-1` ได้สะอาด

**ไฟล์ deliverable คาด ~15 ไฟล์ใหม่/แก้:**
- `prisma/schema.prisma` + 1 migration
- 2 services modified (cashSession, payment)
- 1 service new (handover helper)
- 6 API routes (3 ใหม่, 3 modified)
- 5 UI files (cashier home, dashboard, handover, close, check-in panel)
- 1 backfill script

---

**END OF PLAN — รอรีวิวก่อนเริ่ม Phase 1**
