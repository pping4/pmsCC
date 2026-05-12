# City Ledger / Accounts Receivable — Implementation Plan (FINAL)

> วิเคราะห์โดย Claude Opus | April 2026
> อ้างอิง: แผนเก่า (PMS_SYSTEM_DOCUMENTATION.md §17), แผนใหม่ (PMS_cityLedger.txt), Codebase ปัจจุบัน

---

## ส่วนที่ 1: วิเคราะห์เปรียบเทียบ — แผนเก่า vs แผนใหม่

### 1.1 สรุปแผนเก่า (§17 ใน DOCUMENTATION.md)

เป็น **outline สั้น** ระบุเฉพาะชื่อ 4 models + 4 integration points:

- `CityLedgerAccount` (creditLimit, creditTermsDays)
- `CityLedgerTransaction` (running ledger)
- `CityLedgerPayment` (รับชำระรายบริษัท)
- `CityLedgerAllocation` (M2M: payment ↔ invoice)
- Integration: Invoice FK, Booking FK, LedgerAccount enum + `AR_CORPORATE`, Checkout bypass

**จุดแข็ง:** กระชับ เข้าใจง่าย
**จุดอ่อน:** ไม่มี field-level detail, ไม่มี service logic, ไม่มี UI spec, ไม่มี implementation order

### 1.2 สรุปแผนใหม่ (PMS_cityLedger.txt)

แผนละเอียด 4 Phases พร้อม Prisma schema, service functions, API routes, UI specs:

**จุดแข็ง (เหนือกว่าแผนเก่า):**

| หัวข้อ | แผนใหม่ดีกว่า | รายละเอียด |
|--------|---------------|------------|
| Schema Detail | ✅ | มี field ทุกตัว, @map, @db.Decimal, @@index, @@map ครบ |
| Optimistic Concurrency | ✅ | ใส่ `version Int @default(1)` ใน Account + Transaction — ป้องกัน race condition |
| Running Balance | ✅ | `runningBalance` cached ใน Transaction — ลด query load |
| Unallocated Amount | ✅ | `unallocatedAmount` ใน Payment — รองรับเงินจ่ายเกิน/มัดจำล่วงหน้า |
| CL Status on Invoice | ✅ | เพิ่ม `cityLedgerStatus` (pending/sent/settled/disputed) |
| SecurityDeposit FK | ✅ | เชื่อม SecurityDeposit กับ CL Account — มัดจำองค์กร |
| Service Functions | ✅ | ระบุ function signatures: checkCreditLimit, postInvoiceToCityLedger, receiveCityLedgerPayment, generateMonthlyStatement |
| Ledger Entries | ✅ | 3 patterns: CL Charge, CL Payment Received, CL Bad Debt |
| API Design | ✅ | 5 endpoints พร้อม HTTP methods |
| UI Spec | ✅ | KPI Cards, Data Table, 4-Tab Detail, UI เดิมที่ต้องแก้ |
| Implementation Order | ✅ | 8 steps เรียงลำดับ Backend → Frontend → QA |
| P2025 Warning | ✅ | เตือนทีม Dev เรื่อง Optimistic Concurrency exception |

**จุดอ่อน / ส่วนที่ขาด:**

| หัวข้อ | สิ่งที่ขาด | ความสำคัญ |
|--------|-----------|----------|
| Aging Report Logic | ไม่มีสูตร aging bucket (Current / 30 / 60 / 90 / 120+) | สูง |
| Credit Hold Flow | ไม่มี logic เมื่อ balance > creditLimit → block new booking | สูง |
| Zod Validation Schemas | ไม่ระบุ Zod schema สำหรับแต่ละ API | สูง (ตาม CLAUDE.md) |
| Auto-Number Generation | ไม่ระบุ format CL-XXXX ใช้ service ตัวไหน | กลาง |
| Sidebar Nav | ไม่ระบุตำแหน่ง City Ledger ใน sidebar | กลาง |
| Statement PDF | พูดถึงแต่ไม่มี detail การ generate PDF | กลาง |
| Email Notification | ไม่มี flow แจ้งเตือนบริษัทเมื่อหนี้ครบกำหนด | ต่ำ (phase 2) |
| Discount/Promo on CL | ไม่ระบุว่า corporate rate/discount ทำยังไง | ต่ำ (ใช้ระบบ promo เดิม) |
| Unit Tests | ไม่มีแผน test | กลาง |

