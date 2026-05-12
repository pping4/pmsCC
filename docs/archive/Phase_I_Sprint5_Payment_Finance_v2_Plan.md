# Sprint 5 — Payment & Finance System v2

**Status:** READY TO START
**Owner:** PMS Team
**Date created:** 2026-04-23
**Target runtime:** Next.js 14 App Router · Prisma · PostgreSQL · TypeScript strict
**Supersedes:** none (new sprint)
**Depends on:** Sprint 4B (User/RBAC + Cashier) — ✅ complete

---

## 📑 Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Context & Problems Identified](#2-context--problems-identified)
3. [Industry Standards Research](#3-industry-standards-research)
4. [Decisions Locked (Q&A)](#4-decisions-locked-qa)
5. [Current State Snapshot](#5-current-state-snapshot)
6. [Gap Analysis](#6-gap-analysis)
7. [Phase Plan Overview](#7-phase-plan-overview)
8. [Phase 1 — Schema Foundation](#phase-1--schema-foundation-)
9. [Phase 2 — Upload Infrastructure](#phase-2--upload-infrastructure-)
10. [Phase 3 — Payment Collection UI](#phase-3--payment-collection-ui-revamp-)
11. [Phase 4 — Close Shift Redesign](#phase-4--close-shift-redesign-)
12. [Phase 5 — EDC Batch Close](#phase-5--edc-batch-close-)
13. [Phase 6 — Tax Invoice Module](#phase-6--tax-invoice-module-)
14. [Phase 7 — Reconciliation Monthly + Auto-Match Engine](#phase-7--reconciliation-monthly-)
15. [Phase 8 — e-Tax Export](#phase-8--e-tax-export--future)
16. [Phase 9 — Management Dashboard & Alerts](#phase-9--management-dashboard--alerts-)
17. [Outstanding / Open Questions](#17-outstanding--open-questions)
18. [Handoff Checklist for New Session](#18-handoff-checklist-for-new-session)
19. [Known Risks & Mitigations](#19-known-risks--mitigations)

---

## 1. Executive Summary

Comprehensive overhaul of PMS payment handling to support:
- ✅ **Multiple bank accounts** (2 บริษัท + 1 ส่วนตัว)
- ✅ **Bank transfer with slip evidence** (upload + duplicate protection)
- ✅ **QR/PromptPay slip handling**
- ✅ **Multiple EDC terminals** (BBL + KBank, extensible)
- ✅ **Card brand tracking** (Visa/Master/JCB/UnionPay/Amex) with per-brand MDR
- ✅ **EDC daily batch close** ("ส่งยอด") + reconciliation
- ✅ **Monthly card fee allocation** (MDR posting)
- ✅ **Tax invoice with Revenue Department-compliant running number** (separate from receipt)
- ✅ **2-state payment lifecycle** (RECEIVED → CLEARED) + separation of duties

**Estimated effort:** ~57 hours across 8 phases
**Critical path for user's top 5 pain points:** Phase 1-4 (~26 hours = ~4 working days)

---

## 2. Context & Problems Identified

### Pain points reported by user (2026-04-23)

| # | ปัญหา | ความเสี่ยง |
|---|---|---|
| **P1** | ลูกค้าโอนเงินแล้ว **ไม่เข้ากะแคชเชียร์** → แคชเชียร์ไม่รู้ต้องตรวจยังไง | เงินเข้าแล้วแต่ระบบบอกค้างจ่าย / slip ปลอม |
| **P2** | ลูกค้าโอนเข้า **บัญชี #2** แล้วระบบยังไม่รองรับหลายบัญชี | ระบุยากว่าเงินเข้าบัญชีไหน ปิดบัญชีเดือนยุ่ง |
| **P3** | QR จ่ายแล้ว ลูกค้าส่ง **slip** ให้ → ยังไม่มีที่เก็บหลักฐาน | ไม่มีหลักฐานกรณีลูกค้าโต้แย้ง / ตรวจสรรพากร |
| **P4** | มีเครื่องรูดบัตร **2 เครื่อง** หลายค่าย → ยังไม่มี terminal ID | ส่งยอดรายวันไม่รู้ว่ารายการนี้รูดเครื่องไหน |
| **P5** | บัตร **Visa/Master/UnionPay/Amex** → ระบบยังไม่แยก brand | คิด fee ต่างกันไม่ได้ รายงาน management ไม่ได้ |
| **P6** | **ค่าธรรมเนียมบัตร** มาสิ้นเดือน อัตราต่างกันต่อบัตร → บัญชีตรวจลำบาก | reconcile ไม่ได้ กำไรจริงไม่ตรงกับที่ระบบบอก |

---

## 3. Industry Standards Research

### 🔑 2-State Model (most important principle)

ทุก payment ที่ไม่ใช่เงินสดต้องแยก 2 สถานะ:

```
RECEIVED  (แคชเชียร์บันทึก — ยังไม่ยืนยัน)
   ↓
CLEARED   (บัญชีตรวจกับ statement แล้ว ตรงจริง)
```

→ ห้ามเอา payment ที่ยัง RECEIVED ไปหักยอดบัญชี จนกว่าจะ CLEARED
→ เงินสด = CLEARED ทันที (อยู่ในลิ้นชักแล้ว)

### 🔑 Separation of Duties (USALI)

| บทบาท | หน้าที่ |
|---|---|
| Front Office Cashier | รับเงิน · ปิดกะตัวเอง |
| Night Auditor | close day · ยืนยัน EDC settlement |
| Income Auditor | เทียบ cashier report vs bank + EDC statement (วันถัดไป) |
| Chief Accountant | reconcile bank statement · post MDR รายเดือน |

> **กฎสำคัญ:** คนรับเงิน ≠ คน reconcile → บังคับที่ RBAC

### 🔑 Thailand-specific

- Slip ปลอมเป็นเรื่องใหญ่ → unique `slipRefNo` constraint (ตอนนี้ไม่ใช้ API — D1)
- ใบเสร็จรับเงิน ≠ ใบกำกับภาษี → running number กรมสรรพากรต้องเรียงไม่มีช่องว่าง
- บัญชีรับเงินควรเป็น **บัญชีบริษัท** (ห้าม flag บัญชีส่วนตัวเป็น default)
- MDR rate ไทย 2026: Visa/Master 1.5-2.0% · JCB 1.8-2.2% · UnionPay 1.5-1.8% · **Amex 2.5-3.5%**

### 🔑 Patterns adopted from

- **Opera PMS** — payment method → GL mapping table
- **Protel/Mews** — payment intent lifecycle (PENDING → CONFIRMED)
- **Smart Finder/Comanche** — ใบเสร็จ vs ใบกำกับภาษี แยก running number
- **HFTP USALI 11th** — separation of duties

---

## 4. Decisions Locked (Q&A)

| # | Question | คำตอบ | Design impact |
|---|---|---|---|
| **D1** | Slip verification API | ไม่ใช้ตอนนี้ (อนาคต) | บังคับ `slipRefNo @unique` constraint เท่านั้น |
| **D2** | MDR rate model | Default ก่อน, future: per brand × card type | `CardBrand` + optional `CardType` + 3-level fallback table |
| **D3** | EDC terminals | BBL + KBank, แก้ไขได้ (+/-), allowed-brands future | `EdcTerminal` table + `allowedBrands String[]` (empty = all) |
| **D4** | Bank accounts | 3 accounts: BBL co · KBank co · BBL personal (กรรมการ) | Add `ownerType: COMPANY \| PERSONAL` flag + warning badge in UI |
| **D5** | Tax invoice | แยกออกจาก Receipt (บัญชีรวบรวมเอง) | New `TaxInvoice` model + own running number |
| **D6** | e-Tax One | Future; ต้อง export ได้ | Design `TaxInvoice` schema ให้ export เป็น XML/CSV ได้ |
| **D7** | WHT 50 ทวิ | Future phase | Skip ใน Sprint นี้ |

---

## 5. Current State Snapshot

### ✅ เสร็จแล้ว (จาก Sprint 4B)

- User + RBAC system (permissions, overrides, effective perms)
- CashBox + CashSession (counter-centric cashier)
- `getActiveSessionForUser()` — auto-resolve session for cash payment
- `/settings/cash-boxes` admin page
- `/settings/accounts` admin page + Bug1/Bug2 fixes
- Payment model + PaymentAllocation + PaymentAuditLog
- Ledger posting (double-entry) + `prisma.$transaction`
- Idempotency + audit log infrastructure
- Data wipe script: `npm run db:wipe`
- Cash payment at booking time → now binds to cashSessionId correctly

### 🧹 Clean state

**Data ถูก wipe แล้ว (2026-04-22):**
- booking = 0 · guest = 0 · payment = 0 · cashSession = 0 · ledger = 0
- financialAccount = 22 · cashBox = 2 · room = 48 · user = 4 (unchanged)

### 🛠️ Existing infrastructure ready to reuse

- `src/services/cashSession.service.ts` — session resolver
- `src/services/payment.service.ts` — core payment creation
- `src/services/ledger.service.ts` — double-entry posting
- `src/lib/validations/payment.schema.ts` — Zod schema base
- `src/lib/date-format.ts` — `fmtDate`, `fmtDateTime`, `fmtBaht` (MANDATORY)

---

## 6. Gap Analysis

### ❌ Schema gaps

- Credit card: no `cardBrand`, `cardType`, `cardLast4`, `authCode`, `terminalId`, `batchNo`
- Bank transfer: no `receivingAccountId` (which bank received?)
- Slip: no `slipImageUrl`, no `slipRefNo` unique
- Recon: no `reconStatus`, `clearedAt`, `clearedBy`
- No `EdcTerminal`, `CardFeeRate`, `CardBatchReport`, `NumberSequence`, `TaxInvoice` tables
- `FinancialAccount` missing `ownerType` (COMPANY vs PERSONAL)

### ❌ Route gaps

- No `POST /api/uploads` (slip upload)
- Non-cash payments optionally ref cashSessionId but no validation
- No `POST /api/card-batches` (EDC batch close)
- No `POST /api/tax-invoices` (Revenue-compliant numbering)
- No `POST /api/recon/bank-statement/import`
- No monthly MDR fee allocation route

### ❌ UI gaps

- PaymentDialog doesn't adapt fields per method
- No slip upload widget anywhere
- No EDC terminal picker
- CloseShiftDialog shows only cash (non-cash ignored)
- No tax invoice builder UI

### ❌ Reconciliation gaps

- No bank statement matching
- No card batch matching
- No MDR fee allocation
- No recon audit trail

### ❌ File upload gaps

- **Zero infrastructure** — no S3, no local upload, no validation

---

## 7. Phase Plan Overview

| Phase | Scope | Priority | Est. hours | Depends on | Pain points addressed |
|---|---|---|---|---|---|
| **1** | Schema + Enums + Seed (incl. composite indexes) | 🔴 P0 | 6h | – | P2, P4, P5 (data model) |
| **2** | Upload Infrastructure | 🔴 P0 | 4h | 1 | P3 (slip storage) |
| **3** | Payment Collection UI revamp (incl. 3.6 Quick Cashier) | 🔴 P0 | 14h | 1, 2 | P1, P2, P3, P4, P5 |
| **4** | Close Shift redesign | 🔴 P0 | 6h | 1 | P1 (ยอดโอนเข้ากะ) |
| **5** | EDC Batch Close | 🟡 P1 | 5h | 1, 4 | P4, P6 |
| **6** | Tax Invoice module | 🟡 P1 | 10h | 1 | D5 (ใบกำกับภาษี) |
| **7** | **Reconciliation + Auto-Match Engine** (3-tier fuzzy) | 🟢 P2 | 16h | 5, 6 | P6 (MDR recon, auto CLEARED) |
| **8** | e-Tax export | 🔵 P3 | 4h | 6 | D6 (future readiness) |
| **9** | **Management Dashboard & Stale Alerts** | 🟢 P2 | 6h | 7 | Management visibility |

**Total:** ~71 hours
**Critical path (P0 only):** 30 hours — แก้ P1-P5 หมด (รวม Quick Cashier)

### Recommended execution order

```
Day 1 (6h):    Phase 1    — schema + seed + composite indexes
Day 2 (4h):    Phase 2    — upload infra
Day 3-4 (10h): Phase 3.1-3.5 — payment UI
Day 5 (4h):    Phase 3.6  — Quick Cashier (QR scanner + EMVCo parser)
Day 6 (6h):    Phase 4    — close shift
────────────────────────────────────────
🎉 P1-P5 หมด + แคชเชียร์เร็วขึ้น 10× (~30h)

Day 7 (5h):     Phase 5   — EDC batch
Day 8-9 (10h):  Phase 6   — tax invoice
Day 10-12 (16h): Phase 7  — reconciliation + auto-match engine
Day 13 (6h):    Phase 9   — dashboard + stale alerts
Day 14 (4h):    Phase 8   — e-Tax export (optional)
────────────────────────────────────────
🎉 ครบทุก pain point + auto-recon + dashboard + e-Tax (~71h)
```

---

# Phase 1 — Schema Foundation 🔴

**Goal:** เพิ่ม field ทั้งหมดให้รองรับ brand/terminal/slip/recon state พร้อม seed data จริง
**Est:** 6h
**Depends on:** none

## 1.1 Prisma schema changes

**File:** `prisma/schema.prisma`

```prisma
// ─── NEW ENUMS ──────────────────────────────────────────────────────────────
enum CardBrand {
  VISA
  MASTER
  JCB
  UNIONPAY
  AMEX
  OTHER
}

enum CardType {
  NORMAL       // default
  PREMIUM      // Visa Premium / Platinum / Infinite
  CORPORATE
  UNKNOWN
}

enum ReconStatus {
  RECEIVED     // cashier logged, not yet verified
  CLEARED      // accounting confirmed against statement
  DISPUTED     // mismatch, under investigation
  VOIDED
}

enum BankAccountOwner {
  COMPANY
  PERSONAL     // warning badge in UI
}

enum ResetPeriod {
  NEVER
  YEARLY
  MONTHLY
  DAILY
}

enum TaxInvoiceStatus {
  ISSUED
  VOIDED
}

// ─── EXTEND FinancialAccount ────────────────────────────────────────────────
model FinancialAccount {
  // … existing fields …
  ownerType  BankAccountOwner?  // null for non-bank accounts
}

// ─── EXTEND Payment ─────────────────────────────────────────────────────────
model Payment {
  // … existing fields …

  // Bank transfer / QR
  receivingAccountId  String?
  receivingAccount    FinancialAccount? @relation("PaymentReceivingAccount", fields: [receivingAccountId], references: [id])
  slipImageUrl        String?
  slipRefNo           String?  @unique  // กัน slip ซ้ำ — null allowed (Postgres)

  // Credit card
  cardBrand       CardBrand?
  cardType        CardType?  @default(NORMAL)
  cardLast4       String?    @db.VarChar(4)
  authCode        String?    @db.VarChar(12)
  terminalId      String?
  terminal        EdcTerminal? @relation(fields: [terminalId], references: [id])
  batchNo         String?

  // Reconciliation
  reconStatus  ReconStatus @default(RECEIVED)
  clearedAt    DateTime?
  clearedBy    String?

  @@index([receivingAccountId])
  @@index([terminalId])
  @@index([reconStatus])
  @@index([batchNo])
  // composite indexes for recon engine (Phase 7) + stale alert (Phase 9)
  @@index([amount, paymentDate])            // fuzzy match on (amount, date window)
  @@index([reconStatus, createdAt])         // stale RECEIVED detection
}

// ─── NEW: EdcTerminal ───────────────────────────────────────────────────────
model EdcTerminal {
  id                 String   @id @default(cuid())
  code               String   @unique               // "BBL-01", "KBANK-01"
  name               String
  acquirerBank       String                          // "BBL" | "KBANK" | ...
  clearingAccountId  String
  clearingAccount    FinancialAccount @relation("TerminalClearingAccount", fields: [clearingAccountId], references: [id])
  allowedBrands      CardBrand[]                     // [] = all brands accepted
  merchantId         String?
  isActive           Boolean  @default(true)
  note               String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  payments       Payment[]
  batchReports   CardBatchReport[]
  feeRates       CardFeeRate[]
}

// ─── NEW: CardFeeRate (MDR) ─────────────────────────────────────────────────
model CardFeeRate {
  id            String      @id @default(cuid())
  terminalId    String?                    // null = global default
  terminal      EdcTerminal? @relation(fields: [terminalId], references: [id])
  brand         CardBrand
  cardType      CardType?                  // null = any
  ratePercent   Decimal     @db.Decimal(6, 4)
  effectiveFrom DateTime    @default(now())
  effectiveTo   DateTime?
  note          String?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@index([terminalId, brand, cardType, effectiveFrom])
}

// ─── NEW: CardBatchReport (EDC settlement) ──────────────────────────────────
model CardBatchReport {
  id              String    @id @default(cuid())
  terminalId      String
  terminal        EdcTerminal @relation(fields: [terminalId], references: [id])
  batchNo         String
  closeDate       DateTime                     // day the batch covers
  totalAmount     Decimal   @db.Decimal(14, 2)
  txCount         Int
  closedByUserId  String
  closedAt        DateTime  @default(now())
  note            String?
  varianceAmount  Decimal   @default(0) @db.Decimal(14, 2)

  @@unique([terminalId, batchNo])
  @@index([closeDate])
}

// ─── NEW: NumberSequence (atomic running numbers) ───────────────────────────
model NumberSequence {
  id           String      @id @default(cuid())
  kind         String      @unique              // "TAX_INVOICE" | "RECEIPT" | ...
  prefix       String                            // "TI" | "RC"
  nextSeq      Int         @default(1)
  resetEvery   ResetPeriod @default(NEVER)
  lastResetAt  DateTime?
  updatedAt    DateTime    @updatedAt
}

// ─── NEW: TaxInvoice ────────────────────────────────────────────────────────
model TaxInvoice {
  id                String    @id @default(cuid())
  number            String    @unique              // "TI-202604-00001"
  issueDate         DateTime  @default(now())

  // Customer snapshot (frozen at issue)
  customerName      String
  customerTaxId     String?
  customerBranch    String?                         // "สำนักงานใหญ่" / "สาขา 00001"
  customerAddress   String?

  // Amounts (frozen)
  subtotal          Decimal   @db.Decimal(14, 2)
  vatAmount         Decimal   @db.Decimal(14, 2)
  grandTotal        Decimal   @db.Decimal(14, 2)

  // Source links
  coveredInvoiceIds String[]
  coveredPaymentIds String[]

  status            TaxInvoiceStatus @default(ISSUED)
  voidReason        String?
  voidedAt          DateTime?
  voidedBy          String?
  issuedByUserId    String
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([issueDate])
  @@index([customerTaxId])
}
```

## 1.2 Migration

- **Additive only** — no data loss
- All new fields nullable → existing Payment rows remain valid
- Command: `npx prisma migrate dev --name payment_v2_schema`

## 1.3 Seed data

**File:** `prisma/seed.ts` (append)

```ts
// Bank accounts
const bblCo = await prisma.financialAccount.upsert({
  where: { code: '1120-01' },
  update: { ownerType: 'COMPANY', bankName: 'BBL', bankAccountName: '…บริษัท…', isActive: true },
  create: { code: '1120-01', name: 'BBL บริษัท', kind: 'ASSET', subKind: 'BANK',
            bankName: 'BBL', bankAccountName: '…บริษัท…', ownerType: 'COMPANY',
            isSystem: false, isDefault: true },
});
const kbankCo = await prisma.financialAccount.upsert({
  where: { code: '1120-02' },
  update: { ownerType: 'COMPANY', bankName: 'KBank', isActive: true },
  create: { code: '1120-02', name: 'KBank บริษัท', kind: 'ASSET', subKind: 'BANK',
            bankName: 'KBank', ownerType: 'COMPANY' },
});
const bblPersonal = await prisma.financialAccount.upsert({
  where: { code: '1120-03' },
  update: { ownerType: 'PERSONAL', bankName: 'BBL', isActive: true },
  create: { code: '1120-03', name: 'BBL กรรมการ (ส่วนตัว)', kind: 'ASSET', subKind: 'BANK',
            bankName: 'BBL', ownerType: 'PERSONAL' },
});

// EDC terminals (need clearing accounts first — existing 1131-01 or create 1131-02)
const bblEdc = await prisma.edcTerminal.upsert({
  where: { code: 'BBL-01' },
  update: {},
  create: { code: 'BBL-01', name: 'เครื่องรูดบัตร BBL', acquirerBank: 'BBL',
            clearingAccountId: bblClearingAcct.id, allowedBrands: [] },
});
const kbankEdc = await prisma.edcTerminal.upsert({
  where: { code: 'KBANK-01' },
  update: {},
  create: { code: 'KBANK-01', name: 'เครื่องรูดบัตร KBank', acquirerBank: 'KBANK',
            clearingAccountId: kbankClearingAcct.id, allowedBrands: [] },
});

// Default MDR rates (global, brand-level, any cardType)
const defaultMDR = [
  { brand: 'VISA',     rate: 1.75 },
  { brand: 'MASTER',   rate: 1.75 },
  { brand: 'JCB',      rate: 2.00 },
  { brand: 'UNIONPAY', rate: 1.60 },
  { brand: 'AMEX',     rate: 3.00 },
];
for (const f of defaultMDR) {
  await prisma.cardFeeRate.upsert({
    where: { /* composite not available — use findFirst + create if-not-exists */ },
    create: { terminalId: null, brand: f.brand as any, cardType: null, ratePercent: f.rate },
    update: {},
  });
}

// Number sequences
await prisma.numberSequence.upsert({
  where: { kind: 'TAX_INVOICE' },
  update: {},
  create: { kind: 'TAX_INVOICE', prefix: 'TI', resetEvery: 'MONTHLY' },
});
await prisma.numberSequence.upsert({
  where: { kind: 'RECEIPT' },
  update: {},
  create: { kind: 'RECEIPT', prefix: 'RC', resetEvery: 'YEARLY' },
});
```

## 1.4 Acceptance tests

- [ ] `npm run db:push && npm run db:seed` completes without error
- [ ] `prisma.financialAccount.findMany({ where: { ownerType: 'COMPANY' } })` returns 2 rows
- [ ] `prisma.edcTerminal.count()` === 2
- [ ] `prisma.cardFeeRate.count()` ≥ 5
- [ ] Existing Payment records still readable (migration additive-safe)

---

# Phase 2 — Upload Infrastructure 🔴

**Goal:** รองรับ upload slip/evidence แบบ local (MVP), พร้อม migrate ไป S3 ในอนาคต
**Est:** 4h
**Depends on:** Phase 1

## 2.1 Deliverables

**Files to create:**
- `src/lib/uploads/storage.ts` — storage adapter interface
- `src/lib/uploads/local-storage.ts` — local disk impl
- `src/app/api/uploads/route.ts` — `POST` endpoint
- `public/uploads/.gitkeep`

**Files to edit:**
- `.gitignore` — add `public/uploads/*` (keep `.gitkeep`)

## 2.2 API spec — `POST /api/uploads`

- **Auth:** session required
- **Content-Type:** `multipart/form-data`
- **Input:**
  ```
  FormData:
    file: File       (required)
    purpose: string  ("payment_slip" | "edc_receipt" | "other")
  ```
- **Validation:**
  - `file.size` ≤ 5 MB → 413 if exceeded
  - `file.type` ∈ [`image/jpeg`, `image/png`, `image/webp`, `application/pdf`] → 415 if bad
  - Filename sanitized
- **Storage path:** `public/uploads/{purpose}/YYYY/MM/{uuid}.{ext}`
- **Output (200):**
  ```json
  {
    "url": "/uploads/payment_slip/2026/04/abc-def-...jpg",
    "size": 234567,
    "mime": "image/jpeg",
    "filename": "abc-def-...jpg"
  }
  ```
- **Errors:** 401 · 413 · 415

## 2.3 Technical notes

```ts
// storage.ts
export interface StorageAdapter {
  save(opts: { buf: Buffer; purpose: string; ext: string; mime: string })
    : Promise<{ url: string; filename: string }>;
}

// local-storage.ts — fs/promises.writeFile + mkdir recursive
// Future: s3-storage.ts swaps in without touching route.ts
```

- Use `request.formData()` (native Next 14, no multer needed)
- Generate filename via `crypto.randomUUID()`
- **Do NOT strip EXIF in v1** — documented as Phase 7+ future task (needs `sharp` dep)

## 2.4 Acceptance tests

- [ ] Upload 4 MB JPG → 200, file on disk, URL accessible
- [ ] Upload 6 MB JPG → 413
- [ ] Upload `.exe` → 415
- [ ] Upload without session → 401
- [ ] Two uploads create 2 distinct UUIDs (no collision)

---

# Phase 3 — Payment Collection UI Revamp 🔴

**Goal:** แคชเชียร์บันทึกรับเงินได้ถูกวิธีสำหรับทุก payment method
**Est:** 10h
**Depends on:** Phase 1, 2

## 3.1 Deliverables

**Files to edit:**
- `src/lib/validations/payment.schema.ts`
- `src/services/payment.service.ts`
- `src/app/api/payments/route.ts`
- `src/app/api/bookings/[id]/pay/route.ts`
- `src/app/api/bookings/route.ts` (inline payment path)
- `src/components/payment/PaymentDialog.tsx` (major rewrite)

**Files to create:**
- `src/components/payment/SlipUploadField.tsx`
- `src/components/payment/CardTerminalPicker.tsx`
- `src/components/payment/ReceivingAccountPicker.tsx`

## 3.2 Extended Zod schema

```ts
export const CreatePaymentSchema = z.object({
  // existing
  bookingId:     z.string().cuid().optional(),
  folioId:       z.string().cuid().optional(),
  amount:        z.coerce.number().positive(),
  paymentMethod: z.enum(['cash', 'transfer', 'credit_card', 'promptpay', 'ota_collect']),
  paymentDate:   z.coerce.date().optional(),
  note:          z.string().max(500).optional(),

  // NEW — transfer / QR
  receivingAccountId: z.string().cuid().optional(),
  slipImageUrl:       z.string().url().optional(),
  slipRefNo:          z.string().max(50).optional(),
  referenceNo:        z.string().max(50).optional(),

  // NEW — credit card
  cardBrand:   z.nativeEnum(CardBrand).optional(),
  cardType:    z.nativeEnum(CardType).optional(),
  cardLast4:   z.string().regex(/^\d{4}$/).optional(),
  authCode:    z.string().max(12).optional(),
  terminalId:  z.string().cuid().optional(),
})
.refine(d => d.paymentMethod !== 'transfer'    || !!d.receivingAccountId,
        { message: 'กรุณาเลือกบัญชีที่รับเงิน', path: ['receivingAccountId'] })
.refine(d => d.paymentMethod !== 'promptpay'   || !!d.receivingAccountId,
        { message: 'กรุณาเลือกบัญชีที่รับเงิน', path: ['receivingAccountId'] })
.refine(d => d.paymentMethod !== 'credit_card' || !!d.terminalId,
        { message: 'กรุณาเลือกเครื่อง EDC', path: ['terminalId'] })
.refine(d => d.paymentMethod !== 'credit_card' || !!d.cardBrand,
        { message: 'กรุณาเลือกแบรนด์บัตร', path: ['cardBrand'] });
```

## 3.3 PaymentDialog UX spec

**Behavior:** method dropdown → fields below change dynamically

| Method | Required fields |
|---|---|
| `cash` | (none — cashSession auto-resolved) |
| `transfer` | บัญชีที่รับ · slip upload · reference |
| `promptpay` | บัญชีที่รับ · slip upload (ref optional, QR has it) |
| `credit_card` | terminal · brand · cardType · last4 · authCode |
| `ota_collect` | (none — no cashSession binding) |

**UX rules:**
- บัญชีที่รับ dropdown: group by COMPANY/PERSONAL · PERSONAL shows ⚠️ badge
- Slip upload: drag-drop or click, preview thumbnail, remove button, progress bar
- Reference no: on blur → debounced `GET /api/payments/check-slip-ref` (optional polish)

## 3.4 Service-level logic (payment.service.ts)

```ts
export async function createPayment(input: CreatePaymentInput, opts: { userId: string; userName?: string }) {
  return prisma.$transaction(async (tx) => {
    // 1. Cash session resolution (cash only)
    let cashSessionId: string | null = null;
    let cashBoxId: string | null = null;
    if (input.paymentMethod === 'cash') {
      const active = await getActiveSessionForUser(tx, opts.userId);
      if (!active) throw new AppError('CASH_NO_SESSION', 'การรับเงินสดต้องเปิดกะก่อน');
      cashSessionId = active.id;
      cashBoxId     = active.cashBoxId;
    }

    // 2. Slip uniqueness (pre-check for nicer error)
    if (input.slipRefNo) {
      const dup = await tx.payment.findUnique({
        where: { slipRefNo: input.slipRefNo }, select: { id: true }
      });
      if (dup) throw new AppError('SLIP_DUP', 'เลขอ้างอิง slip นี้ถูกใช้แล้ว');
    }

    // 3. Terminal brand check (if allowedBrands set)
    if (input.paymentMethod === 'credit_card' && input.terminalId && input.cardBrand) {
      const term = await tx.edcTerminal.findUnique({
        where: { id: input.terminalId },
        select: { allowedBrands: true, isActive: true },
      });
      if (!term?.isActive) throw new AppError('TERMINAL_INACTIVE');
      if (term.allowedBrands.length > 0 && !term.allowedBrands.includes(input.cardBrand)) {
        throw new AppError('BRAND_NOT_ACCEPTED', 'เครื่อง EDC นี้ไม่รองรับแบรนด์ที่เลือก');
      }
    }

    // 4. Create
    const payment = await tx.payment.create({
      data: {
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        paymentDate: input.paymentDate ?? new Date(),
        bookingId: input.bookingId,
        folioId: input.folioId,
        cashSessionId, cashBoxId,

        receivingAccountId: input.receivingAccountId ?? null,
        slipImageUrl:       input.slipImageUrl ?? null,
        slipRefNo:          input.slipRefNo ?? null,
        referenceNo:        input.referenceNo ?? null,

        cardBrand:   input.cardBrand ?? null,
        cardType:    input.cardType ?? null,
        cardLast4:   input.cardLast4 ?? null,
        authCode:    input.authCode ?? null,
        terminalId:  input.terminalId ?? null,

        reconStatus: input.paymentMethod === 'cash' ? 'CLEARED' : 'RECEIVED',
        createdByUserId: opts.userId,
      },
      select: { /* … */ },
    });

    // 5. Ledger + audit
    await postPaymentReceived(tx, payment);
    await writeAuditLog(tx, { action: 'PAYMENT_CREATE', entityId: payment.id, userId: opts.userId });

    return payment;
  }, { isolationLevel: 'ReadCommitted', timeout: 15_000 });
}
```

## 3.5 Acceptance tests

- [ ] Cash w/o open shift → 422 `CASH_NO_SESSION`
- [ ] Transfer w/o `receivingAccountId` → 422
- [ ] Transfer w/ duplicate `slipRefNo` → 409 `SLIP_DUP`
- [ ] Credit card w/o terminalId → 422
- [ ] Credit card w/ brand not in terminal's `allowedBrands` (when set) → 422 `BRAND_NOT_ACCEPTED`
- [ ] All non-cash created → `reconStatus === 'RECEIVED'`
- [ ] Cash created → `reconStatus === 'CLEARED'`

## 3.6 Quick Cashier Mode (Keyboard-First Flow) ⚡

**Goal:** บันทึกรับเงินโอน/QR จบใน 5-8 วินาทีโดยไม่ต้องจับเมาส์
**Est:** 4h
**Skill reference:** `.claude/skills/keyboard-first-flow.md`

### 3.6.1 Principle

Scanner ปกติ (Honeywell/Zebra/USB QR scanner) ส่ง input แบบ keyboard — ยิงตัวอักษรเป็นชุด ปิดท้ายด้วย `\r` (Enter) ภายใน ~100ms
→ เราดัก event ได้โดยไม่ต้องต่อ hardware driver

### 3.6.2 Deliverables

**Files to create:**
- `src/lib/qr/emvco-thai-parser.ts` — parse EMVCo Thai QR Payment string
- `src/lib/qr/qr-scan-listener.ts` — rapid-keystroke detector hook
- `src/components/payment/QrScanHandler.tsx` — wraps PaymentDialog, listens for scan events

**Files to edit:**
- `src/components/payment/PaymentDialog.tsx` — wire up QrScanHandler when method=promptpay/transfer
- `src/app/(dashboard)/settings/users/page.tsx` — add toggle "เปิดใช้เครื่องสแกน QR" per user (stored in `User.uiPreferences` JSON)

### 3.6.3 EMVCo Thai QR parser

Parse TLV format (Tag-Length-Value):

| Tag | Field | Example |
|---|---|---|
| 00 | Payload Format Indicator | `01` |
| 01 | Point of Initiation | `11` static, `12` dynamic |
| 29/30 | PromptPay Merchant Account Info | contains receiver account |
| 53 | Currency | `764` (THB) |
| 54 | **Transaction Amount** | `100.00` (dynamic QR only) |
| 62 | Additional Data (ref) | contains `slipRefNo` |
| 63 | CRC checksum | always last 4 chars |

```ts
// emvco-thai-parser.ts
export interface ThaiQrPayload {
  type: 'static' | 'dynamic';
  receiverRef: string;       // PromptPay ID or bank ref
  amount?: number;           // only present in dynamic QR
  slipRefNo?: string;        // extracted from tag 62
  raw: string;
}

export function parseThaiQr(raw: string): ThaiQrPayload | null { /* TLV walk + CRC validate */ }
```

### 3.6.4 Scan listener (rapid keystroke pattern)

```ts
// qr-scan-listener.ts
export function useQrScanListener(opts: {
  onScan: (raw: string) => void;
  enabled: boolean;
  minSpeed?: number;       // chars per ms, default 0.5
  minLength?: number;      // default 30 (QR strings are always long)
}) {
  // Buffer keystrokes; if burst ends in Enter and speed exceeds threshold → onScan(buffer)
  // Otherwise treat as normal typing (fall through)
}
```

Threshold logic: if time-between-chars < 50ms for ≥ 30 chars ending in Enter → scan event; else ignore.

### 3.6.5 UX flow

```
[Cashier opens PaymentDialog, method=promptpay]
  ↓ focus auto-lands on amount field
[Scanner beams slip QR]
  ↓ QrScanHandler intercepts, parses
[Fields auto-fill: amount, slipRefNo, receivingAccountId]
  ↓ validator runs, duplicate check hits
[Green highlight "พร้อมบันทึก" OR red "slip ซ้ำ"]
  ↓ Enter → submit
[Receipt printed, dialog closes]
```

Fallback: if parsing fails → show non-blocking toast "QR อ่านไม่ได้ กรุณากรอกเอง", leave form as manual.

### 3.6.6 Acceptance tests

- [ ] Paste valid Thai dynamic QR string → all 3 fields populated correctly
- [ ] Paste valid static QR (no amount) → amount field left blank, user fills
- [ ] Paste malformed string → toast shown, form remains manual-entry ready
- [ ] Toggle "เปิดใช้สแกนเนอร์" off → rapid keystrokes treated as normal typing
- [ ] Scan slip with `slipRefNo` that exists → duplicate error shown before submit
- [ ] Normal manual typing (slow) → NOT intercepted as scan
- [ ] Scanner input followed by immediate Enter → form submits (keyboard-first complete)

---

# Phase 4 — Close Shift Redesign 🔴

**Goal:** แคชเชียร์เห็นยอดทุก method แยกชัด, ปิดกะตามมาตรฐานโรงแรม
**Est:** 6h
**Depends on:** Phase 1

## 4.1 Deliverables

**Files to edit:**
- `src/components/cashier/CloseShiftDialog.tsx` (rewrite content area)
- `src/services/cashSession.service.ts` (add `getShiftSummary()`)

**Files to create:**
- `src/app/api/cash-sessions/[id]/summary/route.ts` (OR extend existing)

## 4.2 Summary API — `GET /api/cash-sessions/:id/summary`

```json
{
  "session": { "id": "...", "openedAt": "2026-04-23T08:00:00", "cashBoxId": "...", "openingFloat": 5000 },
  "cash": { "expectedTotal": 12500.00, "paymentCount": 8 },
  "nonCash": {
    "transfer":  [
      { "receivingAccountId": "...", "accountName": "BBL บริษัท", "total": 8500, "count": 2, "pendingClear": 2 },
      { "receivingAccountId": "...", "accountName": "KBank บริษัท", "total": 3200, "count": 1, "pendingClear": 1 }
    ],
    "promptpay": [
      { "receivingAccountId": "...", "accountName": "BBL บริษัท", "total": 1500, "count": 3, "pendingClear": 3 }
    ],
    "creditCard": [
      { "terminalId": "...", "terminalCode": "BBL-01", "brand": "VISA",   "total": 5600, "count": 2 },
      { "terminalId": "...", "terminalCode": "BBL-01", "brand": "MASTER", "total": 2400, "count": 1 }
    ]
  },
  "pendingRecon": 6,
  "grandTotal": 36700.00
}
```

## 4.3 Close Shift Dialog layout

```
┌─────────────────────────────────────────────────────┐
│  ปิดกะ — แคชเชียร์ A · เปิดเมื่อ 08:00              │
├─────────────────────────────────────────────────────┤
│  [1. เงินสด]                                         │
│     เงินทอนต้น          5,000.00                    │
│     ระบบคาดว่า         +12,500.00                   │
│     นับจริง            [______] ← input              │
│     ส่วนต่าง             ±0.00  🟢  (auto-calc)     │
├─────────────────────────────────────────────────────┤
│  [2. ยอดไม่ใช่เงินสด (ส่งต่อบัญชีตรวจสอบ)]          │
│     โอนเข้า BBL บริษัท       8,500  (2 รายการ)  ⏳2 │
│     โอนเข้า KBank บริษัท    3,200  (1 รายการ)  ⏳1 │
│     PromptPay → BBL บริษัท   1,500  (3 รายการ)  ⏳3 │
│     บัตร BBL-01 · Visa        5,600  (2 รายการ)     │
│     บัตร BBL-01 · Master      2,400  (1 รายการ)     │
│     บัตร KBANK-01 · Visa      3,000  (1 รายการ)     │
│     รวมไม่ใช่เงินสด       24,200.00                 │
├─────────────────────────────────────────────────────┤
│  [3. สรุป]                                           │
│     ยอดรวมกะ              36,700.00                 │
│     รายการรอตรวจสอบ        6 รายการ                │
│  บันทึก:  [___________________]                    │
│             [ยกเลิก]  [ปิดกะ]                      │
└─────────────────────────────────────────────────────┘
```

## 4.4 Technical notes

- Aggregate query: single Prisma `groupBy` per method to avoid N+1
- Cash variance → still posts to `CASH_OVER_SHORT` account (existing logic preserved)
- Non-cash **does not affect cash count** — just displayed for awareness
- `pendingClear` badge sets expectation that accounting will verify later

## 4.5 Acceptance tests

- [ ] Shift with mixed payments → summary shows correct breakdown per method/account/brand
- [ ] Shift with only cash → non-cash blocks empty (UI handles gracefully)
- [ ] Close with cash variance > 100 → require note (existing behavior preserved)
- [ ] Close shift → non-cash payments remain `RECEIVED` (not forced to CLEARED)

---

# Phase 5 — EDC Batch Close 🟡

**Goal:** แคชเชียร์/Night auditor กดส่งยอดเครื่อง EDC → บันทึก batch + เทียบกับ Payment records
**Est:** 5h
**Depends on:** Phase 1, 4

## 5.1 Deliverables

**Files to create:**
- `src/app/(dashboard)/cashier/batch-close/page.tsx`
- `src/app/api/card-batches/route.ts`
- `src/app/api/card-batches/[id]/route.ts`
- `src/services/cardBatch.service.ts`

## 5.2 POST /api/card-batches

- **Input:**
  ```ts
  {
    terminalId: string,
    batchNo: string,
    closeDate: string (YYYY-MM-DD),
    edcTotalAmount: number,
    edcTxCount: number,
    note?: string
  }
  ```
- **Logic (transaction):**
  1. Sum `Payment` where `terminalId=X AND batchNo IS NULL AND paymentDate::date = closeDate AND reconStatus != VOIDED`
  2. Compute `variance = edcTotalAmount - pmsTotal`
  3. Create `CardBatchReport` + update all matched Payments with `batchNo = X`
  4. Audit log
- **Output:**
  ```json
  {
    "batch": { "id": "...", "batchNo": "00123", "edcTotal": 5600, "pmsTotal": 5600, "variance": 0, "txCount": 3 },
    "matchedPayments": 3,
    "variance": { "amount": 0, "ok": true }
  }
  ```

## 5.3 UI layout

```
┌───────────────────────────────────────────┐
│  ส่งยอดเครื่องรูดบัตร (ปิด batch)          │
├───────────────────────────────────────────┤
│  เครื่อง   [BBL-01 ▾]                      │
│  วันที่    [2026-04-23]                    │
│  Batch #   [____]                          │
│  ยอดรวม   [___________]                    │
│  จำนวน    [___]                            │
│                                            │
│  ▸ ระบบเทียบกับรายการบัตรของวันนั้น         │
│     PMS:  5,600.00 (3 รายการ)              │
│     EDC:  5,600.00 (3 รายการ)              │
│     ต่าง:  0.00  ✓                         │
│                                            │
│         [ยกเลิก]  [ยืนยันปิด batch]        │
└───────────────────────────────────────────┘
```

## 5.4 Acceptance tests

- [ ] Batch with matching amount → variance = 0, all Payments get `batchNo`
- [ ] Batch with variance ≠ 0 → still saves, flags for review
- [ ] Attempt to close batch with duplicate `(terminalId, batchNo)` → 409
- [ ] Re-attempt on same day → shows already-matched count, excludes them

---

# Phase 6 — Tax Invoice Module 🟡

**Goal:** บัญชีรวบรวมใบเสร็จ → ออกใบกำกับภาษีพร้อม running number กรมสรรพากร
**Est:** 10h
**Depends on:** Phase 1

## 6.1 Deliverables

**Files to create:**
- `src/services/numberSequence.service.ts`
- `src/services/taxInvoice.service.ts`
- `src/app/api/tax-invoices/route.ts`
- `src/app/api/tax-invoices/[id]/route.ts`
- `src/app/(dashboard)/accounting/tax-invoices/page.tsx`
- `src/app/(dashboard)/accounting/tax-invoices/new/page.tsx`
- `src/app/(dashboard)/accounting/tax-invoices/[id]/page.tsx`
- `src/components/tax-invoice/TaxInvoicePrint.tsx`
- `src/components/tax-invoice/TaxInvoiceBuilder.tsx`

## 6.2 Atomic running number

```ts
// src/services/numberSequence.service.ts
export async function nextSequenceNumber(
  tx: Prisma.TransactionClient,
  kind: 'TAX_INVOICE' | 'RECEIPT'
): Promise<string> {
  // Lock the row via SELECT FOR UPDATE
  const rows = await tx.$queryRaw<Array<{
    id: string; prefix: string; nextSeq: number;
    resetEvery: ResetPeriod; lastResetAt: Date | null;
  }>>`
    SELECT id, prefix, "nextSeq", "resetEvery", "lastResetAt"
    FROM "NumberSequence"
    WHERE kind = ${kind}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new Error(`NumberSequence[${kind}] not found`);

  const now = new Date();
  let seq = row.nextSeq;
  const shouldReset = needsReset(row.resetEvery, row.lastResetAt, now);
  if (shouldReset) seq = 1;

  const periodTag = formatPeriodTag(row.resetEvery, now); // "202604" for monthly
  const number = `${row.prefix}-${periodTag}-${String(seq).padStart(5, '0')}`;

  await tx.numberSequence.update({
    where: { id: row.id },
    data: { nextSeq: seq + 1, lastResetAt: shouldReset ? now : row.lastResetAt },
  });

  return number;
}
```

## 6.3 POST /api/tax-invoices

- **Input:**
  ```ts
  {
    customerName: string,
    customerTaxId?: string,
    customerBranch?: string,
    customerAddress?: string,
    coveredInvoiceIds: string[],     // required, ≥1
    coveredPaymentIds?: string[],
    issueDate?: string
  }
  ```
- **Logic (transaction, ReadCommitted):**
  1. Verify all invoices exist, belong to same customer, not in another active TI
  2. Aggregate subtotal/vat/grandTotal from invoices
  3. Allocate number via `nextSequenceNumber(tx, 'TAX_INVOICE')` — **last step before create**
  4. Create TaxInvoice with frozen snapshot
  5. Audit log
- **Output:**
  ```json
  { "taxInvoice": { "id": "...", "number": "TI-202604-00001", "grandTotal": 11235.00 } }
  ```

## 6.4 Void rules

- Only status=`ISSUED` → PATCH to `VOIDED` with reason
- **Voided rows kept** (กรมสรรพากรเช็คได้)
- Running number not reused (gap preserved with VOIDED status)

## 6.5 UI flow

1. Accountant opens `/accounting/tax-invoices/new`
2. Search customer → show unissued invoices/receipts
3. Check-box selection → right panel auto-calculates totals
4. Edit customer tax info (autofill from last record)
5. Preview → submit → redirect to detail page

## 6.6 Print template

A4 Thai-formatted layout (server-rendered HTML + browser print)

Required fields (กรมสรรพากร):
- เลขที่ใบกำกับภาษี · วันที่
- ชื่อ/ที่อยู่/เลขประจำตัวผู้เสียภาษี (ผู้ขาย ← จาก HotelSettings)
- ชื่อ/ที่อยู่/เลขผู้เสียภาษี (ลูกค้า)
- รายการสินค้า/บริการ · หน่วย · ราคา
- ราคาไม่รวม VAT · VAT 7% · รวม

## 6.7 Acceptance tests

- [ ] Concurrent TI creation (10 parallel) → all get unique sequential numbers
- [ ] Monthly reset: first TI in May 2026 → `TI-202605-00001`
- [ ] Void → status=VOIDED, still visible, running number gap preserved
- [ ] Build 1 TI from 3 invoices → sums correctly
- [ ] Try to cover same invoice twice → 409

---

# Phase 7 — Reconciliation Monthly 🟢

**Goal:** บัญชีนำเข้า statement → match Payment records → mark CLEARED → post MDR fee
**Est:** 16h (12h base + 4h auto-match engine)
**Depends on:** Phase 5, 6

## 7.0 Auto-Match Engine — `recon-engine.service.ts` (หัวใจของ Phase 7)

**Principle:** แทนที่จะรอบัญชีกดทีละรายการ → worker รัน 3-tier fuzzy match แล้วเคลียร์เองเมื่อมั่นใจ 100%, โยนที่น่าสงสัยเข้าคิว manual review

### 7.0.1 Architecture

```
[CSV/JSON statement upload]
        ↓
[recon-engine.service.ts]
        ↓
  ┌─────┴──────┐
  │ Tier 1     │ slipRefNo exact match
  │ EXACT      │ → reconStatus='CLEARED'
  │            │   clearedBy='SYSTEM_AUTO:EXACT'
  ├────────────┤
  │ Tier 2     │ amount + date±window + receivingAccountId
  │ CONFIDENCE │ + no-ambiguity guard (unique candidate)
  │            │ → reconStatus='CLEARED'
  │            │   clearedBy='SYSTEM_AUTO:CONFIDENCE'
  ├────────────┤
  │ Tier 3     │ amount match but date too far / ambiguous
  │ SUSPICIOUS │ → queue for manual review (no status change)
  └────────────┘
        ↓
[ReconAttempt audit row + dashboard surfaces unmatched]
```

### 7.0.2 New model: `ReconAttempt` (audit of every match attempt)

```prisma
model ReconAttempt {
  id               String    @id @default(cuid())
  sourceType       String                      // "BANK_STATEMENT" | "CARD_BATCH"
  sourceRef        String                      // statement import id, batch ref
  statementLineRef String                      // bank's tx reference
  amount           Decimal   @db.Decimal(14, 2)
  statementDate    DateTime
  receivingAccountId String?

  matchedPaymentId String?                     // FK Payment (null if no match)
  matchTier        String?                     // "EXACT" | "CONFIDENCE" | "SUSPICIOUS"
  reason           String?                     // human-readable why
  createdAt        DateTime  @default(now())

  @@index([sourceType, sourceRef])
  @@index([matchedPaymentId])
}
```

(Add this to Phase 1 schema so it ships with the migration — recorded in §15.)

### 7.0.3 Matching algorithm (pseudo-code)

```ts
// recon-engine.service.ts
export async function runReconBatch(
  tx: Prisma.TransactionClient,
  lines: StatementLine[],
  sourceType: 'BANK_STATEMENT' | 'CARD_BATCH',
  sourceRef: string,
) {
  const settings = await getHotelSettings(tx);
  const dateWindowH = settings.autoClearDateWindowHours ?? 24;

  const results = { exact: 0, confidence: 0, suspicious: 0 };

  for (const line of lines) {
    // TIER 1: EXACT slipRefNo
    if (line.ref) {
      const p = await tx.payment.findFirst({
        where: { slipRefNo: line.ref, reconStatus: 'RECEIVED' },
        select: { id: true, amount: true },
      });
      if (p && Number(p.amount) === line.amount) {
        await markCleared(tx, p.id, 'SYSTEM_AUTO:EXACT', line.ref);
        await logAttempt(tx, { line, sourceType, sourceRef, matchedPaymentId: p.id, matchTier: 'EXACT' });
        results.exact++; continue;
      }
    }

    // TIER 2: CONFIDENCE (amount + date window + account, unambiguous)
    const candidates = await tx.payment.findMany({
      where: {
        reconStatus: 'RECEIVED',
        amount: line.amount,
        receivingAccountId: line.receivingAccountId ?? undefined,
        paymentDate: {
          gte: subHours(line.statementDate, dateWindowH),
          lte: addHours(line.statementDate, dateWindowH),
        },
      },
      select: { id: true },
    });
    if (candidates.length === 1) {
      await markCleared(tx, candidates[0].id, 'SYSTEM_AUTO:CONFIDENCE', line.ref);
      await logAttempt(tx, { line, sourceType, sourceRef, matchedPaymentId: candidates[0].id, matchTier: 'CONFIDENCE' });
      results.confidence++; continue;
    }

    // TIER 3: SUSPICIOUS (queue for review)
    await logAttempt(tx, {
      line, sourceType, sourceRef,
      matchedPaymentId: null,
      matchTier: 'SUSPICIOUS',
      reason: candidates.length > 1
        ? `AMBIGUOUS:${candidates.length} candidates`
        : 'NO_CANDIDATE_IN_WINDOW',
    });
    results.suspicious++;
  }

  return results;
}
```

### 7.0.4 Safeguards

| Safeguard | Implementation |
|---|---|
| **Undo auto-clear** | `PATCH /api/recon/clear/[paymentId]` → reset to RECEIVED + audit log |
| **Threshold config** | `HotelSettings.autoClearDateWindowHours` (default 24) |
| **Ambiguity guard** | Only auto-clear when exactly 1 candidate matches (2+ = SUSPICIOUS) |
| **No auto-clear on personal account** | `receivingAccount.ownerType === 'PERSONAL'` → force manual review |
| **Complete audit trail** | Every attempt logged in `ReconAttempt` whether matched or not |

### 7.0.5 Acceptance tests

- [ ] 100 statement lines with exact slipRef → all CLEARED, 0 SUSPICIOUS
- [ ] Line with 2 matching Payments (same amount, same day, same account) → SUSPICIOUS, no auto-clear
- [ ] Line matching payment on PERSONAL account → SUSPICIOUS even if amount/date exact
- [ ] Threshold = 12h; payment 18h off → no match → SUSPICIOUS
- [ ] Undo: mark payment CLEARED via auto → PATCH revert → status=RECEIVED, audit shows both actions
- [ ] Re-run recon on same statement → idempotent (ReconAttempt dedupe on `(sourceRef, statementLineRef)`)

## 7.1 Sub-modules

### 7.1.1 Bank statement import
- `POST /api/recon/bank-statement/import` (multipart CSV)
- Parser: auto-detect BBL/KBank CSV format
- Match key: `amount` exact + `referenceNo OR slipRefNo` match + `date ±1 day`
- UI: list unmatched lines → manual match / adjustment

### 7.1.2 Card settlement import
- `POST /api/recon/card-batch/import` (per-acquirer CSV/Excel)
- Match against Payment where `terminalId` + `batchNo` match
- Compute net settlement per batch

### 7.1.3 MDR fee allocation
- `POST /api/recon/allocate-fees` — trigger monthly
- Logic:
  ```
  FOR EACH card Payment in period WHERE reconStatus=CLEARED:
    fee = lookupFeeRate(terminalId, brand, cardType) × amount
    post LedgerEntry:
      DR CardFeeExpense[acquirer]
      CR CardClearing[acquirer]
    update Payment.feeAmount
  ```

### 7.1.4 Fee lookup fallback (3 levels)
1. `(terminalId, brand, cardType)` — exact
2. `(terminalId, brand, null)` — terminal+brand
3. `(null, brand, cardType)` — global brand+type
4. `(null, brand, null)` — global default

## 7.2 Deliverables

- `src/services/recon/recon-engine.service.ts` **← core auto-match (§7.0)**
- `src/services/recon/bankStatement.service.ts` (calls recon-engine)
- `src/services/recon/cardBatch.service.ts` (calls recon-engine)
- `src/services/recon/feeAllocation.service.ts`
- `src/app/(dashboard)/accounting/recon/page.tsx`
- `src/app/(dashboard)/accounting/recon/suspicious/page.tsx` **← manual review queue**
- `src/app/api/recon/bank-statement/import/route.ts`
- `src/app/api/recon/card-batch/import/route.ts`
- `src/app/api/recon/allocate-fees/route.ts`
- `src/app/api/recon/clear/[paymentId]/route.ts` **← undo auto-clear (PATCH)**

## 7.3 Acceptance tests

- [ ] Import statement with 50 lines → 47 auto-matched, 3 for manual
- [ ] Run fee allocation for April → correct MDR posted per brand
- [ ] Fallback to default rate when no specific rate exists
- [ ] Re-run allocation → idempotent (doesn't double-post)

---

# Phase 8 — e-Tax Export 🔵 (Future)

**Goal:** Export TaxInvoice records ในรูปแบบที่ one.th (หรือผู้ให้บริการ e-Tax Invoice) รับได้
**Est:** 4h
**Depends on:** Phase 6

## 8.1 Scope

- `GET /api/tax-invoices/export?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|xml`
- CSV: columns per one.th template
- XML: มาตรฐานกรมสรรพากร e-Tax Invoice format (ETDA xsd)

## 8.2 Note

Design ของ TaxInvoice ใน Phase 1 มี field ครบแล้ว → Phase 8 เป็น serialization task เท่านั้น

---

# Phase 9 — Management Dashboard & Alerts 🟢

**Goal:** Management เห็น "เงินค้างท่อ" + KPI วันนี้/เดือนนี้ ทันทีโดยไม่ต้องไล่ query
**Est:** 6h
**Depends on:** Phase 7 (needs CLEARED state working + ReconAttempt data)
**Scope kept tight:** 1 page, 4 KPI cards, 1 stale-alert grid — ไม่ใช่ "management console"

## 9.1 Deliverables

**Files to create:**
- `src/app/(dashboard)/finance/dashboard/page.tsx` — main page
- `src/app/api/finance/dashboard/summary/route.ts` — aggregate API
- `src/components/finance/KpiStrip.tsx` — 4 KPI cards (reuse existing card style)
- `src/components/finance/StaleReconGrid.tsx` — alert table

**Dependencies:** GoogleSheetTable (มีอยู่แล้ว — CLAUDE.md §5 บังคับ)

## 9.2 KPI Cards (4 cards)

Use Prisma `groupBy` for performance — one query returns all totals.

| # | Metric | Calculation | Icon |
|---|---|---|---|
| 1 | **Today Revenue** | Sum Payment.amount today, grouped by method | TrendingUp |
| 2 | **MTD Revenue** | Sum Payment.amount this month | Calendar |
| 3 | **MTD Uncleared** | Sum Payment.amount WHERE reconStatus='RECEIVED' AND createdAt >= month-start | AlertCircle (warning) |
| 4 | **Stale Count** | Count Payment WHERE reconStatus='RECEIVED' AND createdAt < NOW()-3days | AlertTriangle (red) |

Each card: value + mini-trend vs last period + click-through to detail

## 9.3 Stale RECEIVED Alert Grid

### Filter rule
```ts
WHERE reconStatus = 'RECEIVED'
  AND createdAt < NOW() - INTERVAL '3 days'
  AND paymentMethod != 'cash'    // cash is immediately CLEARED, shouldn't appear
ORDER BY createdAt ASC  // oldest first
```

### Columns
| Column | Source | Format |
|---|---|---|
| เลขที่ | paymentNumber | — |
| วันที่รับ | paymentDate | `fmtDateTime` |
| วิธีชำระ | paymentMethod | badge |
| บัญชีที่รับ | receivingAccount.name | + PERSONAL ⚠️ badge if applicable |
| ยอด | amount | `fmtBaht` right-aligned |
| ผู้รับ | createdByUserId → user name | — |
| **ค้าง (วัน)** | `Math.floor((NOW - createdAt) / 86400000)` | **red bold if > 7 days** |
| หลักฐาน | slipImageUrl | eye icon → preview |
| Action | — | [ตรวจสอบ] button → recon page |

### Visual
- Row highlight: **red background** if `daysStale > 7`
- Uses `GoogleSheetTable` (filter/sort/search per CLAUDE.md §5)

## 9.4 API — `GET /api/finance/dashboard/summary`

- **Auth:** `finance.view_dashboard` permission
- **Output:**
  ```json
  {
    "kpi": {
      "todayRevenue":   { "total": 58200, "byMethod": { "cash": 12000, "transfer": 24000, "promptpay": 8200, "credit_card": 14000 } },
      "mtdRevenue":     { "total": 1245600, "previousMonth": 1100000, "trend": "+13.2%" },
      "mtdUncleared":   { "total": 85400, "count": 12 },
      "staleCount":     { "count": 4, "oldestDays": 9 }
    },
    "staleList": [
      {
        "id": "...", "paymentNumber": "PAY-2026-00234",
        "paymentDate": "2026-04-13T10:30:00", "paymentMethod": "transfer",
        "receivingAccountName": "BBL บริษัท", "receivingAccountOwner": "COMPANY",
        "amount": 12500, "createdByName": "สมชาย", "daysStale": 9,
        "slipImageUrl": "/uploads/..."
      },
      /* top 20 */
    ]
  }
  ```

- **Caching:** Response cached 60 seconds (finance dashboard doesn't need real-time)

## 9.5 Acceptance tests

- [ ] KPI cards show correct groupBy totals (spot-check 3 payments)
- [ ] Stale grid filters correctly (cash never appears; only non-cash > 3 days)
- [ ] Red highlight triggers at exactly daysStale > 7
- [ ] Filter/sort/search works via GoogleSheetTable (per CLAUDE.md §5)
- [ ] PERSONAL account badge shown correctly
- [ ] Click "ตรวจสอบ" navigates to recon page with payment pre-selected
- [ ] User without `finance.view_dashboard` permission → 403

---

## 17. Outstanding / Open Questions

### ต้องยืนยันก่อนเริ่ม Phase 1 (ไม่บล็อก)

| # | Question | ผลกระทบ | Default ที่จะใช้ |
|---|---|---|---|
| Q1 | ชื่อ/เลขบัญชีธนาคารจริงของบริษัท (BBL, KBank) | Seed data | ใช้ placeholder ใน seed ให้แก้ได้ใน `/settings/accounts` |
| Q2 | `merchantId` ของเครื่อง EDC 2 เครื่อง | Optional field | null เริ่มต้น — แก้ได้ใน UI |
| Q3 | MDR rate ตามสัญญาจริง | Accuracy | ใช้ industry average (Visa 1.75% · Amex 3.00%) |
| Q4 | HotelSettings มี field ผู้ขาย (tax ID, address) หรือยัง | Tax invoice print | ถ้าไม่มี — เพิ่ม field ใน HotelSettings แยก (ไม่กระทบแผน) |

### Outstanding items ที่ยังไม่อยู่ในเฟส (future work)

- **WHT 50 ทวิ** — Sprint 6+ (D7)
- **e-Tax Invoice submit API** — ต่อจาก Phase 8, ใช้เมื่อผูก one.th
- **EXIF stripping on slip upload** — ต้องการ `sharp` dep — Phase 2.5 future
- **S3 storage migration** — เมื่อ traffic เยอะ — swap `local-storage.ts` → `s3-storage.ts`
- **Slip verify API** — D1 — Sprint 6+
- **Chargeback/dispute tracking** — เมื่อเริ่มมีเคส (Phase 9+)

### Items จาก Sprint 4B ที่ยัง Open (minor)

_ณ วันที่เริ่ม Sprint 5: ไม่มี blocker — Sprint 4B ปิดจบและ data wipe clean แล้ว_

---

## 18. Handoff Checklist for New Session

### เมื่อเปิด session ใหม่:

- [ ] Context: paste `@Phase_I_Sprint5_Payment_Finance_v2_Plan.md` + `@CLAUDE.md`
- [ ] Specify model: **Opus Medium** หรือ **Sonnet High** (ผู้ใช้เลือก)
- [ ] Confirm: "เริ่ม Phase 1" หรือ phase อื่น
- [ ] Verify prerequisites:
  - [ ] `npm run db:wipe` → data clean (ถ้าต้องการเริ่มใหม่)
  - [ ] `npm run db:push && npm run db:generate` → schema synced
  - [ ] `npm run build` → baseline passes before any change
- [ ] Provide missing info (Q1-Q4 above) หรือใช้ default

### Handoff Prompt Template

```
คุณกำลังทำ Phase N ของ @Phase_I_Sprint5_Payment_Finance_v2_Plan.md

**Scope:** <copy "Deliverables" section from the phase>

**Constraints:**
  - Follow CLAUDE.md rules (Zod, transactions, select-only, fmt helpers)
  - No breaking changes to existing Payment records
  - Migration additive only: `prisma migrate dev --name <descriptive>`
  - ทุก payment path ต้อง route ผ่าน payment.service.ts

**Execution:**
  1. Read files listed under "Files to edit"
  2. Implement exactly the schema/APIs/UI specified
  3. Run `npm run build` — must pass
  4. Test acceptance criteria from "Acceptance tests"
  5. Report: files changed · migration name · deviations · next phase readiness

Start with Phase N.1 (schema/core), print the diff, wait for confirmation, then proceed.
```

### Per-phase ready-to-go commands

```bash
# Phase 1 (schema)
npx prisma migrate dev --name payment_v2_schema
npm run db:seed

# Phase 2 (upload)
mkdir -p public/uploads
echo "public/uploads/*" >> .gitignore
echo "!public/uploads/.gitkeep" >> .gitignore

# Phase 3-9 — see deliverables list per phase

# After every phase
npm run build
```

---

## 19. Known Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Migration failure on existing data | Blocks deployment | Phase 1 is additive only · all new fields nullable · migration tested on clean DB first |
| Concurrent TaxInvoice number allocation → duplicates | Revenue Department compliance issue | `SELECT FOR UPDATE` in transaction · allocate **last** before create · `@unique` constraint as safety net |
| Upload endpoint abuse (storage fill) | Disk full | 5MB per file cap · mime allow-list · future: rate limit per user |
| EXIF leaks location/personal data in slip images | Privacy | Phase 2.5 to add `sharp`-based EXIF strip (v2) |
| Personal bank account (D4) used as default → VAT/CIT issue | Tax risk | UI warning badge · exclude from `isDefault=true` by business rule · add server-side guard |
| Card brand mismatch with terminal (allowedBrands) | Bad data | Server validation in Phase 3 service layer |
| Running number gap from failed TI creation | Gap in sequence | Allocate number as last step; if create fails, allow retry (seq kept — document as "accountant marks number as VOID manually if ever left hanging") |
| Payment → Receipt vs TaxInvoice confusion | User error | UI copy clear: "ใบเสร็จ" vs "ใบกำกับภาษี" · TaxInvoice is a separate document, not just "another version" of receipt |
| Auto-match false positive (auto-CLEAR wrong Payment) | Ghost money marked paid | Ambiguity guard (only 1 candidate) · PERSONAL account force manual · full audit log · undo endpoint |
| QR scanner fires on normal typing | Spurious form fills | Speed threshold + min length (30+ chars) + user toggle off by default |
| Dashboard KPI groupBy slow on large data | UX lag | composite index `(reconStatus, createdAt)` from Phase 1 · 60s response cache · paginate stale list to top 20 |

---

## 📋 Summary for Stakeholders

**ภาพรวม:**
- Sprint 5 แก้ pain point การเงิน 6 ข้อ + ยกเครื่อง payment model ให้ได้มาตรฐานโรงแรม
- ใช้เวลา ~30 ชั่วโมง (5 วันทำงาน) แก้ P1-P5 หมด + **Quick Cashier Mode** (แคชเชียร์เร็ว 10×)
- อีก ~41 ชั่วโมงเพื่อ EDC batch + Tax invoice + **Auto-Match Engine** + Dashboard + e-Tax
- ไม่มี breaking change — migrate แบบ additive-only

**สิ่งที่ได้หลังจบ Sprint:**
- แคชเชียร์บันทึกรับเงินทุก method ได้ถูกต้อง · หลักฐานครบ
- **Quick Cashier Mode**: แคชเชียร์ยิง QR → ระบบ fill form อัตโนมัติ → Enter ส่ง (5-8 วินาที/รายการ)
- ปิดกะเห็นยอดทั้ง cash + non-cash แยกชัด
- EDC ปิด batch + เทียบ payment ได้อัตโนมัติ
- บัญชีออกใบกำกับภาษีตามมาตรฐานกรมสรรพากร
- **Auto-Match Engine**: บัญชี upload statement → ระบบ auto-CLEAR 90%+ โดยไม่ต้อง click · ส่วนที่น่าสงสัยเข้าคิว manual
- กระทบยอด bank/card statement + allocate MDR อัตโนมัติ
- **Management Dashboard**: เห็น "เงินค้างท่อ" + KPI วันนี้ทันที · alert สีแดงเมื่อค้างเกิน 7 วัน
- พร้อม export e-Tax เมื่อผูก one.th ในอนาคต

**สิ่งที่ยังไม่ทำในเฟสนี้ (documented & tracked):**
- Slip verification API (D1)
- WHT 50 ทวิ (D7)
- EXIF stripping
- S3 migration
- e-Tax Invoice submit API
- Chargeback tracking

---

_End of plan_
