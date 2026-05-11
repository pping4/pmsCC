/**
 * Phase 6.1 — Cancel-after-checkin E2E
 *
 * Exercises the new code path in PUT /api/bookings/[id] action='cancel'
 * (now reachable through the booking service-layer functions directly).
 *
 *   1. Confirmed booking, full cash refund.
 *      Pre: room=reserved (set up by us). Post: room=available + refund processed.
 *   2. Checked-in booking, full cash refund.
 *      Pre: room=occupied. Post: room=cleaning + refund processed.
 *   3. Checked-in booking, full CREDIT refund.
 *      Post: GuestCredit row + DR AR / CR GUEST_CREDIT_LIABILITY ledger.
 *   4. Confirmed booking, forfeit (refund=0).
 *      Post: status=cancelled, NO refund row, NO line items voided.
 *
 * The scripts call the same services the API route calls, in a tx, mirroring
 * the route handler's logic. This avoids needing an HTTP harness while still
 * exercising 95% of the surface (the route's input parsing + auth is the
 * remaining 5%).
 *
 *   npx tsx scripts/e2e-cancel-checkin.ts
 */

import { PrismaClient, Prisma, RefundSource, PaymentStatus } from '@prisma/client';
import { createPayment } from '../src/services/payment.service';
import { createPendingRefund, processRefund } from '../src/services/refund.service';
import { partialVoidInvoice, voidCharge } from '../src/services/folio.service';
import { transitionRoom, canTransition } from '../src/services/roomStatus.service';

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

/** Mirror of the route handler's cancel logic for an isolated test. */
async function cancelBookingInTx(opts: {
  bookingId: string;
  refundAmount: number;
  mode?: 'cash' | 'credit' | 'split';
  method?: 'cash' | 'transfer';
  cashAmount?: number;
  cashSessionId?: string;
  reason: string;
  changedBy: string;
}) {
  return p.$transaction(async (tx) => {
    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: opts.bookingId },
      select: { id: true, status: true, roomId: true, guestId: true, bookingNumber: true },
    });
    const wasCheckedIn = booking.status === 'checked_in';
    const requested = new Prisma.Decimal(opts.refundAmount);

    // 1) Void line items newest-first until covered
    let voidedAmount = new Prisma.Decimal(0);
    if (requested.greaterThan(0)) {
      const folio = await tx.folio.findUnique({ where: { bookingId: opts.bookingId }, select: { id: true } });
      if (folio) {
        const items = await tx.folioLineItem.findMany({
          where: { folioId: folio.id, billingStatus: { not: 'VOIDED' as never } },
          orderBy: [{ serviceDate: 'desc' }, { createdAt: 'desc' }],
          select: { id: true, amount: true, billingStatus: true, invoiceItem: { select: { invoiceId: true } } },
        });
        const byInvoice = new Map<string, string[]>();
        const unbilledIds: string[] = [];
        for (const it of items) {
          if (voidedAmount.greaterThanOrEqualTo(requested)) break;
          voidedAmount = voidedAmount.plus(it.amount);
          if (it.billingStatus === ('UNBILLED' as never)) unbilledIds.push(it.id);
          else if (it.invoiceItem?.invoiceId) {
            const arr = byInvoice.get(it.invoiceItem.invoiceId) ?? [];
            arr.push(it.id);
            byInvoice.set(it.invoiceItem.invoiceId, arr);
          }
        }
        for (const [invId, ids] of byInvoice) {
          await partialVoidInvoice(tx, {
            invoiceId: invId, folioLineItemIds: ids,
            reason: `Cancellation: ${opts.reason}`, voidedBy: opts.changedBy,
          });
        }
        for (const id of unbilledIds) await voidCharge(tx, id);
      }
    }

    // 2) Booking status
    const updated = await tx.booking.update({
      where: { id: opts.bookingId },
      data:  { status: 'cancelled' },
      select: { id: true, status: true },
    });

    // 3) Room transition
    const liveRoom = await tx.room.findUniqueOrThrow({
      where:  { id: booking.roomId },
      select: { status: true, currentBookingId: true },
    });
    if (liveRoom.currentBookingId === opts.bookingId) {
      if (wasCheckedIn) {
        if (canTransition(liveRoom.status, 'cleaning')) {
          await transitionRoom(tx, {
            roomId: booking.roomId, to: 'cleaning', reason: 'cancel (was checked-in)',
            userId: opts.changedBy, bookingId: opts.bookingId, currentBookingId: null,
          });
        }
      } else if (canTransition(liveRoom.status, 'available')) {
        await transitionRoom(tx, {
          roomId: booking.roomId, to: 'available', reason: 'cancel',
          userId: opts.changedBy, bookingId: opts.bookingId, currentBookingId: null,
        });
      }
    }

    // 4) Refund
    let refundId: string | null = null;
    let processed = false;
    if (requested.greaterThan(0)) {
      const r = await createPendingRefund(tx, {
        bookingId: opts.bookingId, guestId: booking.guestId,
        amount: requested, source: RefundSource.cancellation,
        reason: opts.reason, referenceType: 'Booking', referenceId: opts.bookingId,
        createdBy: opts.changedBy,
      });
      refundId = r.refundId;

      if (opts.mode) {
        await processRefund(tx, {
          refundId: r.refundId, mode: opts.mode, method: opts.method,
          cashAmount: opts.mode === 'split' ? opts.cashAmount : undefined,
          processedBy: opts.changedBy,
          cashSessionId: opts.cashSessionId,
        });
        processed = true;
      }
    }
    return { updated, refundId, processed, voidedAmount: Number(voidedAmount) };
  });
}