### 1.3 สรุปการตัดสิน

> **แผนใหม่ดีกว่าอย่างชัดเจน** — เป็นฐานที่ถูกต้อง ต้องเสริมส่วนที่ขาดเข้าไป

---

## ส่วนที่ 2: สิ่งที่ต้องปรับให้เข้ากับ Codebase จริง

จากการสำรวจ codebase ปัจจุบัน พบว่าแผนใหม่ต้องปรับ:

### 2.1 Schema — ต้องเพิ่มเติม

| สิ่งที่แผนบอก | สิ่งที่ต้องปรับ | เหตุผล |
|--------------|----------------|--------|
| `CityLedgerTransaction.createdBy String` | ใช้ `String` ตรง ✅ | ตรงกับ pattern เดิม (Invoice.createdBy, Payment.createdBy ก็เป็น String ไม่ FK) |
| เพิ่ม `AR_CORPORATE` ใน LedgerAccount | ✅ ถูกแล้ว | enum ปัจจุบันมี AR แต่ไม่มี AR_CORPORATE — ต้องแยกเพื่อ report |
| ActivityLog เพิ่ม `cityLedgerAccountId` | ✅ ถูกแล้ว | Model ปัจจุบันไม่มี field นี้ |
| SecurityDeposit เพิ่ม `cityLedgerAccountId` | ✅ ถูกแล้ว | Model ปัจจุบันไม่มี field นี้ |
| Invoice เพิ่ม `cityLedgerStatus` | ปรับเป็น **enum** แทน String | ตรงกับ pattern ที่ใช้ enum ทั้ง codebase (InvoiceStatus, BookingStatus ฯลฯ) |
| ไม่มี `CityLedgerCreditNote` | **ควรเพิ่ม** | รองรับ partial refund, adjustment, credit memo |

### 2.2 Services — ต้องเสริม

| แผนบอก | สิ่งที่ต้องเพิ่ม |
|--------|-----------------|
| `cityLedger.service.ts` | เพิ่ม `getAgingReport()` — bucket: Current, 1-30, 31-60, 61-90, 90+ |
| `cityLedger.service.ts` | เพิ่ม `checkAndHoldAccount()` — ถ้า balance ≥ creditLimit → status = 'suspended' |
| `cityLedger.service.ts` | เพิ่ม `writeOffBadDebt()` — ใช้ postCityLedgerBadDebt + update invoice.badDebt |
| `invoice-number.service.ts` | เพิ่ม prefix `CL` สำหรับ CityLedgerAccount code, `CL-PAY` สำหรับ CityLedgerPayment |
| `folio.service.ts` | แก้ `createInvoiceFromFolio` → ถ้า booking มี cityLedgerAccountId ให้ set FK + cityLedgerStatus = 'pending' |

### 2.3 API — ต้องเพิ่ม

แผนใหม่มี 5 endpoints + 2 แก้ไข — ถูกแล้ว แต่เพิ่ม:

| Endpoint | วัตถุประสงค์ |
|----------|------------|
| `GET /api/city-ledger/[id]/aging` | Aging report per account |
| `GET /api/city-ledger/[id]/statement` | Statement (running balance) with date range filter |
| `POST /api/city-ledger/[id]/credit-note` | สร้าง credit note / adjustment |
| `GET /api/city-ledger/summary` | Dashboard summary: total AR, overdue, aging overview |

### 2.4 Checkout Flow — ต้องแก้ไข

ไฟล์: `src/app/api/checkout/route.ts` (459 บรรทัด)

**แก้ไขจุดเดียว** ใน checkout flow:

```
เงื่อนไขเดิม:
  booking.status === 'checked_in' → compute balance → collect payment → close folio

เงื่อนไขใหม่ (เพิ่ม):
  IF booking.cityLedgerAccountId IS NOT NULL:
    → checkCreditLimit(tx, accountId, outstanding)
    → createInvoiceFromFolio (type: 'CO', cityLedgerAccountId set)
    → postInvoiceToCityLedger(tx, invoiceId, accountId)
    → SKIP payment collection entirely
    → logActivity(category: 'city_ledger', action: 'CHECKOUT_TO_CL')
    → close folio
  ELSE:
    → (flow เดิมไม่เปลี่ยน)
```

### 2.5 UI — จุดเชื่อมต่อที่ต้องแก้

