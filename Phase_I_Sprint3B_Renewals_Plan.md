# ⚠️ SUPERSEDED — see Phase_I_Sprint3B_Contracts_Renewals_Plan.md

**This v1 plan has been superseded** by [Phase_I_Sprint3B_Contracts_Renewals_Plan.md](Phase_I_Sprint3B_Contracts_Renewals_Plan.md) (v2.0), which adds the Contract module (required legal foundation for monthly bookings), Deposit/lock-in policy, and adjusts the Renewal engine to consume contract data. Do NOT implement from this document.

---

# Sprint 3B — Monthly Renewal Invoice Builder (v1 — archived)

**Version:** 1.0
**Owner:** Handoff document for implementation agent team
**Tech stack:** Next.js App Router, TypeScript, Prisma, PostgreSQL
**Pre-req:** `folio.service.ts`, `invoice-number.service.ts`, `UtilityReading`, `Product`, HotelSettings VAT/service — all already in place.

---

## 1. Goal

Make it **fast and safe** for a front-desk operator to generate the next monthly invoice for a long-stay guest — including room rent, utilities (water + electricity read from meters), and any recurring or ad-hoc extras (laundry, parking, minibar, pet fee, service charges from products catalog).

No more:
- Forgetting to bill a month
- Typing the same fixed addon every month
- Billing before the meter was read
- Double-billing the same period

---

## 2. Real-world scenarios the UI must handle

### Scenario A — "Typical" monthly renewal
Long-stay guest คุณสมชาย ห้อง 305, rate 15,000/เดือน, เข้าพัก 1 มี.ค.
- 1 เม.ย. เวลา 09:00 พนักงาน record meter reading ของห้อง 305 สำหรับเดือน 2026-03
- 1 เม.ย. เวลา 10:00 พนักงานเปิดหน้าต่อสัญญา → เห็นห้อง 305 ครบกำหนด
- คลิก "ออกรอบใหม่" → wizard แสดงค่าห้อง 15,000 + ค่าน้ำ/ไฟที่อ่านได้ + ให้เพิ่มอื่นๆ → submit → Invoice ออก

### Scenario B — ยังไม่ได้จดมิเตอร์
พนักงานเปิด wizard แต่ยังไม่ได้จดเลข → แสดง warning "ยังไม่มีค่า utility เดือน 2026-03" + ให้ตัวเลือก:
1. ไปจดก่อน (link → `/utilities`)
2. ข้ามค่าน้ำ/ไฟ (ออกบิลเฉพาะค่าห้อง + extras แล้วออกบิล utility แยกทีหลัง)

### Scenario C — Addon ประจำ
ห้อง 402 ตกลงจอดรถ 500/เดือน ทุกเดือน → Wizard ควรจำ addon ที่เคยออกในบิลครั้งก่อนและเสนอให้ตั้งต้น (แต่เปิด/ปิดได้)

### Scenario D — ค่าปรับ / ลดให้
- ค้างจ่ายเดือนก่อน → บวก `PENALTY` 500
- ขาดไฟ 2 วัน → ลด `DISCOUNT` 300
- Wizard มีปุ่ม "เพิ่มค่าปรับ/ส่วนลด" แยกออกจาก addon ปกติ

### Scenario E — Bulk ออกหลายห้องทีเดียว
สิ้นเดือน admin ต้องออก 10 ห้อง — ใช้ checkbox + "ออกใบที่เลือก" → ระบบออกทีละใบใน transaction แยก (ไม่ lock ทั้งหมดพร้อมกัน), แสดง progress และสรุป success/fail/skipped.

### Scenario F — Idempotency (ออกซ้ำ)
พนักงานกด submit 2 ครั้ง หรือ cron รันซ้ำ → ระบบต้องไม่ออก 2 ใบสำหรับ period เดียวกัน → 409 "มีใบสำหรับรอบ 2026-04-01 ถึง 2026-04-30 อยู่แล้ว (INV-MN-2026-0042)"

### Scenario G — กลางเดือน checkout
ลูกค้าแจ้งย้ายออก 15 เม.ย. — ไม่ใช่ renewal ปกติ → ออก Invoice แบบ prorated. **ตัด scope นี้ออก** (ใช้ checkout flow เดิม). Wizard จะ exclude bookings ที่มี `checkOut < nextPeriodEnd`.

### Scenario H — Guest ไม่ได้อยู่จริง (หาย/ไม่ขอต่อ)
พนักงานรู้ล่วงหน้าว่าลูกค้าจะไม่ต่อ → กด "ไม่ต่อ" ปุ่มบน row → mark booking ว่า `scheduledCheckOut` ถึง nextPeriodStart-1 วัน → หายไปจาก renewal list.