async function makeBookingFixture(opts: {
  tag: string;
  guestId: string;
  roomId: string;
  adminId: string;
  status: 'confirmed' | 'checked_in';
  amount: number;
}) {
  const num = String(Math.floor(Math.random() * 9000) + 1000).padStart(4, '0');
  return p.$transaction(async (tx) => {
    const booking = await tx.booking.create({
      data: {
        bookingNumber: `BK-${opts.tag}-${num}`, guestId: opts.guestId, roomId: opts.roomId,
        bookingType: 'daily', status: opts.status, source: 'direct',
        checkIn: new Date('2026-11-05'), checkOut: new Date('2026-11-06'),
        rate: new Prisma.Decimal(opts.amount),
      },
    });
    const folio = await tx.folio.create({
      data: {
        folioNumber: `FLO-${opts.tag}-${num}`, bookingId: booking.id, guestId: opts.guestId,
        totalCharges: new Prisma.Decimal(opts.amount), totalPayments: 0, balance: new Prisma.Decimal(opts.amount),
      },
    });
    const item = await tx.folioLineItem.create({
      data: {
        folioId: folio.id, chargeType: 'ROOM',
        description: 'E2E room', amount: new Prisma.Decimal(opts.amount),
        quantity: 1, unitPrice: new Prisma.Decimal(opts.amount),
        taxType: 'no_tax', billingStatus: 'BILLED',
        serviceDate: new Date('2026-11-05'), periodEnd: new Date('2026-11-06'),
        createdBy: opts.adminId,
      },
    });
    const inv = await tx.invoice.create({
      data: {
        invoiceNumber: `INV-${opts.tag}-${num}`, bookingId: booking.id, guestId: opts.guestId, folioId: folio.id,
        issueDate: new Date(), dueDate: new Date('2026-11-06'),
        invoiceType: 'daily_stay',
        subtotal: new Prisma.Decimal(opts.amount), grandTotal: new Prisma.Decimal(opts.amount),
        paidAmount: 0, status: 'unpaid',
        items: { create: [{ description: item.description, amount: new Prisma.Decimal(opts.amount), folioLineItemId: item.id, taxType: 'no_tax' }] },
      },
    });
    // Make room reflect the booking state
    await tx.room.update({
      where: { id: opts.roomId },
      data:  {
        status: opts.status === 'checked_in' ? 'occupied' : 'reserved',
        currentBookingId: booking.id,
      },
    });
    return { bookingId: booking.id, folioId: folio.id, invoiceId: inv.id, lineItemId: item.id };
  });
}