| ไฟล์ | การแก้ไข |
|------|---------|
| `Sidebar.tsx` | เพิ่ม `{ href: '/city-ledger', label: 'City Ledger', icon: '🏢' }` ก่อน settings |
| `NewBookingDialog.tsx` (45KB) | เพิ่ม optional dropdown "บริษัท/City Ledger" — ใช้ CreatableSelect pattern ที่มีอยู่แล้ว |
| `DetailPanel.tsx` (71KB) | Checkout section: if CL booking → เปลี่ยนปุ่มเป็น "บันทึกเข้า City Ledger" + ซ่อน payment method selector |
| `InvoiceModal.tsx` | ถ้า invoice.cityLedgerAccountId → แสดงชื่อบริษัท + Tax ID แทน Guest info |

---

## ส่วนที่ 3: Prisma Schema ฉบับสมบูรณ์

```prisma
// ──────────────────────────────────────────────
// เพิ่มใน enum LedgerAccount
// ──────────────────────────────────────────────
enum LedgerAccount {
  CASH
  BANK
  AR
  AR_CORPORATE        // ← เพิ่มใหม่
  REVENUE
  DEPOSIT_LIABILITY
  PENALTY_REVENUE
  EXPENSE
  DISCOUNT_GIVEN
}

// ──────────────────────────────────────────────
// เพิ่ม enum ใหม่
// ──────────────────────────────────────────────
enum CityLedgerInvoiceStatus {
  pending     // ตั้งหนี้แล้ว ยังไม่ส่ง
  sent        // ส่งใบแจ้งหนี้แล้ว
  settled     // ชำระครบ
  disputed    // โต้แย้ง
}

enum CityLedgerAccountStatus {
  active
  suspended   // เกิน credit limit
  closed
}

// ──────────────────────────────────────────────
// Model ใหม่ 1: CityLedgerAccount
// ──────────────────────────────────────────────
model CityLedgerAccount {
  id              String   @id @default(uuid())
  accountCode     String   @unique @map("account_code")      // CL-0001
  companyName     String   @map("company_name")
  companyTaxId    String?  @map("company_tax_id")
  companyAddress  String?  @map("company_address")

  contactName     String?  @map("contact_name")
  contactEmail    String?  @map("contact_email")
  contactPhone    String?  @map("contact_phone")

  creditLimit     Decimal  @default(0) @map("credit_limit") @db.Decimal(12, 2)
  creditTermsDays Int      @default(30) @map("credit_terms_days")
  currentBalance  Decimal  @default(0) @map("current_balance") @db.Decimal(12, 2) // cached
  status          CityLedgerAccountStatus @default(active)

  version         Int      @default(1)  // Optimistic Concurrency
  notes           String?
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  bookings        Booking[]
  invoices        Invoice[]
  transactions    CityLedgerTransaction[]
  payments        CityLedgerPayment[]
  deposits        SecurityDeposit[]
  activityLogs    ActivityLog[]

  @@map("city_ledger_accounts")
}

// ──────────────────────────────────────────────
// Model ใหม่ 2: CityLedgerTransaction
// ──────────────────────────────────────────────
model CityLedgerTransaction {
  id              String   @id @default(uuid())
  accountId       String   @map("account_id")
  date            DateTime @db.Date
  type            String   // CHARGE | PAYMENT | VOID | ADJUSTMENT | BAD_DEBT
  referenceType   String   @map("reference_type")  // Invoice | Payment | CreditNote
  referenceId     String   @map("reference_id")
  amount          Decimal  @db.Decimal(12, 2)
  runningBalance  Decimal  @map("running_balance") @db.Decimal(12, 2)
  description     String?
  version         Int      @default(1)
  createdAt       DateTime @default(now()) @map("created_at")
  createdBy       String   @map("created_by")

  account         CityLedgerAccount @relation(fields: [accountId], references: [id])

  @@index([accountId, date])
  @@map("city_ledger_transactions")
}

// ──────────────────────────────────────────────
// Model ใหม่ 3: CityLedgerPayment
// ──────────────────────────────────────────────
model CityLedgerPayment {
  id                String        @id @default(uuid())
  paymentNumber     String        @unique @map("payment_number") // CL-PAY-YYYYMMDD-NNNN
  accountId         String        @map("account_id")
  amount            Decimal       @db.Decimal(12, 2)
  unallocatedAmount Decimal       @default(0) @map("unallocated_amount") @db.Decimal(12, 2)
  paymentDate       DateTime      @map("payment_date")
  paymentMethod     PaymentMethod @map("payment_method")
  referenceNo       String?       @map("reference_no")
  status            PaymentStatus @default(ACTIVE)
  notes             String?
  createdAt         DateTime      @default(now()) @map("created_at")
  createdBy         String        @map("created_by")

  account           CityLedgerAccount     @relation(fields: [accountId], references: [id])
  allocations       CityLedgerAllocation[]

  @@map("city_ledger_payments")
}

// ──────────────────────────────────────────────
// Model ใหม่ 4: CityLedgerAllocation
// ──────────────────────────────────────────────
model CityLedgerAllocation {
  id            String   @id @default(uuid())
  clPaymentId   String   @map("cl_payment_id")
  invoiceId     String   @map("invoice_id")
  amount        Decimal  @db.Decimal(12, 2)
  allocatedAt   DateTime @default(now()) @map("allocated_at")

  clPayment     CityLedgerPayment @relation(fields: [clPaymentId], references: [id])
  invoice       Invoice           @relation(fields: [invoiceId], references: [id])

  @@unique([clPaymentId, invoiceId])
  @@map("city_ledger_allocations")
}

// ──────────────────────────────────────────────
// แก้ไข Model เดิม
// ──────────────────────────────────────────────

// Booking: เพิ่ม
//   cityLedgerAccountId  String?  @map("city_ledger_account_id")
//   cityLedgerAccount    CityLedgerAccount? @relation(...)

// Invoice: เพิ่ม
//   cityLedgerAccountId  String?  @map("city_ledger_account_id")
//   cityLedgerStatus     CityLedgerInvoiceStatus?  @map("city_ledger_status")
//   cityLedgerAccount    CityLedgerAccount? @relation(...)
//   clAllocations        CityLedgerAllocation[]

// ActivityLog: เพิ่ม
//   cityLedgerAccountId  String?  @map("city_ledger_account_id")
//   cityLedgerAccount    CityLedgerAccount? @relation(...)
//   @@index เพิ่ม cityLedgerAccountId

// SecurityDeposit: เพิ่ม
//   cityLedgerAccountId  String?  @map("city_ledger_account_id")
//   cityLedgerAccount    CityLedgerAccount? @relation(...)
```