---

## 3. Domain model

### Existing (do not change)

```
Booking (bookingType in ['monthly_short', 'monthly_long'])
  ├─ status: 'checked_in'
  ├─ rate (per month, stored as per-night × 30 or on booking.monthlyRate — confirm)
  └─ Invoices []   -- last one's billingPeriodEnd defines next period

UtilityReading (roomId + month 'YYYY-MM' unique)
  ├─ prevWater / currWater / waterRate
  └─ prevElectric / currElectric / electricRate

FolioLineItem (chargeType enum)
  └─ ROOM | UTILITY_WATER | UTILITY_ELECTRIC | EXTRA_SERVICE | PENALTY | DISCOUNT | …

Product (catalog of named addons)
  └─ code, name, price, taxType, category
```

### New concept: **Renewal Preview** (stateless, computed in-memory)

```ts
interface RenewalPreview {
  bookingId: string;
  bookingNumber: string;
  guestName: string;
  roomNumber: string;
  roomId: string;

  // period
  lastInvoiceId:   string | null;
  lastPeriodEnd:   Date | null;
  nextPeriodStart: Date;        // = lastPeriodEnd + 1 day (or checkIn if no prior invoice)
  nextPeriodEnd:   Date;        // = nextPeriodStart + monthLength - 1
  dueDate:         Date;        // default = nextPeriodStart + hotelSettings.monthlyDueDays
  daysUntilDue:    number;      // negative = overdue

  // suggested lines (preview only — user edits before submit)
  suggestedLines: RenewalLine[];

  warnings: Warning[];
}

interface RenewalLine {
  source:      'room' | 'utility_water' | 'utility_electric' | 'recurring_addon' | 'manual';
  chargeType:  FolioChargeType;
  description: string;
  quantity:    number;
  unitPrice:   number;
  amount:      number;           // quantity × unitPrice
  taxType:     TaxType;
  productId?:  string | null;
  referenceType?: string | null; // e.g. 'UtilityReading'
  referenceId?:   string | null; // e.g. utilityReading.id
  editable:    boolean;          // room line is editable false by default
  required:    boolean;          // meter lines are flagged required = true if present
}

interface Warning {
  severity: 'info' | 'warning' | 'error';
  code: 'UTILITY_MISSING' | 'DUPLICATE_PERIOD' | 'BOOKING_ENDING' | 'RATE_CHANGED';
  message: string;
  blocksSubmit: boolean;
}
```

### Persisted state (new columns / no new tables)

No schema change strictly required for MVP. However, for **Scenario C (remember recurring addons)** we need to distinguish per-period one-off charges from recurring ones. Two options:

**Option 1 (recommended — simpler):** on Invoice creation, read the previous invoice's `InvoiceItem` rows where `chargeType='EXTRA_SERVICE'` and propose them as checked-by-default in the wizard. User un-checks what they don't want. No new column needed.

**Option 2 (future-proof):** add `FolioLineItem.recurring: Boolean @default(false)`. Only "recurring=true" lines auto-propose next cycle. Defer to Phase J.

**Use Option 1 for Sprint 3B.**

---

## 4. Period calculation rules

Precedence (first match wins):

1. **Has prior invoice with `billingPeriodEnd`:**
   - `nextPeriodStart = billingPeriodEnd + 1 day`
2. **No prior invoice:**
   - `nextPeriodStart = booking.checkIn` (truncated to date)
3. **`nextPeriodEnd` default:** `nextPeriodStart + 1 month - 1 day` (calendar month: if start=1 Apr, end=30 Apr; if start=5 Apr, end=4 May).
   - Expose as editable date field with default — user can shorten (prorate ออกกลางเดือน) but must be ≥ start + 7 days to block accidental 0-day periods.
4. **`dueDate` default:** `nextPeriodStart + HotelSettings.invoiceDueDays` (fallback 0 = same as periodStart).
5. **Utility month:** `YYYY-MM` = format of `lastPeriodEnd` (ค่าน้ำไฟคือของเดือนที่ผ่านมา). If `lastPeriodEnd` is null → skip utilities.

---

## 5. UI design

### 5.1 RenewalTab (landing table)

Route: `/billing-cycle` → existing tab bar has "ต่อสัญญา" — activate tab.

