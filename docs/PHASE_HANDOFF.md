# Phase Handoff — Receipt Standardization → Card Settlement → Phase 6 Cleanup

> **Branch:** `feat/receipt-standardization` (32 commits ahead of `feat/consolidation`)
> **Status:** All 5 phases + the entire Phase 6 cleanup pass complete + verified.
> **Last commit:** `3c5572c feat(card-batch): Phase 6.6 — VOID a closed/settled card batch`
> **Read this BEFORE** touching anything in `src/services/refund.service.ts`, `cardBatch.service.ts`, `guestCredit.service.ts`, or the cashier / billing / finance pages — they all interlock with the accounting model laid out here.

This document is the canonical source-of-truth for everything that happened between commits `dab7d09` (Phase 1 start) and `3c5572c` (Phase 6.6 end). Future agents must read sections **1 → 4** before making changes; section 5 documents what shipped in Phase 6.

---

## 1. Big picture — what changed

The branch started as a UI polish ("ใบเสร็จต้องดูเหมือนกันทุกหน้า") and turned into a full accounting redesign of the Folio + Payment + Refund + Card-batch lifecycle. The original receipts-are-different complaint exposed a chain of subledger-vs-GL inconsistencies that needed proper double-entry plumbing to fix.

| # | Phase | Headline | Key commits |
|---|---|---|---|
| 1 | **Receipt Standardization** | Persist 1 `FolioLineItem` per night (data-layer truth) so every receipt renders identically | `dab7d09`, `bc1478e` |
| 2 | **Cashier Recent Payments + Void** | DataTable on `/cashier` shift with per-row void; replaces "hunt the guest first" workflow | `be67185` |
| 3 | **Three-mode refund** | `cash` / `credit` / `split` modes; subledger now reconciles to GL via reversal allocations + partial invoice voids | `d479352` |
| 3.next | **Guest Credit consume + expire** | Apply credit on future invoices (FIFO); single + bulk expire to `FORFEITED_REVENUE` | `cd456ec` |
| 4 | **EDC picker everywhere** | `<CardTerminalPicker>` on every quick-pay form (booking, check-in, extend, checkout, folio, bill-tab) — mirrors `<ReceivingAccountPicker>` pattern | `b0a0f90` |
| 5 | **Card Settlement** | Bank deposit → `DR Bank + DR Card Fee / CR Card Clearing`; `Payment.reconStatus` flips `RECEIVED → CLEARED` | `3bc51d9` |
| 6.1 | **Cancel-after-checkin redesign** | Hardblock removed; cashier picks refund policy + 3-mode inline; server voids accruals via `partialVoidInvoice` + processes refund in one tx; checked-in cancels route the room to `cleaning` + auto-create the housekeeping task | `296a714` |
| 6.2/6.5 | **Inline refund picker on drag-resize + manager gate** | `ResizeConfirmDialog` shows the 3-mode picker when shortening; `/api/reservation` PATCH accepts `refundMode`/`refundMethod`/etc. and finalizes the refund in the same tx; the endpoint now requires `admin`/`manager` role | `0cb22e6` |
| 6.3/6.4 | **Guest Credit UI surfaces** | `/finance/guest-credits` list page (DataTable + per-row Expire + admin Bulk Forfeit modal), side panel on `/finance`, and a dedicated liability card on `/finance/money-overview` showing `2115-01` outstanding | `87609dd` |
| 6.6 | **Card Batch VOID** | New `voidBatch` service: CLOSED→VOIDED unstamps payments; SETTLED→VOIDED posts mirror reversal pairs (`DR Clearing / CR Bank + CR CardFee`) and flips `Payment.reconStatus` back to RECEIVED. Admin-only `POST /api/card-batches/[id]/void` + 🚫 button in BatchCloseTab | `3c5572c` |

All phases have ledger postings that produce a **trial balance that reconciles**. Five E2E harnesses verify this; do not regress these without re-running them.

---

## 2. Accounting model — invariants future code must preserve

### 2.1 Chart of accounts (seeded in `src/services/financialAccount.service.ts`)