---

## ส่วนที่ 4: Service Functions ฉบับสมบูรณ์

### 4.1 `src/services/cityLedger.service.ts` (ใหม่)

```typescript
// ===== CORE FUNCTIONS =====

// 1. ตรวจสอบวงเงิน
checkCreditLimit(tx, accountId, chargeAmount)
  → return: { allowed: boolean, currentBalance, creditLimit, available }

// 2. ตั้งหนี้ (Post Invoice to CL)
postInvoiceToCityLedger(tx, { invoiceId, accountId, createdBy })
  → update Invoice.cityLedgerAccountId + cityLedgerStatus = 'pending'
  → create CityLedgerTransaction (type: CHARGE)
  → update CityLedgerAccount.currentBalance += amount
  → increment version (Optimistic Concurrency)
  → call postCityLedgerCharge() → LedgerEntry (DEBIT AR_CORPORATE | CREDIT REVENUE)
  → logActivity(category: 'city_ledger')

// 3. รับชำระเงิน
receiveCityLedgerPayment(tx, { accountId, amount, invoiceIds, paymentMethod, referenceNo, createdBy })
  → verify account.version (Optimistic Concurrency)
  → create CityLedgerPayment (auto-number CL-PAY-YYYYMMDD-NNNN)
  → loop invoiceIds: create CityLedgerAllocation, update Invoice.paidAmount + status
  → if leftover > 0 → set unallocatedAmount (advance deposit / overpayment)
  → create CityLedgerTransaction (type: PAYMENT)
  → update CityLedgerAccount.currentBalance -= amount
  → call postCityLedgerPaymentReceived() → LedgerEntry (DEBIT CASH/BANK | CREDIT AR_CORPORATE)
  → for each fully paid invoice: markLineItemsPaid(tx, invoiceId)
  → logActivity()

// 4. Aging Report
getAgingReport(accountId)
  → query unpaid invoices, group by aging bucket:
     Current (0-30 days), 31-60, 61-90, 91-120, 120+
  → return: { buckets: [...], total, invoices: [...] }

// 5. Statement
getStatement(accountId, { dateFrom, dateTo })
  → query CityLedgerTransaction ordered by date
  → return running balance list

// 6. Credit Hold
checkAndSuspendAccount(tx, accountId)
  → if currentBalance >= creditLimit → update status = 'suspended'
  → logActivity(severity: 'warning')

// 7. Bad Debt Write-off
writeOffBadDebt(tx, { invoiceId, accountId, reason, createdBy })
  → create CityLedgerTransaction (type: BAD_DEBT)
  → update Invoice.badDebt = true, badDebtNote = reason
  → update CityLedgerAccount.currentBalance -= amount
  → call postCityLedgerBadDebt() → LedgerEntry (DEBIT EXPENSE | CREDIT AR_CORPORATE)
  → logActivity(severity: 'warning')

// 8. Monthly Statement Generation
generateMonthlyStatement(tx, { accountId, month })
  → gather unpaid invoices for the month
  → create summary Invoice (type: 'city_ledger_summary')
  → logActivity()
```