```
[ 📅 วันที่อ้างอิง: 2026-04-22 ▼ ]  [ ช่วงที่ครบกำหนด: +7 วัน ▼ ]  [ 🔄 รีเฟรช ]

KPI Cards (4):
┌─────────────────┬──────────────────┬──────────────────┬──────────────────┐
│ ห้องรอออกรอบ   │ ห้องที่เกินกำหนด │ ออกไปแล้วเดือนนี้│ ยอดรวมที่จะเก็บ │
│      8          │       2   🔴    │      12          │   ฿285,450.00   │
└─────────────────┴──────────────────┴──────────────────┴──────────────────┘

GoogleSheetTable<RenewalPreview>:
┌──┬────────┬──────────┬─────────┬───────────┬───────────────┬──────────────┬──────┬─────────┐
│☐ │ ห้อง   │ ลูกค้า   │ บิลล่าสุด│ รอบถัดไป  │ ค่าห้อง        │ Utility พร้อม │สถานะ│ Actions │
├──┼────────┼──────────┼─────────┼───────────┼───────────────┼──────────────┼──────┼─────────┤
│☐ │  305   │ สมชาย    │31 มี.ค. │1 เม.ย.-30 │ ฿15,000       │ ✅ มีอ่าน    │ 🔴 เกิน│[ออกรอบ]│
│  │        │          │         │ เม.ย.     │               │ 520 น้ำ/ไฟ   │ 5 วัน│[ดูใบ]   │
│  │        │          │         │           │               │              │      │[ไม่ต่อ] │
├──┼────────┼──────────┼─────────┼───────────┼───────────────┼──────────────┼──────┼─────────┤
│☐ │  402   │ สมหญิง   │ 4 เม.ย. │5 เม.ย.-4  │ ฿12,000       │ ⚠️ ยังไม่อ่าน│ 🟡 2 │[ออกรอบ]│
│  │        │          │         │ พ.ค.      │               │              │ วัน  │[อ่านมิเตอร์]│
├──┼────────┼──────────┼─────────┼───────────┼───────────────┼──────────────┼──────┼─────────┤
│☐ │  501   │ จอห์น    │ —       │1 เม.ย.-30 │ ฿18,000       │ ✅ มีอ่าน    │ 🟢    │[ออกรอบ]│
│  │        │ (ใหม่)    │         │ เม.ย.     │               │              │     │         │
└──┴────────┴──────────┴─────────┴───────────┴───────────────┴──────────────┴──────┴─────────┘

[☐ เลือกทั้งหมด]  [ออกใบที่เลือก (3)]  [export CSV]
```

Filter/sort via per-column GoogleSheetTable dropdown (per CLAUDE.md §5 rule).

Status badges (derive client-side):
- 🔴 `daysUntilDue < 0` → "เกิน X วัน" (red)
- 🟡 `daysUntilDue ≤ 3` → "X วัน" (amber)
- 🟢 `daysUntilDue > 3` → "พร้อม" (green)

### 5.2 Single-room renewal wizard (4 steps)

**Step 1 — Period & basics**

```
🏠 ห้อง 305  ·  คุณสมชาย  ·  booking MB-2026-0007

ระยะเวลาบิลรอบใหม่
  วันเริ่ม:  [ 2026-04-01 ]  (auto: ต่อจากบิลล่าสุด)
  วันสิ้นสุด: [ 2026-04-30 ]  (auto: 30 วัน — แก้ได้ถ้าต้องการสั้นลง)
  ครบกำหนดชำระ: [ 2026-04-05 ] (auto: เริ่ม + 5 วัน จาก HotelSettings)

ค่าห้อง (ดึงจาก booking.rate):
  ฿15,000.00  [ แก้ไข ] 
  ⓘ ถ้าเปลี่ยนราคา ระบบจะบันทึก RateAudit

[ยกเลิก]              [ถัดไป →]
```

**Step 2 — Utility (ค่าน้ำ + ค่าไฟ)**

```
Utility ของเดือน 2026-03 (เดือนที่ผ่านมา)

✅ Water meter reading สำหรับ ห้อง 305, เดือน 2026-03
   เลขก่อนหน้า: 1,234  →  ปัจจุบัน: 1,254   (ใช้ 20 หน่วย)
   เรต: ฿18/หน่วย   ×   รวม: ฿360.00         [ แก้ไข ]

✅ Electric meter reading
   เลขก่อนหน้า: 5,678  →  ปัจจุบัน: 5,790   (ใช้ 112 หน่วย)
   เรต: ฿8/หน่วย   ×   รวม: ฿896.00           [ แก้ไข ]

[← ย้อนกลับ]                            [ถัดไป →]

-- ถ้ายังไม่อ่านมิเตอร์ --
⚠️ ยังไม่มีอ่านมิเตอร์เดือน 2026-03
   [ไปจดตอนนี้ →]  หรือ  [☐ ข้ามค่า utility รอบนี้]
                         (แนะนำให้ข้ามแล้วออกบิล utility แยกภายหลัง)
```

