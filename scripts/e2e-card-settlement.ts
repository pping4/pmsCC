/**
 * Phase 5 — Card Settlement E2E
 *
 * Reproduces the full credit-card lifecycle end-to-end against the live
 * dev DB through the SAME service functions the API routes use, then
 * asserts every ledger pair the accounting principles require:
 *
 *   1. Cashier rud-bat: DR CARD_CLEARING / CR AR
 *   2. Batch close   : no ledger movement (just sanity check)
 *   3. Bank settle   : DR BANK + DR CARD_FEE / CR CARD_CLEARING
 *      Net ledger after all 3 steps:
 *        Bank        +9,700
 *        Card Fee    +  300
 *        AR          -10,000
 *
 *   npx tsx scripts/e2e-card-settlement.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { createPayment } from '../src/services/payment.service';
import { createBatch, settleBatch } from '../src/services/cardBatch.service';

const p = new PrismaClient();
const failures: string[] = [];
function expect(c: boolean, m: string) { if (c) console.log(`    ✓ ${m}`); else { console.log(`    ✗ ${m}`); failures.push(m); } }

/**
 * Aggregate ledger entries keyed by **subKind** (not the legacy
 * LedgerAccount enum). Reasoning: there is no CARD_CLEARING value in the
 * LedgerAccount enum — credit-card payments use legacy=BANK and rely on
 * financialAccount.subKind=CARD_CLEARING to discriminate. The actual
 * accounting truth lives in the FinancialAccount linkage.
 */
async function ledgerBySubKind(referenceType: string, referenceIds: string[]) {
  const entries = await p.ledgerEntry.findMany({
    where: { referenceType, referenceId: { in: referenceIds } },
    select: { type: true, account: true, amount: true, financialAccount: { select: { code: true, subKind: true } } },
  });
  const map: Record<string, { debit: number; credit: number; codes: string[] }> = {};
  for (const e of entries) {
    const key = e.financialAccount?.subKind ?? e.account;
    map[key] ??= { debit: 0, credit: 0, codes: [] };
    if (e.type === 'DEBIT')  map[key].debit  += Number(e.amount);
    if (e.type === 'CREDIT') map[key].credit += Number(e.amount);
    if (e.financialAccount?.code && !map[key].codes.includes(e.financialAccount.code)) {
      map[key].codes.push(e.financialAccount.code);
    }
  }
  return { map, count: entries.length };
}