### 4.2 `src/services/ledger.service.ts` (เพิ่ม 3 functions)

```typescript
// เพิ่มท้ายไฟล์:

postCityLedgerCharge(tx, { amount, invoiceId, description, createdBy })
  → DEBIT: AR_CORPORATE | CREDIT: REVENUE

postCityLedgerPaymentReceived(tx, { amount, paymentId, method, description, createdBy })
  → DEBIT: CASH หรือ BANK (ตาม method) | CREDIT: AR_CORPORATE

postCityLedgerBadDebt(tx, { amount, invoiceId, description, createdBy })
  → DEBIT: EXPENSE | CREDIT: AR_CORPORATE
```

### 4.3 `src/services/activityLog.service.ts` (แก้ไข)

```typescript
// เพิ่ม category:
type LogCategory = /* เดิมทั้งหมด */ | 'city_ledger';

// เพิ่ม icon:
city_ledger: '🏢'

// เพิ่ม field ใน LogActivityParams:
cityLedgerAccountId?: string | null;

// เพิ่มใน Prisma create data:
cityLedgerAccountId: params.cityLedgerAccountId ?? undefined
```

### 4.4 `src/services/invoice-number.service.ts` (เพิ่ม)

```typescript
// เพิ่ม prefix:
CL:     'CL-'        + sequence  → CL-0001, CL-0002
CL-PAY: 'CL-PAY-'    + YYYYMMDD + '-' + sequence
```

---

## ส่วนที่ 5: API Routes ฉบับสมบูรณ์

### ไฟล์ใหม่ทั้งหมด

```
src/app/api/city-ledger/
├── route.ts                    → GET (list) + POST (create account)
├── summary/
│   └── route.ts                → GET (dashboard KPIs)
├── [id]/
│   ├── route.ts                → GET (detail) + PUT (update account)
│   ├── aging/
│   │   └── route.ts            → GET (aging report)
│   ├── statement/
│   │   └── route.ts            → GET (statement with date range)
│   ├── payments/
│   │   └── route.ts            → POST (receive payment + allocate)
│   ├── credit-limit/
│   │   └── route.ts            → PUT (adjust credit limit)
│   └── credit-note/
│       └── route.ts            → POST (create adjustment)
```

### Zod Schemas (ทุก API ต้องมี)

```typescript
// src/lib/validations/cityLedger.ts

const CreateCLAccountSchema = z.object({
  companyName:     z.string().min(1).max(200),
  companyTaxId:    z.string().max(20).optional(),
  companyAddress:  z.string().max(500).optional(),
  contactName:     z.string().max(100).optional(),
  contactEmail:    z.string().email().optional(),
  contactPhone:    z.string().max(20).optional(),
  creditLimit:     z.number().nonnegative().default(0),
  creditTermsDays: z.number().int().min(1).max(365).default(30),
  notes:           z.string().max(500).optional(),
});

const ReceiveCLPaymentSchema = z.object({
  amount:        z.number().positive(),
  invoiceIds:    z.array(z.string().uuid()).min(1),
  paymentMethod: z.enum(['cash', 'transfer', 'credit_card', 'promptpay']),
  paymentDate:   z.string().datetime(),
  referenceNo:   z.string().max(100).optional(),
  cashSessionId: z.string().uuid().optional(),
  notes:         z.string().max(500).optional(),
});

const UpdateCreditLimitSchema = z.object({
  creditLimit:     z.number().nonnegative(),
  creditTermsDays: z.number().int().min(1).max(365).optional(),
  reason:          z.string().min(1).max(500),
});

const StatementQuerySchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
```