**Step 3 — Addons / Extras**

```
รายการเสริม

Recurring (จากเดือนก่อน):
  ☑ จอดรถ            ฿500.00    [แก้ไข] [ลบ]
  ☐ ค่าซักผ้า        ฿1,200.00  (บิลก่อนเคยมี — ใส่อีกไหม?)

เพิ่มรายการ:
  [ + จาก Product Catalog ]   ← dropdown ค้นหาจาก Product
  [ + รายการอื่น ]             ← free-text + amount + taxType
  [ + ค่าปรับ (Penalty) ]      ← chargeType=PENALTY
  [ + ส่วนลด (Discount) ]     ← chargeType=DISCOUNT, amount ติดลบ

  ☑ ค่าอินเทอร์เน็ตพิเศษ     ฿500.00      [แก้ไข] [ลบ]
  ☑ ค่าปรับจ่ายล่าช้าเดือน มี.ค.  ฿300.00  [แก้ไข] [ลบ]

[← ย้อนกลับ]                            [ถัดไป →]
```

**Step 4 — Summary & Submit**

```
📋 สรุปบิลรอบใหม่

ห้อง 305 · คุณสมชาย
รอบ: 1 เม.ย. 2026 — 30 เม.ย. 2026 (30 วัน)
ครบกำหนด: 5 เม.ย. 2026

รายการ                                    จำนวน     เรต        รวม
─────────────────────────────────────────────────────────────────────
ค่าห้องรายเดือน                              1         15,000     15,000.00
ค่าน้ำ (1,234→1,254, 20 หน่วย @ 18)          20         18         360.00
ค่าไฟ (5,678→5,790, 112 หน่วย @ 8)         112          8         896.00
ค่าจอดรถ                                      1         500         500.00
ค่าอินเทอร์เน็ตพิเศษ                         1         500         500.00
ค่าปรับจ่ายล่าช้า มี.ค.                      1         300         300.00
─────────────────────────────────────────────────────────────────────
ยอดก่อน VAT                                                     17,556.00
VAT 7% (excluded)                                                1,228.92
Service charge 10%                                               1,878.69
─────────────────────────────────────────────────────────────────────
ยอดสุทธิ                                                       ฿20,663.61

หมายเหตุ: [                                                  ] (optional)

[← ย้อนกลับ]    [ยกเลิก]    [✅ ออกใบแจ้งหนี้ (INV-MN-...)]
```

### 5.3 Bulk renewal dialog

```
ออกใบแจ้งหนี้หลายห้อง

3 ห้องที่เลือก:
  • 305  สมชาย    ฿20,663.61
  • 402  สมหญิง   (⚠ ยังไม่อ่านมิเตอร์ — จะข้าม utility)
  • 501  จอห์น    ฿22,518.00

ตั้งค่าร่วม:
  วันที่ออกบิล:    [ 2026-04-22 ]
  วันครบกำหนด:   [ +5 วันจาก periodStart ]  (แต่ละห้องคำนวณต่างกัน)

☐ ถ้าห้องใดไม่มี utility ให้:
  ○ ข้ามห้องนั้น (ไม่ออก)
  ● ออกบิลโดยไม่มี utility (default)

[ยกเลิก]                          [ออกใบทั้งหมด (3)]

-- ขณะทำงาน --
ออกใบแจ้งหนี้...
  ✅ 305 สำเร็จ — INV-MN-2026-0042
  ✅ 402 สำเร็จ — INV-MN-2026-0043
  ❌ 501 ล้มเหลว — "rate ถูกเปลี่ยน โปรดตรวจสอบ"
สรุป: สำเร็จ 2 / ล้มเหลว 1
```

---

## 6. Backend architecture

### 6.1 New service: `src/services/renewal.service.ts`