| Code | Name | Kind | SubKind | Notes |
|---|---|---|---|---|
| 1110-01 | เงินสด-ลิ้นชักหลัก | ASSET | CASH | Default cash drawer |
| 1120-01 | ธนาคาร-บัญชีหลัก | ASSET | BANK | Default bank; `isDefault=true` controls `ReceivingAccountPicker` auto-select |
| 1131-01 | พักบัตรเครดิต | ASSET | CARD_CLEARING | Default; individual EDC terminals may override via `EdcTerminal.clearingAccountId` |
| 1140-01 | ลูกหนี้-แขกผู้เข้าพัก | ASSET | AR | |
| 2110-01 | เงินมัดจำลูกค้า | LIABILITY | DEPOSIT_LIABILITY | Security deposits (held until refund/forfeit) |
| **2115-01** | **เครดิตคงเหลือลูกค้า** | **LIABILITY** | **GUEST_CREDIT** | **Phase 3.next — refunds taken as credit** |
| 2130-01 | ภาษีขาย VAT output | LIABILITY | VAT_OUTPUT | |
| 4110-01 | รายได้ค่าห้องพัก | REVENUE | ROOM_REVENUE | |
| **4140-01** | **รายได้จากเครดิตหมดอายุ** | **REVENUE** | **FORFEITED_REVENUE** | **Phase 3.next — recognized when GuestCredit expires/is forfeited** |
| 5210-01 | ค่าธรรมเนียมบัตรเครดิต | EXPENSE | CARD_FEE | MDR fee at card-batch settlement |

`AccountSubKind` is the authoritative discriminator in reports — the legacy `LedgerAccount` enum is best-effort (e.g. there is no `CARD_CLEARING` enum value; card-clearing entries use `legacy=BANK` and rely on `financialAccount.subKind` to discriminate). **Any new report code must group by `financialAccount.subKind`, not by `ledgerEntry.account`.**

### 2.2 Mandatory invariants (every PR touching money paths must preserve)

1. **Folio.totalPayments == sum of ACTIVE PaymentAllocation amounts (including negative reversal rows).** Set by `recalculateFolioBalance` in `folio.service.ts:548`. A refund must produce a `kind='reversal'` allocation with negative `amount` — never just flip `Payment.status` to VOIDED, because the cash receipt was historical truth.
2. **Every `FolioLineItem` row created for a ROOM charge has `quantity=1` and a `periodEnd`.** Daily bookings go through `addNightlyRoomCharges` (one row per night). Monthly bookings use one row with `quantity=1` and `periodEnd=checkOut`.
3. **`PaymentAllocation` unique constraint is `[paymentId, invoiceId, kind]`** — not just `[paymentId, invoiceId]`. A single (payment, invoice) pair can have one `payment` row + one `reversal` row.
4. **Credit-card rud-bat DR and batch-settle CR must hit the SAME FinancialAccount.** Enforced via `EdcTerminal.clearingAccountId` resolution in `payment.service.ts` line ~178 and `cardBatch.service.ts:settleBatch`. Without this, the clearing balance carries a permanent variance.
5. **Refund of an invoiced charge runs `partialVoidInvoice` FIRST.** That posts `DR Revenue / CR AR` to reverse the original accrual. Refund processing then posts `DR AR / CR Cash|Bank` (Mode A) or `DR AR / CR GuestCreditLiability` (Mode B/C). Never DR Revenue directly at refund time — it would double-reverse revenue if voidInvoice already ran.
6. **`GuestCredit.remainingAmount` is decremented in the SAME tx as the allocation.** Otherwise FIFO consumption can double-spend the same credit across concurrent requests. `consumeGuestCredit` does this correctly; future credit-consuming code must follow.
7. **`CardBatchReport.status` lifecycle: `CLOSED → SETTLED` (or `VOIDED`).** Re-settling a SETTLED batch throws `BATCH_ALREADY_SETTLED`. Voiding a SETTLED batch needs a separate reversal flow (not yet built).

### 2.3 Ledger pairs by scenario (cheat sheet)

```
Booking pre-pay (cash):
  DR CASH      / CR AR       — payment received
  DR AR        / CR REVENUE  — invoice accrual (same tx)

Booking pre-pay (credit_card):
  DR CARD_CLEARING  / CR AR       — payment received (lands in 1131-0X per terminal)
  DR AR             / CR REVENUE  — invoice accrual

Refund mode=cash on a previously paid invoice:
  DR REVENUE / CR AR       — partialVoidInvoice
  DR AR      / CR CASH     — refund processed
  + PaymentAllocation kind='reversal' amount=-X
  + Payment.refundedAmount += X

Refund mode=credit:
  DR REVENUE / CR AR                      — partialVoidInvoice
  DR AR      / CR GUEST_CREDIT_LIABILITY  — issueGuestCredit
  + GuestCredit row created, status='active'

Apply guest credit to a new invoice:
  DR GUEST_CREDIT_LIABILITY / CR AR  — consumeGuestCredit (per credit, FIFO)
  + PaymentAllocation kind='credit' amount=+X (positive)
  + GuestCredit.remainingAmount -= X

Forfeit / expire credit:
  DR GUEST_CREDIT_LIABILITY / CR REVENUE (routed to 4140-01)

Card-batch bank settlement:
  DR BANK     / CR CARD_CLEARING  — net deposit
  DR CARD_FEE / CR CARD_CLEARING  — MDR fee
  + Payment.reconStatus RECEIVED→CLEARED for every payment in the batch
```