### แก้ไข API เดิม

| ไฟล์ | การแก้ไข |
|------|---------|
| `src/app/api/checkout/route.ts` | เพิ่ม CL branch: if `booking.cityLedgerAccountId` → bypass payment → postInvoiceToCityLedger |
| `src/app/api/bookings/route.ts` (POST) | รับ `cityLedgerAccountId` optional field → validate UUID → check creditLimit ก่อน create |
| `src/app/api/bookings/[id]/route.ts` (PATCH) | รองรับเปลี่ยน/เพิ่ม cityLedgerAccountId |

---

## ส่วนที่ 6: UI — หน้าจอและจุดเชื่อมต่อ

### 6.1 หน้าใหม่: `/city-ledger` (List)

```
┌─────────────────────────────────────────────────────────┐
│  🏢 City Ledger / บัญชีลูกค้าองค์กร          [+ เพิ่ม]  │
├─────────────────────────────────────────────────────────┤
│  KPI Cards:                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ ลูกหนี้รวม │ │ ค้าง >30d │ │ ค้าง >90d │ │ บัญชีทั้งหมด│   │
│  │ ฿1.2M    │ │ ฿340K    │ │ ฿85K     │ │ 12       │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│                                                          │
│  Search: [________________] Filter: [สถานะ▾] [เรียง▾]   │
│                                                          │
│  ┌─ Code ──┬─ Company ────────┬── Balance ──┬ Limit ──┐ │
│  │ CL-0001 │ ABC Hotel Group  │ ฿450,000    │ ฿500K   │ │
│  │ CL-0002 │ Thai Airways     │ ฿0 ✅       │ ฿1M     │ │
│  │ CL-0003 │ Booking.com      │ ฿89,000     │ ฿200K   │ │
│  └─────────┴──────────────────┴─────────────┴─────────┘ │
│  Color: 🟢 ปกติ  🟡 ≥70% limit  🔴 suspended           │
└─────────────────────────────────────────────────────────┘
```

### 6.2 หน้าใหม่: `/city-ledger/[id]` (Detail)

```
4 Tabs:
─────────────────────────────────────────
Tab 1: ใบแจ้งหนี้ (Invoices)
  → Table: invoiceNumber | date | amount | status | cityLedgerStatus
  → Checkbox select → ปุ่ม "รับชำระเงิน" → Payment Modal

Tab 2: การรับชำระ (Payments)
  → Table: paymentNumber | date | amount | method | allocatedTo

Tab 3: Statement (Running Balance)
  → Date range picker → Table: date | type | ref | debit | credit | balance

Tab 4: ประวัติ (Activity Log)
  → ดึงจาก ActivityLog WHERE cityLedgerAccountId = id
```

### 6.3 แก้ UI เดิม

| Component | จุดที่แก้ | รายละเอียด |
|-----------|----------|------------|
| `Sidebar.tsx` | nav items array | เพิ่ม `{ href: '/city-ledger', label: 'City Ledger', icon: '🏢' }` |
| `NewBookingDialog.tsx` | form fields | เพิ่ม optional `<select>` "บริษัท/CL" — ดึง list จาก `GET /api/city-ledger?status=active` |
| `DetailPanel.tsx` | checkout section | `if (booking.cityLedgerAccountId)` → ปุ่ม "บันทึกเข้า City Ledger" แทน "ชำระเงิน" |
| `DetailPanel.tsx` | info section | แสดงชื่อบริษัท CL ถ้ามี |
| Invoice components | invoice display | ถ้า `cityLedgerAccountId` → แสดงข้อมูลบริษัทแทน Guest |

---

## ส่วนที่ 7: แผนการทำงาน — 12 Steps (สำหรับ Sonnet)

### Phase A: Database + Foundation (Step 1-3)

#### Step 1: Update Prisma Schema
```
ไฟล์: prisma/schema.prisma
- เพิ่ม AR_CORPORATE ใน enum LedgerAccount
- เพิ่ม enum CityLedgerInvoiceStatus, CityLedgerAccountStatus
- เพิ่ม model: CityLedgerAccount, CityLedgerTransaction, CityLedgerPayment, CityLedgerAllocation
- แก้ model: Booking (+cityLedgerAccountId), Invoice (+cityLedgerAccountId, +cityLedgerStatus, +clAllocations), ActivityLog (+cityLedgerAccountId), SecurityDeposit (+cityLedgerAccountId)
- Run: npx prisma db push (หรือ migrate dev)
```