```ts
import type { Prisma, PrismaClient } from '@prisma/client';
import { addCharge, createInvoiceFromFolio } from './folio.service';
import { getHotelSettings } from './hotelSettings.service';

type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// ── Query ──────────────────────────────────────────────────────────────────

export interface ListRenewalsInput {
  asOf: Date;
  windowDays?: number;          // default 7
  bookingIds?: string[];        // optional narrow to specific bookings
}

export async function listDueRenewals(
  tx: TxClient,
  input: ListRenewalsInput,
): Promise<RenewalPreview[]>;

export async function getRenewalPreview(
  tx: TxClient,
  bookingId: string,
  opts?: { asOf?: Date; periodEnd?: Date },
): Promise<RenewalPreview>;

// ── Mutation ───────────────────────────────────────────────────────────────

export interface GenerateRenewalInput {
  bookingId: string;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  lines: SubmittedLine[];       // the edited version of suggested
  notes?: string;
  createdBy: string;
  /** Idempotency: caller passes same key on retry → returns existing invoice */
  idempotencyKey?: string;
}

export interface SubmittedLine {
  chargeType: FolioChargeType;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxType: TaxType;
  productId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
}

export class RenewalError extends Error {
  constructor(public code: RenewalErrorCode, msg: string) { super(msg); }
}
type RenewalErrorCode =
  | 'DUPLICATE_PERIOD'
  | 'NOT_MONTHLY'
  | 'NOT_CHECKED_IN'
  | 'PERIOD_TOO_SHORT'
  | 'BOOKING_ENDING'
  | 'INVALID_LINES';

export async function generateRenewalInvoice(
  tx: TxClient,
  input: GenerateRenewalInput,
): Promise<{ invoiceId: string; invoiceNumber: string; grandTotal: number; skipped: boolean }>;
```

**Implementation notes:**

- `listDueRenewals` — one query:
  ```ts
  booking.findMany({
    where: {
      bookingType: { in: ['monthly_short', 'monthly_long'] },
      status: 'checked_in',
      checkOut: { gte: input.asOf },  // not leaving before asOf
    },
    select: {
      id: true, bookingNumber: true,
      checkIn: true, checkOut: true,
      monthlyRate: true, rate: true,
      guest: { select: { firstName: true, lastName: true } },
      room:  { select: { id: true, number: true } },
      invoices: {
        where: { invoiceType: 'MN', status: { notIn: ['voided'] } },
        orderBy: { billingPeriodEnd: 'desc' },
        select: { id: true, billingPeriodStart: true, billingPeriodEnd: true },
        take: 1,
      },
    },
  })
  ```
  Then for each row → call `getRenewalPreview` (reuse) to compute lines + warnings. Parallel `Promise.all`.

- `getRenewalPreview` — build the `suggestedLines` array:
  1. ROOM line: `rate, quantity=1, taxType from hotelSettings.roomTaxType`
  2. Utility lines: `SELECT * FROM utility_readings WHERE roomId=X AND month=prevMonthYYYYMM`. If found → add UTILITY_WATER + UTILITY_ELECTRIC lines with meter detail in description. If not found → append warning `UTILITY_MISSING` (non-blocking).
  3. Recurring addons: load previous invoice's InvoiceItems where `chargeType='EXTRA_SERVICE'` and propose checked by default.
  4. No penalty/discount proposed — user adds manually.

- `generateRenewalInvoice`:
  1. Load booking, validate `bookingType in monthly_*` and `status='checked_in'`.
  2. Check `period_too_short` (≥ 7 days).
  3. **Idempotency:** before insert, query
     ```ts
     invoice.findFirst({
       where: {
         bookingId, invoiceType: 'MN',
         billingPeriodStart: input.periodStart,
         billingPeriodEnd:   input.periodEnd,
         status: { notIn: ['voided'] },
       },
     })
     ```
     → if exists, throw `DUPLICATE_PERIOD` with existing `invoiceNumber` in message.
  4. Get or create folio (reuse `getFolioByBookingId` / `createFolio`).
  5. For each `line`, call `addCharge`.
  6. Collect the newly created `lineItemId`s.
  7. Call `createInvoiceFromFolio` with `invoiceType='MN'`, `lineItemIds=newIds`, `billingPeriodStart/End`, `dueDate`. This returns `{ invoiceId, invoiceNumber, grandTotal }`.
  8. Return.

- All steps above must run inside the **caller's** `$transaction` — do NOT open a nested transaction. The route handler wraps.

### 6.2 API routes

| Route | Method | Purpose | Auth |
|---|---|---|---|
| `/api/billing-cycle/renewals` | GET | List due bookings | session |
| `/api/billing-cycle/renewals/preview` | POST | Recompute preview after period edit | session |
| `/api/billing-cycle/renewals` | POST | Generate one invoice | session |
| `/api/billing-cycle/renewals/bulk` | POST | Generate many (sequential `$transaction` per booking) | session |