---

## 3. Schema additions on this branch (`prisma db push` applied)

```prisma
// Phase 3 — refund modes
enum RefundMode { cash credit split }
enum PaymentAllocationKind { payment reversal credit }
enum LedgerAccount {
  ... existing ...
  GUEST_CREDIT_LIABILITY  // Phase 3
}
enum AccountSubKind {
  ... existing ...
  GUEST_CREDIT          // Phase 3
  FORFEITED_REVENUE     // Phase 3.next
}

// Phase 5 — card settlement
enum CardBatchStatus { CLOSED SETTLED VOIDED }

// Phase 3 — refund record extensions
model RefundRecord {
  ... existing ...
  mode            RefundMode?
  cashAmount      Decimal?
  creditAmount    Decimal?
  guestCreditId   String?
  guestCredit     GuestCredit?  @relation(...)
  reversalAllocations PaymentAllocation[] @relation("RefundReversalAlloc")
}

// Phase 3 — running tally of how much of this payment has been reversed
model Payment {
  ... existing ...
  refundedAmount  Decimal @default(0)
}

// Phase 3 — discriminate allocations
model PaymentAllocation {
  ... existing ...
  kind            PaymentAllocationKind @default(payment)
  refundRecordId  String?
  guestCreditId   String?
  refundRecord    RefundRecord? @relation("RefundReversalAlloc", ...)
  guestCredit     GuestCredit?  @relation(...)
  // Changed unique constraint:
  @@unique([paymentId, invoiceId, kind])
}

// Phase 3.next — new model
model GuestCredit {
  id, creditNumber, guestId, bookingId
  amount, remainingAmount
  status: GuestCreditStatus // active | consumed | refunded_out | expired | revoked
  expiresAt
  ... + relations to RefundRecord + PaymentAllocation
}

// Phase 5 — card settlement extensions
model CardBatchReport {
  ... existing ...
  status              CardBatchStatus @default(CLOSED)
  bankDepositAmount   Decimal?
  feeAmount           Decimal?
  bankAccountId       String?  // FK → FinancialAccount
  bankReferenceNo     String?
  depositedAt         DateTime?
  settledByUserId     String?
  settledAt           DateTime?
}
```

**Migration status:** schema pushed via `prisma db push --accept-data-loss` on dev DB. **A formal `prisma migrate dev` is NOT run** because the existing migration history has a pre-existing P1014 issue with `refund_records` (unrelated to this work — see commit `dab7d09` body). Before deploying to staging/prod, that pre-existing issue must be resolved and a proper migration generated.

---

## 4. Verified flows — E2E test inventory

Run these on any DB with the seeded chart of accounts:

| Script | Coverage | Assertions |
|---|---|---|
| `scripts/e2e-receipt-std.ts` | Receipt-standardization paths (Phase 1) | ~14 |
| `scripts/_verify-shorten-void.ts` | Drag-shorten voids future-night rows correctly | ~6 |
| `scripts/_verify-booking-numbers.ts` | Booking-number generator tolerates malformed tail values | ~3 |
| **`scripts/e2e-guest-credit.ts`** | **Issue → consume → expire → bulk-expire (Phase 3.next)** | **22** |
| **`scripts/e2e-card-settlement.ts`** | **Rud-bat → close → bank settle (Phase 5)** | **24** |
| **`scripts/e2e-cancel-checkin.ts`** | **Cancel confirmed/checked-in + cash/credit/forfeit (Phase 6.1)** | **21** |
| **`scripts/e2e-card-batch-void.ts`** | **CLOSED→VOID + SETTLED→VOID with ledger reversal (Phase 6.6)** | **22** |

```powershell
# Run any harness:
npx tsx scripts/e2e-card-settlement.ts
```

Each script creates a **dedicated test guest** to avoid colliding with manually-created data; cleanup at the end deletes every row the test created and only leaves immutable ledger entries (audit trail by design).

---

## 5. Phase 6 — what shipped (was the cleanup backlog)

All six items originally tracked here as backlog landed on this branch. Each
sub-section now documents what to know about the implementation so the next
agent doesn't accidentally regress them.

### 5.1 Cancel-after-checkin redesign — ✅ shipped (`296a714`)

`/api/bookings/[id]` action=cancel no longer hardblocks `checked_in` bookings.
The cashier picks both refund **policy** (forfeit / full / partial) and refund
**mode** (cash / credit / split) in one dialog (`CancelBookingDialog.tsx`),
and the server:

