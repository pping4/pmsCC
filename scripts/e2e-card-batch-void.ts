/**
 * Phase 6.6 — Card Batch VOID E2E
 *
 * Exercises voidBatch() for the two scenarios:
 *   1. CLOSED → VOIDED: no ledger movement, payments unstamped.
 *   2. SETTLED → VOIDED: ledger reversal pairs posted, payments cleared+unstamped.
 *   3. Cannot void an already-VOIDED batch.
 *
 *   npx tsx scripts/e2e-card-batch-void.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { createPayment } from '../src/services/payment.service';
import { createBatch, settleBatch, voidBatch } from '../src/services/cardBatch.service';

const p = new PrismaClient();
const failures: string[] = [];
function expect(c: boolean, m: string) {
  if (c) console.log(`    ✓ ${m}`);
  else   { console.log(`    ✗ ${m}`); failures.push(m); }
}

async function ledgerBySubKind(referenceType: string, referenceIds: string[]) {
  const entries = await p.ledgerEntry.findMany({
    where: { referenceType, referenceId: { in: referenceIds } },
    select: { type: true, account: true, amount: true, financialAccount: { select: { code: true, subKind: true } } },
  });
  const map: Record<string, { debit: number; credit: number }> = {};
  for (const e of entries) {
    const key = e.financialAccount?.subKind ?? e.account;
    map[key] ??= { debit: 0, credit: 0 };
    if (e.type === 'DEBIT')  map[key].debit  += Number(e.amount);
    if (e.type === 'CREDIT') map[key].credit += Number(e.amount);
  }
  return { map, count: entries.length };
}

async function main() {
  console.log('🧪  Card Batch VOID E2E\n');

  const room  = await p.room.findFirst({ where: { status: 'available' } });
  const admin = await p.user.findFirst({ where: { email: 'admin@pms.com' } });
  if (!room || !admin) { console.error('missing fixtures'); process.exit(1); }

  let terminal = await p.edcTerminal.findFirst({ where: { isActive: true } });
  let tempTerminal = false;
  if (!terminal) {
    terminal = await p.edcTerminal.create({
      data: {
        code: `E2E-V${Date.now().toString().slice(-5)}`,
        name: 'E2E Void Terminal', acquirerBank: 'BBL',
        allowedBrands: ['VISA', 'MASTER'], isActive: true,
      },
    });
    tempTerminal = true;
  }

  const tag = `e2e-void-${Math.random().toString(36).slice(2, 6)}`;
  console.log(`Tag: ${tag} · terminal: ${terminal.code}\n`);

  const guest = await p.guest.create({
    data: { firstName: `E2E-${tag.slice(-4)}`, lastName: 'Void', phone: '0000000000',
            nationality: 'Thai', idType: 'thai_id', idNumber: `7777${Date.now().toString().slice(-9)}` },
  });

  const allBookings: string[] = [];
  const allPayments: string[] = [];
  const allInvoices: string[] = [];
  const allFolios: string[]   = [];
  const allBatches: string[]  = [];

  async function setupFixture(amount: number, suffix: string) {
    return p.$transaction(async (tx) => {
      const num = `${suffix}-${Math.random().toString(36).slice(2, 5)}`;
      const booking = await tx.booking.create({
        data: {
          bookingNumber: `BK-${tag}-${num}`, guestId: guest.id, roomId: room!.id,
          bookingType: 'daily', status: 'checked_in', source: 'direct',
          checkIn: new Date('2026-12-01'), checkOut: new Date('2026-12-02'),
          rate: new Prisma.Decimal(amount),
        },
      });
      const folio = await tx.folio.create({
        data: {
          folioNumber: `FLO-${tag}-${num}`, bookingId: booking.id, guestId: guest.id,
          totalCharges: new Prisma.Decimal(amount), totalPayments: 0, balance: new Prisma.Decimal(amount),
        },
      });
      const item = await tx.folioLineItem.create({
        data: {
          folioId: folio.id, chargeType: 'ROOM',
          description: 'E2E room', amount: new Prisma.Decimal(amount),
          quantity: 1, unitPrice: new Prisma.Decimal(amount),
          taxType: 'no_tax', billingStatus: 'BILLED',
          serviceDate: new Date('2026-12-01'), periodEnd: new Date('2026-12-02'),
          createdBy: admin!.id,
        },
      });
      const inv = await tx.invoice.create({
        data: {
          invoiceNumber: `INV-${tag}-${num}`, bookingId: booking.id, guestId: guest.id, folioId: folio.id,
          issueDate: new Date(), dueDate: new Date('2026-12-02'),
          invoiceType: 'daily_stay',
          subtotal: new Prisma.Decimal(amount), grandTotal: new Prisma.Decimal(amount),
          paidAmount: 0, status: 'unpaid',
          items: { create: [{ description: item.description, amount: new Prisma.Decimal(amount), folioLineItemId: item.id, taxType: 'no_tax' }] },
        },
      });
      return { booking, folio, inv };
    });
  }

  try {
    // ─── Scenario 1: CLOSED batch → VOID ─────────────────────────────────
    console.log('1️⃣   CLOSED batch → VOID (no ledger movement)');
    const f1 = await setupFixture(5000, 'cl');
    allBookings.push(f1.booking.id); allFolios.push(f1.folio.id); allInvoices.push(f1.inv.id);

    const pay1 = await p.$transaction((tx) => createPayment(tx, {
      idempotencyKey: `${tag}-p1`, guestId: guest.id, bookingId: f1.booking.id,
      amount: 5000, paymentMethod: 'credit_card', paymentDate: new Date(),
      receivedBy: admin.id, createdBy: admin.id,
      allocations: [{ invoiceId: f1.inv.id, amount: 5000 }],
      terminalId: terminal.id, cardBrand: 'VISA' as never,
      cardType: 'NORMAL' as never, cardLast4: '0001', authCode: '000001',
    }));
    allPayments.push(pay1.id);

    const closed1 = await p.$transaction((tx) => createBatch(tx, {
      terminalId: terminal.id, batchNo: `${tag}-B1`,
      closeDate: new Date(), edcTotalAmount: 5000, edcTxCount: 1,
      closedByUserId: admin.id,
    }));
    allBatches.push(closed1.batch.id);

    const payAfterClose = await p.payment.findUniqueOrThrow({ where: { id: pay1.id }, select: { batchNo: true, reconStatus: true } });
    expect(payAfterClose.batchNo === `${tag}-B1`, `payment.batchNo stamped (got ${payAfterClose.batchNo})`);

    const void1 = await p.$transaction((tx) => voidBatch(tx, {
      batchId: closed1.batch.id, reason: 'E2E test — CLOSED void', voidedByUserId: admin.id,
    }));
    expect(void1.reversedLedger === false, 'reversedLedger=false for CLOSED→VOID');
    expect(void1.unstampedCount === 1, `1 payment unstamped (got ${void1.unstampedCount})`);
    expect(void1.resetReconCount === 0, 'no reconStatus flipped (was never CLEARED)');

    const payAfterVoid1 = await p.payment.findUniqueOrThrow({ where: { id: pay1.id }, select: { batchNo: true, reconStatus: true } });
    expect(payAfterVoid1.batchNo === null, `batchNo cleared (got ${payAfterVoid1.batchNo})`);
    expect(payAfterVoid1.reconStatus === 'RECEIVED', `reconStatus still RECEIVED (got ${payAfterVoid1.reconStatus})`);

    const batch1Row = await p.cardBatchReport.findUniqueOrThrow({ where: { id: closed1.batch.id }, select: { status: true } });
    expect(batch1Row.status === ('VOIDED' as never), `batch status = VOIDED (got ${batch1Row.status})`);

    // No ledger entries should exist against this batch (close never posts)
    const lg1 = await ledgerBySubKind('CardBatchReport', [closed1.batch.id]);
    expect(lg1.count === 0, `no ledger movement (got ${lg1.count} entries)`);
    console.log('');

    // ─── Scenario 2: SETTLED batch → VOID (ledger reversal) ──────────────
    // Use a different close-date than scenario 1 so the previously-voided
    // (now-unbatched) scenario-1 payment doesn't get re-picked-up.
    console.log('2️⃣   SETTLED batch → VOID (reverse both pairs)');
    const f2 = await setupFixture(10000, 'st');
    allBookings.push(f2.booking.id); allFolios.push(f2.folio.id); allInvoices.push(f2.inv.id);

    const scenario2Date = new Date();
    scenario2Date.setDate(scenario2Date.getDate() + 1);   // tomorrow

    const pay2 = await p.$transaction((tx) => createPayment(tx, {
      idempotencyKey: `${tag}-p2`, guestId: guest.id, bookingId: f2.booking.id,
      amount: 10000, paymentMethod: 'credit_card', paymentDate: scenario2Date,
      receivedBy: admin.id, createdBy: admin.id,
      allocations: [{ invoiceId: f2.inv.id, amount: 10000 }],
      terminalId: terminal.id, cardBrand: 'VISA' as never,
      cardType: 'NORMAL' as never, cardLast4: '0002', authCode: '000002',
    }));
    allPayments.push(pay2.id);

    const closed2 = await p.$transaction((tx) => createBatch(tx, {
      terminalId: terminal.id, batchNo: `${tag}-B2`,
      closeDate: scenario2Date, edcTotalAmount: 10000, edcTxCount: 1,
      closedByUserId: admin.id,
    }));
    allBatches.push(closed2.batch.id);

    // Settle with 3% MDR
    const settle2 = await p.$transaction((tx) => settleBatch(tx, {
      batchId: closed2.batch.id, bankDepositAmount: 9700, depositedAt: new Date(),
      bankReferenceNo: `${tag}-DEP2`, settledByUserId: admin.id,
    }));
    expect(settle2.fee === 300, 'fee = 300 after settle');

    const payAfterSettle = await p.payment.findUniqueOrThrow({ where: { id: pay2.id }, select: { reconStatus: true } });
    expect(payAfterSettle.reconStatus === 'CLEARED', 'payment CLEARED after settle');

    // Now VOID
    const void2 = await p.$transaction((tx) => voidBatch(tx, {
      batchId: closed2.batch.id, reason: 'E2E test — SETTLED void', voidedByUserId: admin.id,
    }));
    expect(void2.reversedLedger === true, 'reversedLedger=true for SETTLED→VOID');
    expect(void2.netDeposit === 9700, `net reversed = 9700`);
    expect(void2.fee === 300, `fee reversed = 300`);
    expect(void2.unstampedCount === 1, `1 payment unstamped (got ${void2.unstampedCount})`);
    expect(void2.resetReconCount === 1, `1 payment reconStatus reset (got ${void2.resetReconCount})`);

    const payAfterVoid2 = await p.payment.findUniqueOrThrow({ where: { id: pay2.id }, select: { batchNo: true, reconStatus: true, clearedAt: true } });
    expect(payAfterVoid2.batchNo === null, `batchNo cleared (got ${payAfterVoid2.batchNo})`);
    expect(payAfterVoid2.reconStatus === 'RECEIVED', `reconStatus → RECEIVED (got ${payAfterVoid2.reconStatus})`);
    expect(payAfterVoid2.clearedAt === null, 'clearedAt cleared');

    // Net ledger: settle posted (CR Clearing 10000, DR Bank 9700, DR Fee 300).
    // Void posted mirror pairs (DR Clearing 10000, CR Bank 9700, CR Fee 300).
    // Total per subKind should net to 0 for this batch reference.
    const lg2 = await ledgerBySubKind('CardBatchReport', [closed2.batch.id]);
    expect(lg2.count === 8, `8 ledger entries total (settle 4 + void 4) — got ${lg2.count}`);
    const bankNet = (lg2.map.BANK?.debit ?? 0) - (lg2.map.BANK?.credit ?? 0);
    expect(Math.abs(bankNet) < 0.001, `BANK net = 0 after void (got ${bankNet})`);
    const feeNet = (lg2.map.CARD_FEE?.debit ?? 0) - (lg2.map.CARD_FEE?.credit ?? 0);
    expect(Math.abs(feeNet) < 0.001, `CARD_FEE net = 0 after void (got ${feeNet})`);
    const clearingNet = (lg2.map.CARD_CLEARING?.debit ?? 0) - (lg2.map.CARD_CLEARING?.credit ?? 0);
    expect(Math.abs(clearingNet) < 0.001, `CARD_CLEARING net = 0 after void (got ${clearingNet})`);
    console.log('');

    // ─── Scenario 3: cannot re-void ─────────────────────────────────────
    console.log('3️⃣   Cannot re-void');
    let didThrow = false;
    try {
      await p.$transaction((tx) => voidBatch(tx, {
        batchId: closed2.batch.id, reason: 'try again', voidedByUserId: admin.id,
      }));
    } catch (e) {
      didThrow = (e instanceof Error) && e.message === 'BATCH_ALREADY_VOIDED';
    }
    expect(didThrow, 'second void throws BATCH_ALREADY_VOIDED');
    console.log('');
  } finally {
    console.log('🧹  Cleanup');
    if (allBatches.length) {
      await p.ledgerEntry.deleteMany({ where: { referenceType: 'CardBatchReport', referenceId: { in: allBatches } } });
      await p.cardBatchReport.deleteMany({ where: { id: { in: allBatches } } });
    }
    if (allPayments.length) {
      await p.paymentAllocation.deleteMany({ where: { paymentId: { in: allPayments } } });
      await p.ledgerEntry.deleteMany({ where: { referenceType: 'Payment', referenceId: { in: allPayments } } });
      await p.payment.deleteMany({ where: { id: { in: allPayments } } });
    }
    if (allInvoices.length) {
      await p.ledgerEntry.deleteMany({ where: { referenceType: 'Invoice', referenceId: { in: allInvoices } } });
      await p.invoiceItem.deleteMany({ where: { invoiceId: { in: allInvoices } } });
      await p.invoice.deleteMany({ where: { id: { in: allInvoices } } });
    }
    if (allFolios.length) {
      await p.folioLineItem.deleteMany({ where: { folioId: { in: allFolios } } });
      await p.folio.deleteMany({ where: { id: { in: allFolios } } });
    }
    if (allBookings.length) {
      await p.activityLog.deleteMany({ where: { bookingId: { in: allBookings } } });
      await p.booking.deleteMany({ where: { id: { in: allBookings } } });
    }
    await p.guest.delete({ where: { id: guest.id } });
    if (tempTerminal && terminal) {
      await p.edcTerminal.delete({ where: { id: terminal.id } }).catch(() => {});
    }
    console.log('    cleanup done\n');
  }

  if (failures.length) {
    console.log(`\n❌  ${failures.length} assertion(s) failed:`);
    failures.forEach((f) => console.log(`     • ${f}`));
    process.exit(1);
  } else {
    console.log('✅  All card-batch VOID assertions passed\n');
  }
  await p.$disconnect();
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1); });