#### Step 2: Update Activity Log Service
```
ไฟล์: src/services/activityLog.service.ts
- เพิ่ม category: 'city_ledger'
- เพิ่ม icon: '🏢'
- เพิ่ม field: cityLedgerAccountId ใน LogActivityParams + Prisma create
```

#### Step 3: Update Invoice Number Service
```
ไฟล์: src/services/invoice-number.service.ts
- เพิ่ม generateCLAccountCode() → CL-XXXX (sequential)
- เพิ่ม generateCLPaymentNumber() → CL-PAY-YYYYMMDD-NNNN
```

### Phase B: Core Business Logic (Step 4-6)

#### Step 4: Create City Ledger Service
```
ไฟล์ใหม่: src/services/cityLedger.service.ts
Functions:
  - checkCreditLimit(tx, accountId, chargeAmount)
  - postInvoiceToCityLedger(tx, { invoiceId, accountId, createdBy })
  - receiveCityLedgerPayment(tx, { accountId, amount, invoiceIds, ... })
  - getAgingReport(accountId)
  - getStatement(accountId, { dateFrom, dateTo })
  - checkAndSuspendAccount(tx, accountId)
  - writeOffBadDebt(tx, { invoiceId, accountId, reason, createdBy })
  - generateMonthlyStatement(tx, { accountId, month })

ทุกฟังก์ชันใช้ prisma.$transaction + Optimistic Concurrency (version check)
```

#### Step 5: Update Ledger Service
```
ไฟล์: src/services/ledger.service.ts
เพิ่ม:
  - postCityLedgerCharge(tx, opts) → DEBIT AR_CORPORATE | CREDIT REVENUE
  - postCityLedgerPaymentReceived(tx, opts) → DEBIT CASH/BANK | CREDIT AR_CORPORATE
  - postCityLedgerBadDebt(tx, opts) → DEBIT EXPENSE | CREDIT AR_CORPORATE
```

#### Step 6: Update Checkout Flow
```
ไฟล์: src/app/api/checkout/route.ts
แก้ไข POST handler:
  - เพิ่ม: ดึง booking พร้อม cityLedgerAccountId
  - เพิ่ม: if (booking.cityLedgerAccountId) branch
    → checkCreditLimit → createInvoiceFromFolio → postInvoiceToCityLedger → skip payment → close folio
  - ไม่แตะ else branch เดิม
```

### Phase C: API Layer (Step 7-8)

#### Step 7: Create City Ledger API Routes
```
ไฟล์ใหม่:
  src/app/api/city-ledger/route.ts               → GET list + POST create
  src/app/api/city-ledger/summary/route.ts        → GET KPIs
  src/app/api/city-ledger/[id]/route.ts           → GET detail + PUT update
  src/app/api/city-ledger/[id]/aging/route.ts     → GET aging
  src/app/api/city-ledger/[id]/statement/route.ts → GET statement
  src/app/api/city-ledger/[id]/payments/route.ts  → POST receive payment
  src/app/api/city-ledger/[id]/credit-limit/route.ts → PUT adjust limit

ไฟล์ Zod:
  src/lib/validations/cityLedger.ts
  → CreateCLAccountSchema, ReceiveCLPaymentSchema, UpdateCreditLimitSchema, StatementQuerySchema

ทุก route: auth check → Zod validate → service call → select fields → return
```

#### Step 8: Update Existing API Routes
```
ไฟล์แก้ไข:
  src/app/api/bookings/route.ts (POST) → รับ cityLedgerAccountId optional
  src/app/api/bookings/[id]/route.ts (PATCH) → รองรับเปลี่ยน cityLedgerAccountId
```

### Phase D: Frontend (Step 9-11)

#### Step 9: City Ledger List Page
```
ไฟล์ใหม่: src/app/(dashboard)/city-ledger/page.tsx
- KPI Cards (total AR, overdue >30d, overdue >90d, account count)
- Data Table with color-coded status
- Search + filter (status, sort)
- Modal: Create/Edit CL Account
- ใช้ fmtBaht() สำหรับตัวเลข, fmtDate() สำหรับวันที่
```