1. Voids FolioLineItem rows newest-first totalling ≥ `refundAmount`
   (`partialVoidInvoice` per affected invoice + `voidCharge` for UNBILLED rows)
   so revenue accrual reverses BEFORE the cash leg lands.
2. Flips `booking.status='cancelled'`.
3. Transitions the room:
   - checked-in cancels → `occupied → cleaning` + auto-create the
     housekeeping checkout task (mirrors quick-checkout).
   - confirmed cancels → straight to `available`.
4. Optionally finalizes the refund: when `mode` is in the request body,
   the server calls `processRefund` in the same tx (cash refunds resolve
   the open cash session via `getActiveSessionForUser`). Omitting `mode`
   keeps the legacy PENDING-then-finish-at-/refunds flow.

E2E: `scripts/e2e-cancel-checkin.ts` (21 assertions, 4 scenarios).

### 5.2 Drag-shorten inline refund picker — ✅ shipped (`0cb22e6`)

`ResizeConfirmDialog.tsx` now embeds the same 3-mode picker whenever the
preview shows a refund (`preview.rateDiff < 0`). The picker forwards
`mode`/`method`/`cashAmount`/bank fields through `useDragBooking.handleConfirm`
into the PATCH body. `/api/reservation` PATCH schema accepts the new optional
fields and, when `refundMode` is supplied, calls `processRefund` in the same
tx (right after `createPendingRefund`). Omitting `refundMode` keeps the legacy
PENDING-then-finish-at-/refunds flow.

### 5.3 `/finance/guest-credits` list page — ✅ shipped (`87609dd`)

Dedicated page with status-chip filter, KPI strip (total active liability +
count), and a DataTable showing creditNumber / guest / origin booking / amount
/ remainingAmount / status / expiresAt / createdAt. Per-row 🛑 **Expire**
action (manager+) opens a modal that calls `POST /api/guest-credits/[id]/expire`
(posts `DR 2115-01 / CR 4140-01` for `remainingAmount`). Admin-only
**Bulk Forfeit** button opens a fiscal-close modal that collects `cutoffDate`
+ `reason` and calls `POST /api/guest-credits/bulk-expire`. A live "เครดิต
คงเหลือลูกค้า" side panel on `/finance` shows the count + total and links to
the page.

### 5.4 `/finance/money-overview` liability card — ✅ shipped (`87609dd`)

The money-overview page now fetches active GuestCredit rows alongside account
balances and renders a dedicated "ภาระคงค้างลูกค้า" card (account `2115-01`)
between the grand-total banner and the cash/bank groups. The card links to
`/finance/guest-credits` and is suppressed entirely when liability = 0.

### 5.5 Manager-only gate on `/api/reservation` PATCH — ✅ shipped (`0cb22e6`)

Endpoint rejects sessions whose role isn't `admin` or `manager` (403 — mirrors
`/api/payments/[id]/void` and `/api/refunds/[id]/process`). Drag-resize can
now trigger refunds + invoice voids, so front-desk cashiers must hand off to a
manager for date edits.

### 5.6 Card-batch VOID flow — ✅ shipped (`3c5572c`)

`voidBatch` (in `cardBatch.service.ts`) handles both states:

- **CLOSED → VOIDED:** no ledger movement (close never posted one).
  Payments get `batchNo` cleared so they can land in a new (corrected)
  batch.
- **SETTLED → VOIDED:** posts the mirror reversal pairs against the same
  `CardBatchReport` reference — `DR Card Clearing / CR Bank` for the net
  deposit and `DR Card Clearing / CR Card Fee` for the MDR fee. Then
  `Payment.reconStatus` flips `CLEARED → RECEIVED`, `clearedAt`/`clearedBy`
  clear, and `batchNo` clears.

`VOIDED` is terminal; re-voiding throws `BATCH_ALREADY_VOIDED`. Admin-only
`POST /api/card-batches/[id]/void` requires `reason` (5–500 chars). The
🚫 button in `BatchCloseTab` is gated by `session.user.role === 'admin'`.

E2E: `scripts/e2e-card-batch-void.ts` (22 assertions, 3 scenarios).

---

### Future ideas (NOT in scope, parking lot)

- **Cancellation fee on partial refund:** when policy=partial the refund and
  voided amount don't perfectly match (rounded up to whole nights). The
  residual ends up as retained revenue. A "cancellation_fee" charge type +
  ledger pair would model it explicitly.