async function main() {
  console.log('🧪  Card Settlement E2E\n');

  const room  = await p.room.findFirst({ where: { status: 'available' } });
  const admin = await p.user.findFirst({ where: { email: 'admin@pms.com' } });
  if (!room || !admin) { console.error('missing fixtures'); process.exit(1); }

  // Need an EDC terminal — create a temp one if none exists.
  let terminal = await p.edcTerminal.findFirst({ where: { isActive: true } });
  let tempTerminal = false;
  if (!terminal) {
    terminal = await p.edcTerminal.create({
      data: {
        code: `E2E-${Date.now().toString().slice(-6)}`,
        name: 'E2E Test Terminal', acquirerBank: 'BBL',
        allowedBrands: ['VISA', 'MASTER'], isActive: true,
      },
    });
    tempTerminal = true;
  }

  const tag = `e2e-card-${Math.random().toString(36).slice(2, 7)}`;
  console.log(`Tag: ${tag} · terminal: ${terminal.code}\n`);

  const guest = await p.guest.create({
    data: { firstName: `E2E-${tag.slice(-5)}`, lastName: 'Card', phone: '0000000000',
            nationality: 'Thai', idType: 'thai_id', idNumber: `9999${Date.now().toString().slice(-9)}` },
  });

  const created = {
    paymentIds: [] as string[], invoiceIds: [] as string[],
    folioIds: [] as string[], bookingIds: [] as string[],
    batchIds: [] as string[],
  };

  try {
    // ─── Setup: booking + invoice ────────────────────────────────────────
    const num = String(Math.floor(Math.random() * 9000) + 1000).padStart(4, '0');
    const setup = await p.$transaction(async (tx) => {
      const booking = await tx.booking.create({
        data: {
          bookingNumber: `BK-2026-${num}`, guestId: guest.id, roomId: room.id,
          bookingType: 'daily', status: 'checked_in', source: 'direct',
          checkIn: new Date('2026-11-01'), checkOut: new Date('2026-11-02'),
          rate: new Prisma.Decimal(10000),
        },
      });
      const folio = await tx.folio.create({
        data: {
          folioNumber: `FLO-2026-${num}`, bookingId: booking.id, guestId: guest.id,
          totalCharges: new Prisma.Decimal(10000), totalPayments: 0, balance: new Prisma.Decimal(10000),
        },
      });
      const item = await tx.folioLineItem.create({
        data: {
          folioId: folio.id, chargeType: 'ROOM',
          description: 'E2E room', amount: new Prisma.Decimal(10000),
          quantity: 1, unitPrice: new Prisma.Decimal(10000),
          taxType: 'no_tax', billingStatus: 'BILLED',
          serviceDate: new Date('2026-11-01'), periodEnd: new Date('2026-11-02'),
          createdBy: admin.id,
        },
      });
      const inv = await tx.invoice.create({
        data: {
          invoiceNumber: `INV-CI-2026-${num}`, bookingId: booking.id, guestId: guest.id, folioId: folio.id,
          issueDate: new Date(), dueDate: new Date('2026-11-02'),
          invoiceType: 'daily_stay',
          subtotal: new Prisma.Decimal(10000), grandTotal: new Prisma.Decimal(10000),
          paidAmount: 0, status: 'unpaid',
          items: { create: [{ description: item.description, amount: new Prisma.Decimal(10000), folioLineItemId: item.id, taxType: 'no_tax' }] },
        },
      });
      return { bookingId: booking.id, folioId: folio.id, invoiceId: inv.id };
    });
    Object.assign(created, {
      bookingIds: [setup.bookingId],
      folioIds:   [setup.folioId],
      invoiceIds: [setup.invoiceId],
    });

    // ─── 1. Customer pays by credit card ─────────────────────────────────
    console.log('1️⃣   Rud-bat ฿10,000 — VISA credit card');
    const pay = await p.$transaction((tx) => createPayment(tx, {
      idempotencyKey: `${tag}-pay`, guestId: guest.id, bookingId: setup.bookingId,
      amount: 10000, paymentMethod: 'credit_card', paymentDate: new Date(),
      receivedBy: admin.id, createdBy: admin.id,
      allocations: [{ invoiceId: setup.invoiceId, amount: 10000 }],
      terminalId: terminal.id, cardBrand: 'VISA' as never,
      cardType: 'NORMAL' as never, cardLast4: '1234', authCode: '123456',
    }));
    created.paymentIds.push(pay.id);

    const payLedger = await ledgerBySubKind('Payment', [pay.id]);
    expect(payLedger.count === 2, '2 ledger entries from rud-bat');
    expect(payLedger.map.CARD_CLEARING?.debit === 10000, `DR CARD_CLEARING 10000 (got ${JSON.stringify(payLedger.map.CARD_CLEARING)})`);
    expect(payLedger.map.AR?.credit === 10000, 'CR AR 10000');
    const payClearingCode = payLedger.map.CARD_CLEARING?.codes[0];

    const payRow = await p.payment.findUnique({ where: { id: pay.id }, select: { reconStatus: true, batchNo: true } });
    expect(payRow?.reconStatus === 'RECEIVED', `reconStatus = RECEIVED (got ${payRow?.reconStatus})`);
    expect(payRow?.batchNo === null, 'batchNo not yet assigned');
    console.log('');

    // ─── 2. Cashier closes the batch at end of day ──────────────────────
    console.log('2️⃣   Close batch (EDC ฿10,000)');
    const batchResult = await p.$transaction((tx) => createBatch(tx, {
      terminalId: terminal.id, batchNo: `${tag}-B1`,
      closeDate: new Date(), edcTotalAmount: 10000, edcTxCount: 1,
      closedByUserId: admin.id,
    }));
    created.batchIds.push(batchResult.batch.id);
    expect(batchResult.variance.ok, `variance OK (got ${batchResult.variance.amount})`);

    const batchLedger = await ledgerBySubKind('CardBatchReport', [batchResult.batch.id]);
    expect(batchLedger.count === 0, 'batch close posts NO ledger (just sanity-checks)');

    const payRow2 = await p.payment.findUnique({ where: { id: pay.id }, select: { batchNo: true, reconStatus: true } });
    expect(payRow2?.batchNo === `${tag}-B1`, `payment.batchNo stamped (got ${payRow2?.batchNo})`);
    expect(payRow2?.reconStatus === 'RECEIVED', 'reconStatus still RECEIVED after batch close');
    console.log('');

    // ─── 3. Bank settles T+1 — deposits ฿9,700 (MDR 3%) ─────────────────
    console.log('3️⃣   Bank settles ฿9,700 (฿300 MDR)');
    const settleResult = await p.$transaction((tx) => settleBatch(tx, {
      batchId: batchResult.batch.id,
      bankDepositAmount: 9700,
      depositedAt: new Date(),
      bankReferenceNo: `${tag}-DEP`,
      settledByUserId: admin.id,
    }));
    expect(settleResult.netDeposit === 9700, `net deposit = 9700`);
    expect(settleResult.fee === 300, `fee = 300`);
    expect(settleResult.clearedCount === 1, `1 payment cleared (got ${settleResult.clearedCount})`);

    // Ledger assertions: DR BANK 9700 + DR CARD_FEE 300 / CR CARD_CLEARING 10000
    const settleLedger = await ledgerBySubKind('CardBatchReport', [batchResult.batch.id]);
    expect(settleLedger.count === 4, `4 ledger entries from settle (got ${settleLedger.count})`);
    // The settle DR Bank gets subKind=BANK from financialAccount; if FK
    // resolution failed (financialAccount=null), it falls back to legacy
    // enum key. Accept either.
    const bankDebit = (settleLedger.map.BANK?.debit ?? 0);
    expect(bankDebit === 9700, `DR BANK 9700 (got ${bankDebit})`);
    expect(settleLedger.map.CARD_FEE?.debit === 300, `DR CARD_FEE 300 (got ${JSON.stringify(settleLedger.map.CARD_FEE)})`);
    expect(settleLedger.map.CARD_CLEARING?.credit === 10000,
      `CR CARD_CLEARING 10000 total (got ${JSON.stringify(settleLedger.map.CARD_CLEARING)})`);
    // Critical: the same clearing account that rud-bat DR'd is the one
    // that settle CR's — otherwise the clearing balance never zeros.
    expect(payClearingCode && settleLedger.map.CARD_CLEARING?.codes.includes(payClearingCode),
      `rud-bat DR ${payClearingCode} matches settle CR codes ${settleLedger.map.CARD_CLEARING?.codes.join(',')}`);

    // The Expense entry must route to subKind=CARD_FEE (5210-01), NOT
    // default OTHER_EXPENSE.
    const feeEntry = await p.ledgerEntry.findFirst({
      where: { referenceType: 'CardBatchReport', referenceId: batchResult.batch.id, account: 'EXPENSE' },
      select: { financialAccount: { select: { code: true, subKind: true } } },
    });
    expect(feeEntry?.financialAccount?.subKind === 'CARD_FEE',
      `Fee entry → CARD_FEE subKind (got ${feeEntry?.financialAccount?.subKind})`);
    expect(feeEntry?.financialAccount?.code === '5210-01',
      `Fee entry → 5210-01 (got ${feeEntry?.financialAccount?.code})`);

    // Payment status flipped to CLEARED
    const payRow3 = await p.payment.findUnique({
      where: { id: pay.id }, select: { reconStatus: true, clearedAt: true, clearedBy: true },
    });
    expect(payRow3?.reconStatus === 'CLEARED', `reconStatus → CLEARED (got ${payRow3?.reconStatus})`);
    expect(!!payRow3?.clearedAt, 'clearedAt timestamp set');

    // Batch row updated
    const batchRow = await p.cardBatchReport.findUnique({
      where: { id: batchResult.batch.id },
      select: { status: true, bankDepositAmount: true, feeAmount: true, depositedAt: true },
    });
    expect(batchRow?.status === 'SETTLED', `batch status = SETTLED`);
    expect(Number(batchRow?.bankDepositAmount) === 9700, 'bankDepositAmount stored');
    expect(Number(batchRow?.feeAmount) === 300, 'feeAmount stored');
    console.log('');

    // ─── 4. Try to settle again — should fail ────────────────────────────
    console.log('4️⃣   Re-settle attempt is rejected');
    try {
      await p.$transaction((tx) => settleBatch(tx, {
        batchId: batchResult.batch.id, bankDepositAmount: 9700,
        depositedAt: new Date(), settledByUserId: admin.id,
      }));
      expect(false, 'second settle SHOULD throw');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      expect(msg === 'BATCH_ALREADY_SETTLED', `rejected with BATCH_ALREADY_SETTLED (got ${msg})`);
    }
    console.log('');

  } finally {
    console.log('🧹  Cleanup');
    if (created.invoiceIds.length) {
      await p.paymentAllocation.deleteMany({ where: { invoiceId: { in: created.invoiceIds } } });
      await p.invoiceItem.deleteMany({ where: { invoiceId: { in: created.invoiceIds } } });
      await p.invoice.deleteMany({ where: { id: { in: created.invoiceIds } } });
    }
    if (created.paymentIds.length) {
      await p.payment.deleteMany({ where: { id: { in: created.paymentIds } } });
    }
    if (created.folioIds.length) {
      await p.folioLineItem.deleteMany({ where: { folioId: { in: created.folioIds } } });
      await p.folio.deleteMany({ where: { id: { in: created.folioIds } } });
    }
    if (created.bookingIds.length) {
      await p.booking.deleteMany({ where: { id: { in: created.bookingIds } } });
    }
    if (created.batchIds.length) {
      await p.cardBatchReport.deleteMany({ where: { id: { in: created.batchIds } } });
    }
    await p.guest.delete({ where: { id: guest.id } }).catch(() => {});
    if (tempTerminal && terminal) {
      await p.edcTerminal.delete({ where: { id: terminal.id } }).catch(() => {});
    }
    console.log('   done.\n');
  }

  if (failures.length === 0) console.log('🎉  ALL ASSERTIONS PASSED');
  else {
    console.log(`❌  ${failures.length} FAILED:`);
    failures.forEach((f) => console.log(`   - ${f}`));
    process.exitCode = 1;
  }
  await p.$disconnect();
}

main().catch(async (e) => { console.error('\n💥', e); await p.$disconnect(); process.exitCode = 2; });