#### GET /api/billing-cycle/renewals
Query:
- `asOf=YYYY-MM-DD` (default today)
- `windowDays=7` (default; filter: `daysUntilDue <= windowDays` — include overdue)
- `includeFuture=true|false`

Response: `RenewalPreview[]`

#### POST /api/billing-cycle/renewals/preview
Body:
```ts
z.object({
  bookingId: z.string().min(1),
  periodStart: z.string(),    // ISO date
  periodEnd:   z.string(),
  asOf:        z.string().optional(),
})
```
Returns: `RenewalPreview` (re-computed utility based on `periodEnd`'s previous month; `suggestedLines` refreshed).

#### POST /api/billing-cycle/renewals
Body:
```ts
z.object({
  bookingId: z.string().min(1),
  periodStart: z.string(),
  periodEnd:   z.string(),
  dueDate:     z.string(),
  notes:       z.string().max(1000).optional(),
  lines: z.array(z.object({
    chargeType: z.enum(['ROOM','UTILITY_WATER','UTILITY_ELECTRIC','EXTRA_SERVICE','PENALTY','DISCOUNT','ADJUSTMENT','OTHER']),
    description: z.string().min(1).max(500),
    quantity: z.number().positive(),
    unitPrice: z.number(),  // can be negative for DISCOUNT
    amount: z.number(),
    taxType: z.enum(['included','excluded','no_tax']),
    productId: z.string().nullable().optional(),
    referenceType: z.string().nullable().optional(),
    referenceId:   z.string().nullable().optional(),
  })).min(1),
  idempotencyKey: z.string().optional(),
})
```
Response: `{ ok: true, invoiceId, invoiceNumber, grandTotal, skipped: false }` or 409 `{ error, code: 'DUPLICATE_PERIOD', existingInvoiceNumber }`.

Wrap the service call in `prisma.$transaction(async tx => …)`.

#### POST /api/billing-cycle/renewals/bulk
Body:
```ts
z.object({
  items: z.array(<same as single without bookingId>).extend({
    bookingId: z.string().min(1),
  }).min(1).max(20),
  onUtilityMissing: z.enum(['skip_booking', 'skip_utility']).default('skip_utility'),
})
```
Response:
```ts
{
  results: Array<{
    bookingId: string;
    status: 'success' | 'skipped' | 'failed';
    invoiceId?: string;
    invoiceNumber?: string;
    grandTotal?: number;
    error?: string;
    errorCode?: RenewalErrorCode;
  }>
}
```
**Important:** each item gets its **own** `$transaction`. One failure does NOT rollback others. Sequential loop, not Promise.all (avoid lock storm + easier error surfacing).

### 6.3 Optional cron endpoint (document only, don't schedule)

`POST /api/cron/billing-cycle` — runs `listDueRenewals({ asOf: today, windowDays: 0 })` then auto-generates with default lines (room + utility only, no addons). Guard with `CRON_SECRET` header like HK cron. Mark in JSDoc "Not wired — manual trigger only for now".

---

## 7. Files to create / modify

### New files
```
pms-next/src/services/renewal.service.ts                          [NEW ~350 lines]
pms-next/src/app/api/billing-cycle/renewals/route.ts              [NEW  ~120]
pms-next/src/app/api/billing-cycle/renewals/preview/route.ts      [NEW   ~60]
pms-next/src/app/api/billing-cycle/renewals/bulk/route.ts         [NEW  ~130]
pms-next/src/app/api/cron/billing-cycle/route.ts                  [NEW   ~90]

pms-next/src/app/(dashboard)/billing-cycle/components/RenewalTab.tsx            [NEW ~350]
pms-next/src/app/(dashboard)/billing-cycle/components/RenewalWizardDialog.tsx   [NEW ~500]
pms-next/src/app/(dashboard)/billing-cycle/components/BulkRenewalDialog.tsx     [NEW ~220]
pms-next/src/app/(dashboard)/billing-cycle/components/LineEditor.tsx            [NEW ~180]  (reusable per-line row editor)
```

### Modified files
```
pms-next/src/app/(dashboard)/billing-cycle/page.tsx      +~30 lines (wire RenewalTab into existing tab bar)
```

### Tests (recommended, not blocking)
```
pms-next/__tests__/renewal.service.test.ts    -- period calc, utility assembly, idempotency
```

---

## 8. Task breakdown for implementation agents

**Suggested order — one agent runs sequentially. Each task is independently testable.**

### T1 — Service layer (no UI yet)
- Create `renewal.service.ts` with the 3 exported functions.
- Focus on `getRenewalPreview` first (pure computation, easy to unit test).
- Include `RenewalError` class with typed codes.
- **Acceptance:** a test booking with an existing invoice + utility reading returns a preview with 3 suggested lines (room + water + electric) and zero warnings. Without utility → 1 warning `UTILITY_MISSING`.

### T2 — Single-invoice API + preview API
- `GET /api/billing-cycle/renewals` — list.
- `POST /api/billing-cycle/renewals/preview` — recompute on period edit.
- `POST /api/billing-cycle/renewals` — generate one.
- Use `prisma.$transaction` wrapper. Auth check first line.
- **Acceptance:** curl test generates an Invoice; second call with same period → 409 duplicate.

### T3 — Bulk API
- `POST /api/billing-cycle/renewals/bulk` — sequential loop, per-item transaction.
- **Acceptance:** send 3 items where item 2 has invalid period → items 1 & 3 succeed, item 2 returns `status: 'failed'`.

### T4 — RenewalTab UI (table + KPI)
- Fetch from `/api/billing-cycle/renewals`.
- Use GoogleSheetTable per CLAUDE.md §5 (per-column filter/sort, global search, row count).
- KPI cards (4): รอออก, เกิน, ออกแล้วเดือนนี้ (count invoices with invoiceType='MN' and createdAt in current month), ยอดรวมที่จะเก็บ (sum of grandTotal preview).
- Row actions: `[ออกรอบ]` → opens `RenewalWizardDialog`. `[ดูใบล่าสุด]` → opens invoice in new tab. `[อ่านมิเตอร์]` → `/utilities?month=<prevMonth>&roomId=<X>`. `[ไม่ต่อ]` → confirm dialog → PATCH booking to set a `scheduledCheckOut` flag (out of scope for this sprint, show TODO toast instead).
- Checkbox selection + `[ออกใบที่เลือก]` button → opens `BulkRenewalDialog`.
- **Acceptance:** loads without error, displays the test bookings, filters work.

### T5 — RenewalWizardDialog (4-step)
- Follow `multi-step-dialog-wizard` skill: stepper, per-step validation, Back/Next/Cancel.
- Step 1: period editor + room rate override (with warning "จะบันทึก RateAudit").
- Step 2: utility panel. If reading exists → show editable `prevWater/currWater` etc. computed on the fly. If missing → warning panel with "ไปจดมิเตอร์" link + "ข้าม utility" checkbox that removes the 2 utility lines from submission.
- Step 3: addon panel. Use `LineEditor` component per line. Recurring addons pre-checked. Dropdowns: chargeType picker for PENALTY/DISCOUNT; Product catalog search (GET `/api/products`) for EXTRA_SERVICE.
- Step 4: summary (read-only). Show calculated VAT/service if HotelSettings.vatEnabled etc. Submit button.
- On submit: POST `/api/billing-cycle/renewals`. Success → toast + close + parent refresh. 409 DUPLICATE → toast with existing invoice number + offer to open it.
- **Acceptance:** a full flow from tab → wizard → submit creates an Invoice visible in `/finance` invoice list.

### T6 — BulkRenewalDialog
- Takes an array of `RenewalPreview` from parent (already selected).
- Settings panel: common dueDate offset, `onUtilityMissing` radio.
- Submit button disabled until confirm.
- Progress display: stream results row-by-row (just fetch and render array response — no SSE needed).
- **Acceptance:** 3 rooms → POST returns array of 3 → UI shows ✅/❌ per row.

### T7 — Cron endpoint (stub)
- `POST /api/cron/billing-cycle` — parallels the HK cron. Guard with `CRON_SECRET`.
- Default behavior: for each due booking (asOf=today, windowDays=0), generate with `room + utility (if present)` only — NO addons. Skip booking if utility missing AND `onUtilityMissing='skip_booking'` configured in HotelSettings (add a field? or hardcode 'skip_utility'). For MVP: hardcode `skip_utility`.
- Log ActivityLog summary: "Renewal cron — generated 5 / skipped 2 / failed 0".
- **Acceptance:** curl with bearer token generates invoices; without token → 401.

### T8 — Polish & verification
- Run the full manual test checklist (§10).
- Type-check: `npx tsc --noEmit` — zero errors in touched files.
- Load the `/billing-cycle` page in dev server, verify each acceptance criterion.

---

## 9. Edge cases to keep in mind

| Case | Expected behavior |
|---|---|
| Booking has NO prior invoice (first month after check-in) | `nextPeriodStart = booking.checkIn`. Utility month = month of check-in - 1 (likely no reading → warning). Proceed. |
| `checkOut` falls inside `nextPeriodEnd` | warning `BOOKING_ENDING` — user can prorate `nextPeriodEnd` manually. |
| User edits `periodEnd` shorter than 7 days | Wizard step 1 validation error. |
| Utility reading exists but `recorded=false` | Treat as missing. Warning. |
| Rate on booking changed between last invoice and now | warning `RATE_CHANGED` with old vs new — user confirms. |
| Product was deleted/deactivated from catalog | The recurring addon detector must filter by `product.active` and fall back to free-text if productId is gone. |
| HotelSettings.vatEnabled flipped mid-cycle | `createInvoiceFromFolio` already reads settings at invoice-create time. Documented behavior. |
| Two operators open wizard simultaneously | Last-writer wins on UI state. DB idempotency check (DUPLICATE_PERIOD) prevents double invoice. |
| Bulk: item 3 hits period_too_short error | That row fails, remaining N-1 still post. Final summary shows mix. |
| Negative `DISCOUNT` line pushing total below zero | `createInvoiceFromFolio` should reject (check existing behavior — likely already does). If not, wizard blocks at step 4 with toast. |

---

## 10. Manual test checklist (for post-implementation verification)

**Setup:** create 3 monthly bookings:
- A. checked in 2026-03-01, invoiced 2026-03-01→2026-03-31, utility reading for 2026-03 exists.
- B. checked in 2026-03-05, invoiced once, NO utility reading for 2026-03.
- C. checked in 2026-04-15 (brand new, no invoices).

**Tests:**
- [ ] `/billing-cycle` → tab "ต่อสัญญา" lists all 3 with correct period calc.
- [ ] Booking A wizard: step 2 shows meter values, step 4 summary totals correctly, submit → `INV-MN-…` with billingPeriodStart/End set, grand total matches preview.
- [ ] Booking A submit again → 409 DUPLICATE_PERIOD toast.
- [ ] Booking B wizard: step 2 shows UTILITY_MISSING warning; "ข้าม utility" checkbox removes meter lines from summary; submit → invoice has room + addons only.
- [ ] Booking C wizard: period starts at 2026-04-15, no prior invoice; submit → first-ever invoice created.
- [ ] Recurring addon: after Booking A has been invoiced with "จอดรถ 500", next-month preview proposes "จอดรถ 500" pre-checked.
- [ ] Bulk: select A + B + C, bulk dialog → 3 results row-by-row; A & C success, B success (skipped utility) or A & C success, B failed depending on `onUtilityMissing` config.
- [ ] Void an invoice (existing flow) → next preview no longer skips that period (would now allow regeneration).
- [ ] Cron: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" /api/cron/billing-cycle` returns summary.
- [ ] `/finance` shows the new invoices. Payment flow works end-to-end.
- [ ] `npx tsc --noEmit` clean on touched files.

---

## 11. Out of scope (defer to later sprint)

- Partial / mid-month prorated checkout invoicing (use existing checkout flow).
- Email / SMS auto-send on invoice creation.
- PDF generation (existing invoice PDF flow already handles MN type).
- "Renewal reminder" customer-facing notifications.
- Multi-currency.
- Recurring addon management UI (edit list of recurring charges per booking) — Sprint 3B uses "propose from last invoice" pattern.

---

## 12. Handoff tips for the next agent

1. **Read order:** `folio.service.ts` (to understand `addCharge` + `createInvoiceFromFolio` signatures), `invoice-number.service.ts` (for INV-MN prefix), `UtilityReading` schema + `/api/utilities/route.ts` (to copy query pattern).
2. **Reference implementations:**
   - 4-step wizard: `pms-next/src/app/(dashboard)/housekeeping/components/ScheduleDialog.tsx` (from Sprint 2b)
   - Mutation toast pattern: `pms-next/src/app/(dashboard)/housekeeping/components/RequestCleaningDialog.tsx`
   - GoogleSheetTable table + KPI: `pms-next/src/app/(dashboard)/sales/page.tsx`
3. **Don't forget:**
   - `fmtDate`, `fmtDateTime`, `fmtBaht` from `@/lib/date-format` — no `th-TH` locale.
   - CSS vars for surface/text/border — no hex.
   - Zod at every API boundary.
   - `prisma.$transaction` around every mutation.
   - Auth check is the first line of every route.
4. **Do NOT** run `npx prisma generate` or `migrate` — this sprint needs no schema change. If you feel you need one, stop and ask.
5. **Dev server:** user starts it — the agent does not.

---

**End of plan. Total estimated effort: 1.5–2 days for one full-stack agent.**