- **Foreign-currency settlements:** Phase 5 assumes THB throughout.
- **DEPOSIT_LIABILITY card on money-overview:** Phase 6.4 only surfaced
  GUEST_CREDIT; deposit liabilities still hide in "other".
- **Multi-payment refund spread:** `processRefund` picks the single most
  recent ACTIVE payment to reverse against. If a booking has many split
  payments and refund > any one of them, the reversal allocation only hits
  one row.

---

## 6. Operational notes for the next agent

### 6.1 Resetting test data

The branch ships with a comprehensive clean-slate script:
```powershell
node scripts/clear-test-data.mjs
```
Wipes 25 transactional tables in one `TRUNCATE ... CASCADE`. Side effects:
- Snapshots + restores `cash_boxes` (`TRUNCATE cash_sessions CASCADE` would otherwise wipe them).
- Resets every room to `available`.
- Resets `number_sequences` so booking numbers start at 0001.
- Aborts when `NODE_ENV=production`.

After clearing, run these to re-seed:
```powershell
node scripts/seed-cash-boxes.mjs       # COUNTER-1, COUNTER-2
node scripts/set-default-bank.mjs       # 1120-01 isDefault → picker auto-select
node scripts/_seed-guest-credit.mjs     # 2115-01 — Phase 3.next
node scripts/_seed-forfeited.mjs        # 4140-01 — Phase 3.next
```

### 6.2 Don't trust `LedgerAccount` enum names for reports

The enum has no `CARD_CLEARING` value — credit-card clearing entries use `legacy=BANK` and rely on `financialAccount.subKind`. Same for `GUEST_CREDIT_LIABILITY` (enum exists, but legacy mapping makes the FinancialAccount the truth). Every report query should join through `FinancialAccount` and group by `subKind`.

### 6.3 Pre-existing TypeScript errors

`npx tsc --noEmit -p .` currently produces **15 pre-existing errors** in these unrelated files. None are introduced by this branch. Filter them out:
- `scripts/test-e2e.ts`
- `src/app/api/housekeeping/route.ts`
- `src/app/api/billing/migrate-folios/route.ts`
- `src/services/fiscalPeriod.service.ts`
- `src/services/folio.service.ts` line 345 (`mapInvoiceTypeCode` return type)
- `src/services/housekeeping.service.ts`

### 6.4 Branch state

```
Branch:        feat/receipt-standardization
Base:          feat/consolidation
Commits ahead: 32
Worktree:      clean
```

To merge to `main` safely:
1. Run all 5 E2E harnesses on a fresh clone — all must pass green.
2. Reconcile schema: the dev DB was advanced via `prisma db push`. Production migration must be generated formally via `prisma migrate dev --create-only` after resolving the pre-existing `refund_records` P1014 issue.
3. Seed the new FinancialAccounts (`2115-01`, `4140-01`) in production before any user can issue a credit refund.
4. Mark a default BANK account `isDefault=true` (run `scripts/set-default-bank.mjs` or do via UI) so the receiving-account picker auto-selects.

### 6.5 Smoke test checklist post-merge

1. `/cashier` → open shift → see new counters (`เงินสดคืน`, `เครดิตที่ออกให้`)
2. `/reservation` → create booking with credit-card pre-pay → EDC picker shows + auto-selects terminal
3. Refund flow: `/refunds` → "ดำเนินการ" → 3-mode picker visible + each mode produces correct ledger pair
4. `/billing/folio?bookingId=X` → if guest has credit, "🎫 ใช้ก่อน [฿]" appears in quick-pay panel
5. `/cashier` → EDC tab → close a batch → see "⏳ รอ settle" chip → click "🏦 บันทึกเงินเข้า" → settle → see ฿0 in Card Clearing on `/finance/money-overview`

---

## 7. Where to start reading code

| Goal | First file to read |
|---|---|
| Understand refund modes | `src/services/refund.service.ts` |
| Understand guest credit lifecycle | `src/services/guestCredit.service.ts` |
| Understand card settlement | `src/services/cardBatch.service.ts` (`settleBatch` function) |
| See how the cashier picks 3 modes | `src/app/(dashboard)/refunds/components/ProcessRefundModal.tsx` |
| See how credit applies on pay | `src/components/folio/FolioLedger.tsx` (apply-credit section) |
| See the bank settlement UI | `src/app/(dashboard)/cashier/components/BatchCloseTab.tsx` (settle modal at end) |
| See ledger postings rules | `src/services/ledger.service.ts` (`postLedgerPair`, `SUBKIND_FOR_LEGACY`) |
| See schema | `prisma/schema.prisma` — search `Phase 3` / `Phase 5` comments |

---

_End of handoff. Phase 6 shipped on 2026-05-11; update this file when a new phase opens._