#### Step 10: City Ledger Detail Page
```
ไฟล์ใหม่: src/app/(dashboard)/city-ledger/[id]/page.tsx
- Header: company info + balance + status badge
- 4 Tabs: Invoices, Payments, Statement, Activity
- Invoices Tab: checkbox multi-select → "รับชำระเงิน" button → Payment Modal
- Payment Modal: amount, method, reference, allocate to selected invoices
- Statement Tab: date range picker, running balance table
```

#### Step 11: Update Existing UI Components
```
ไฟล์แก้ไข:
  src/components/layout/Sidebar.tsx
    → เพิ่ม nav item: City Ledger 🏢

  src/app/(dashboard)/reservation/components/NewBookingDialog.tsx
    → เพิ่ม dropdown "บริษัท/City Ledger" (optional)
    → fetch CL accounts on mount

  src/app/(dashboard)/reservation/components/DetailPanel.tsx
    → checkout section: CL branch → different button + skip payment
    → info section: show company name if CL booking

  Invoice display components (InvoiceModal หรือ receipt):
    → if cityLedgerAccountId → show company name + Tax ID
```

### Phase E: Verification (Step 12)

#### Step 12: Test & Verify
```
Checklist:
  □ สร้าง CL Account ใหม่ → verify auto-number CL-0001
  □ สร้าง Booking ผูก CL → verify booking.cityLedgerAccountId set
  □ Check-in → Check-out (CL) → verify: invoice created, CL transaction posted, no payment collected
  □ รับชำระเงิน → allocate to 2 invoices → verify: invoice status updated, CL balance decreased
  □ Credit limit check → try booking เกิน limit → verify: blocked
  □ Aging report → verify buckets ถูกต้อง
  □ Statement → verify running balance ถูกต้อง
  □ Bad debt write-off → verify ledger entries (DEBIT EXPENSE | CREDIT AR_CORPORATE)
  □ Optimistic Concurrency → 2 users แก้ account พร้อมกัน → verify: P2025 error + UI warning
  □ Date formatting → ทุก UI ใช้ fmtDate/fmtDateTime/fmtBaht (ไม่ใช้ th-TH)
  □ TypeScript → npx tsc --noEmit passes
  □ All Prisma queries ใช้ select (ไม่ return ทั้ง object)
```

---

## ส่วนที่ 8: สรุปไฟล์ทั้งหมด

### ไฟล์ใหม่ (11 ไฟล์)

| # | ไฟล์ | ประเภท |
|---|------|--------|
| 1 | `src/services/cityLedger.service.ts` | Service |
| 2 | `src/lib/validations/cityLedger.ts` | Zod Schema |
| 3 | `src/app/api/city-ledger/route.ts` | API |
| 4 | `src/app/api/city-ledger/summary/route.ts` | API |
| 5 | `src/app/api/city-ledger/[id]/route.ts` | API |
| 6 | `src/app/api/city-ledger/[id]/aging/route.ts` | API |
| 7 | `src/app/api/city-ledger/[id]/statement/route.ts` | API |
| 8 | `src/app/api/city-ledger/[id]/payments/route.ts` | API |
| 9 | `src/app/api/city-ledger/[id]/credit-limit/route.ts` | API |
| 10 | `src/app/(dashboard)/city-ledger/page.tsx` | UI |
| 11 | `src/app/(dashboard)/city-ledger/[id]/page.tsx` | UI |

### ไฟล์แก้ไข (9 ไฟล์)

| # | ไฟล์ | สิ่งที่แก้ |
|---|------|-----------|
| 1 | `prisma/schema.prisma` | เพิ่ม 2 enums + 4 models + แก้ 4 models เดิม |
| 2 | `src/services/ledger.service.ts` | เพิ่ม 3 functions |
| 3 | `src/services/activityLog.service.ts` | เพิ่ม category + field |
| 4 | `src/services/invoice-number.service.ts` | เพิ่ม CL prefix generators |
| 5 | `src/app/api/checkout/route.ts` | เพิ่ม CL branch ใน checkout flow |
| 6 | `src/app/api/bookings/route.ts` | รับ cityLedgerAccountId |
| 7 | `src/components/layout/Sidebar.tsx` | เพิ่ม nav item |
| 8 | `src/app/(dashboard)/reservation/components/NewBookingDialog.tsx` | เพิ่ม CL dropdown |
| 9 | `src/app/(dashboard)/reservation/components/DetailPanel.tsx` | CL checkout branch |

---

*สร้างโดย Claude Opus | April 2026*
*พร้อมส่งมอบให้ Sonnet ดำเนินการ*