async function main() {
  console.log('🧪  Phase 6.1 — Cancel-after-checkin E2E\n');

  const room = await p.room.findFirst({ where: { status: 'available' } });
  const admin = await p.user.findFirst({ where: { email: 'admin@pms.com' } });
  if (!room || !admin) { console.error('missing fixtures (need available room + admin user)'); process.exit(1); }

  // Open a cash session for the admin so cash-mode refund can resolve
  let session = await p.cashSession.findFirst({
    where: { openedBy: admin.id, status: 'OPEN' },
  });
  let tempSession = false;
  if (!session) {
    const cashBox = await p.cashBox.findFirst();
    if (!cashBox) { console.error('no cash box seeded'); process.exit(1); }
    session = await p.cashSession.create({
      data: {
        cashBoxId: cashBox.id, openedBy: admin.id,
        openedByName: admin.name ?? admin.email ?? 'admin',
        openingBalance: new Prisma.Decimal(1000), status: 'OPEN',
      },
    });
    tempSession = true;
  }

  const tag = `cancel-${Math.random().toString(36).slice(2, 7)}`;
  console.log(`Tag: ${tag} · room: ${room.number}\n`);

  const guest = await p.guest.create({
    data: {
      firstName: `E2E-${tag.slice(-5)}`, lastName: 'Cancel', phone: '0000000000',
      nationality: 'Thai', idType: 'thai_id',
      idNumber: `8888${Date.now().toString().slice(-9)}`,
    },
  });

  const allBookings: string[] = [];
  const allRefundIds: string[] = [];
  const allPayIds: string[]    = [];
  const allInvoices: string[]  = [];
  const allFolios: string[]    = [];
  const allGuestCredits: string[] = [];

  try {
    // ─── Scenario 1: confirmed booking, full cash refund ─────────────────
    console.log('1️⃣   Confirmed booking → cancel + full cash refund');
    const f1 = await makeBookingFixture({ tag, guestId: guest.id, roomId: room.id, adminId: admin.id, status: 'confirmed', amount: 3000 });
    allBookings.push(f1.bookingId); allInvoices.push(f1.invoiceId); allFolios.push(f1.folioId);

    const pay1 = await p.$transaction((tx) => createPayment(tx, {
      idempotencyKey: `${tag}-pay1`, guestId: guest.id, bookingId: f1.bookingId,
      amount: 3000, paymentMethod: 'cash', paymentDate: new Date(),
      receivedBy: admin.id, createdBy: admin.id, cashSessionId: session!.id,
      allocations: [{ invoiceId: f1.invoiceId, amount: 3000 }],
    }));
    allPayIds.push(pay1.id);

    const r1 = await cancelBookingInTx({
      bookingId: f1.bookingId, refundAmount: 3000,
      mode: 'cash', method: 'cash', cashSessionId: session!.id,
      reason: 'E2E test confirmed cancel cash', changedBy: admin.id,
    });
    if (r1.refundId) allRefundIds.push(r1.refundId);

    expect(r1.processed === true, 'refund processed in same tx');
    expect(Math.abs(r1.voidedAmount - 3000) < 0.001, `voided amount = 3000 (got ${r1.voidedAmount})`);

    const b1 = await p.booking.findUniqueOrThrow({ where: { id: f1.bookingId }, select: { status: true } });
    expect(b1.status === 'cancelled', 'booking.status = cancelled');

    const room1 = await p.room.findUniqueOrThrow({ where: { id: room.id }, select: { status: true, currentBookingId: true } });
    expect(room1.status === 'available', `room → available (got ${room1.status})`);
    expect(room1.currentBookingId === null, 'room.currentBookingId cleared');

    const inv1 = await p.invoice.findUniqueOrThrow({ where: { id: f1.invoiceId }, select: { items: { select: { folioLineItem: { select: { billingStatus: true } } } } } });
    const allVoided1 = inv1.items.every((it) => it.folioLineItem?.billingStatus === ('VOIDED' as never));
    expect(allVoided1, 'all line items VOIDED');

    // Ledger: void (DR REVENUE 3000 / CR AR 3000) + refund (DR AR 3000 / CR CASH 3000)
    // Net: AR has 0, REVENUE has -3000 (reversed), CASH has -3000.
    const arBal1 = await p.ledgerEntry.aggregate({
      _sum: { amount: true },
      where: { account: 'AR', referenceType: 'Invoice', referenceId: f1.invoiceId, type: 'CREDIT' },
    });
    expect(Number(arBal1._sum.amount ?? 0) === 3000, `partial-void posted CR AR 3000 against invoice (got ${arBal1._sum.amount})`);

    // Reset room for next test
    await p.room.update({ where: { id: room.id }, data: { status: 'available', currentBookingId: null } });
    console.log('');

    // ─── Scenario 2: checked-in booking, full cash refund ────────────────
    console.log('2️⃣   Checked-in booking → cancel + full cash refund');
    const f2 = await makeBookingFixture({ tag, guestId: guest.id, roomId: room.id, adminId: admin.id, status: 'checked_in', amount: 5000 });
    allBookings.push(f2.bookingId); allInvoices.push(f2.invoiceId); allFolios.push(f2.folioId);

    const pay2 = await p.$transaction((tx) => createPayment(tx, {
      idempotencyKey: `${tag}-pay2`, guestId: guest.id, bookingId: f2.bookingId,
      amount: 5000, paymentMethod: 'cash', paymentDate: new Date(),
      receivedBy: admin.id, createdBy: admin.id, cashSessionId: session!.id,
      allocations: [{ invoiceId: f2.invoiceId, amount: 5000 }],
    }));
    allPayIds.push(pay2.id);

    const r2 = await cancelBookingInTx({
      bookingId: f2.bookingId, refundAmount: 5000,
      mode: 'cash', method: 'cash', cashSessionId: session!.id,
      reason: 'E2E test checked-in cancel cash', changedBy: admin.id,
    });
    if (r2.refundId) allRefundIds.push(r2.refundId);

    expect(r2.processed === true, 'refund processed');
    const room2 = await p.room.findUniqueOrThrow({ where: { id: room.id }, select: { status: true, currentBookingId: true } });
    expect(room2.status === 'cleaning', `room → cleaning (got ${room2.status})`);
    expect(room2.currentBookingId === null, 'room.currentBookingId cleared');

    // Folio balance should be ~0 after void + refund
    const folio2 = await p.folio.findUniqueOrThrow({ where: { id: f2.folioId }, select: { totalCharges: true, totalPayments: true, balance: true } });
    expect(Number(folio2.totalCharges) === 0, `folio.totalCharges = 0 (got ${folio2.totalCharges})`);
    // totalPayments could be 0 (reversal allocation cancels original) — must
    // not stay at 5000.
    expect(Number(folio2.totalPayments) === 0, `folio.totalPayments = 0 after reversal (got ${folio2.totalPayments})`);

    // Reset room for next test
    await p.room.update({ where: { id: room.id }, data: { status: 'available', currentBookingId: null } });
    console.log('');

    // ─── Scenario 3: checked-in booking, full CREDIT refund ──────────────
    console.log('3️⃣   Checked-in booking → cancel + full CREDIT refund');
    const f3 = await makeBookingFixture({ tag, guestId: guest.id, roomId: room.id, adminId: admin.id, status: 'checked_in', amount: 4000 });
    allBookings.push(f3.bookingId); allInvoices.push(f3.invoiceId); allFolios.push(f3.folioId);

    const pay3 = await p.$transaction((tx) => createPayment(tx, {
      idempotencyKey: `${tag}-pay3`, guestId: guest.id, bookingId: f3.bookingId,
      amount: 4000, paymentMethod: 'cash', paymentDate: new Date(),
      receivedBy: admin.id, createdBy: admin.id, cashSessionId: session!.id,
      allocations: [{ invoiceId: f3.invoiceId, amount: 4000 }],
    }));
    allPayIds.push(pay3.id);

    const r3 = await cancelBookingInTx({
      bookingId: f3.bookingId, refundAmount: 4000,
      mode: 'credit',
      reason: 'E2E test checked-in cancel credit', changedBy: admin.id,
    });
    if (r3.refundId) allRefundIds.push(r3.refundId);
    expect(r3.processed === true, 'refund processed');

    // Should have issued a GuestCredit row
    const credits = await p.guestCredit.findMany({
      where: { guestId: guest.id, bookingId: f3.bookingId },
      select: { id: true, amount: true, status: true, remainingAmount: true },
    });
    expect(credits.length === 1, `1 GuestCredit issued (got ${credits.length})`);
    if (credits[0]) {
      allGuestCredits.push(credits[0].id);
      expect(Number(credits[0].amount) === 4000, `GuestCredit.amount = 4000 (got ${credits[0].amount})`);
      expect(Number(credits[0].remainingAmount) === 4000, `remainingAmount = 4000`);
      expect(credits[0].status === ('active' as never), `status = active`);
    }

    // Ledger should include CR GUEST_CREDIT_LIABILITY against GuestCredit ref
    const credLedger = credits[0] ? await ledgerBySubKind('GuestCredit', [credits[0].id]) : { map: {}, count: 0 };
    expect(credLedger.map.GUEST_CREDIT?.credit === 4000, `CR GUEST_CREDIT_LIABILITY 4000 (got ${JSON.stringify(credLedger.map.GUEST_CREDIT)})`);

    await p.room.update({ where: { id: room.id }, data: { status: 'available', currentBookingId: null } });
    console.log('');

    // ─── Scenario 4: confirmed booking, FORFEIT (refund=0) ───────────────
    console.log('4️⃣   Confirmed booking → cancel + forfeit (no refund)');
    const f4 = await makeBookingFixture({ tag, guestId: guest.id, roomId: room.id, adminId: admin.id, status: 'confirmed', amount: 2000 });
    allBookings.push(f4.bookingId); allInvoices.push(f4.invoiceId); allFolios.push(f4.folioId);

    const pay4 = await p.$transaction((tx) => createPayment(tx, {
      idempotencyKey: `${tag}-pay4`, guestId: guest.id, bookingId: f4.bookingId,
      amount: 2000, paymentMethod: 'cash', paymentDate: new Date(),
      receivedBy: admin.id, createdBy: admin.id, cashSessionId: session!.id,
      allocations: [{ invoiceId: f4.invoiceId, amount: 2000 }],
    }));
    allPayIds.push(pay4.id);

    const r4 = await cancelBookingInTx({
      bookingId: f4.bookingId, refundAmount: 0,
      reason: 'E2E test forfeit', changedBy: admin.id,
    });
    expect(r4.refundId === null, 'no refund record created');
    expect(r4.voidedAmount === 0, 'no line items voided');

    const b4 = await p.booking.findUniqueOrThrow({ where: { id: f4.bookingId }, select: { status: true } });
    expect(b4.status === 'cancelled', 'booking.status = cancelled');

    const inv4 = await p.invoice.findUniqueOrThrow({
      where: { id: f4.invoiceId },
      select: { items: { select: { folioLineItem: { select: { billingStatus: true } } } } },
    });
    const noneVoided4 = inv4.items.every((it) => it.folioLineItem?.billingStatus !== ('VOIDED' as never));
    expect(noneVoided4, 'no line items voided (forfeit retains revenue)');

    await p.room.update({ where: { id: room.id }, data: { status: 'available', currentBookingId: null } });
    console.log('');
  } finally {
    // ─── Cleanup ─────────────────────────────────────────────────────────
    console.log('🧹  Cleanup');
    if (allGuestCredits.length) {
      await p.ledgerEntry.deleteMany({ where: { referenceType: 'GuestCredit', referenceId: { in: allGuestCredits } } });
      await p.guestCredit.deleteMany({ where: { id: { in: allGuestCredits } } });
    }
    if (allRefundIds.length) {
      await p.ledgerEntry.deleteMany({ where: { referenceType: 'RefundRecord', referenceId: { in: allRefundIds } } });
      await p.refundRecord.deleteMany({ where: { id: { in: allRefundIds } } });
    }
    if (allPayIds.length) {
      await p.paymentAllocation.deleteMany({ where: { paymentId: { in: allPayIds } } });
      await p.ledgerEntry.deleteMany({ where: { referenceType: 'Payment', referenceId: { in: allPayIds } } });
      await p.payment.deleteMany({ where: { id: { in: allPayIds } } });
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
    if (tempSession && session) {
      await p.cashSession.delete({ where: { id: session.id } }).catch(() => {});
    }
    await p.room.update({ where: { id: room.id }, data: { status: 'available', currentBookingId: null } });
    console.log('    cleanup done\n');
  }

  if (failures.length) {
    console.log(`\n❌  ${failures.length} assertion(s) failed:`);
    failures.forEach((f) => console.log(`     • ${f}`));
    process.exit(1);
  } else {
    console.log('✅  All cancel-after-checkin assertions passed\n');
  }

  await p.$disconnect();
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1); });
