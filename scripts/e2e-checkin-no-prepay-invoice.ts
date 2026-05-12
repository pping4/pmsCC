/**
 * Phase 6.9 — Check-in without upfront pay still creates INV-CI
 *
 * Reproduction (BK-BK-2026-0019 in the user's report):
 *   1. Guest checks in WITHOUT paying upfront
 *   2. /api/checkin only adds FolioLineItem rows (UNBILLED), no invoice
 *   3. Bill tab shows PROFORMA row (fallback when no real invoices)
 *   4. Guest extends with "เก็บเงินภายหลัง"
 *   5. Phase 6.7 cuts INV-GN for the extension only
 *   6. Bill tab now shows ONLY INV-GN — the original stay nights are
 *      invisible (proforma disappears once any real invoice exists)
 *
 * Fix: hoist createInvoiceFromFolio out of the `collectUpfront` guard so
 * every checked-in booking carries INV-CI from the start (status=unpaid
 * when not paid upfront, status=paid when paid). Mirror of Phase 6.7
 * for extend.
 *
 * Scenarios:
 *   1. Daily check-in, no upfront pay → INV-CI unpaid, FolioLineItem BILLED
 *   2. Daily check-in, upfront pay → INV-CI paid + Payment + ledger (regression)
 *   3. Monthly check-in, no upfront → no invoice (matches existing semantics:
 *      monthly billed at renewal cycle)
 *   4. Daily check-in (unpaid) + later extend pay-later → both INV-CI and
 *      INV-GN visible, total outstanding = stay + extension
 *
 *   npx tsx scripts/e2e-checkin-no-prepay-invoice.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { createPayment } from '../src/services/payment.service';
import {
  addNightlyRoomCharges, addCharge, createInvoiceFromFolio,
  markLineItemsPaid, recalculateFolioBalance,
} from '../src/services/folio.service';

const p = new PrismaClient();
const failures: string[] = [];
function expect(c: boolean, m: string) {
  if (c) console.log(`    ✓ ${m}`);
  else   { console.log(`    ✗ ${m}`); failures.push(m); }
}

/** Mirror of the route's check-in tx body for both upfront / no-prepay branches. */
async function checkinInTx(opts: {
  bookingId: string;
  guestId: string;
  folioId: string;
  roomNumber: string;
  bookingType: 'daily' | 'monthly_short' | 'monthly_long';
  checkIn: Date;
  checkOut: Date;
  nights: number | null;
  rate: number;
  stayAmount: number;
  collectUpfront: boolean;
  upfrontPaymentMethod?: 'cash';
  cashSessionId?: string;
  userId: string;
}) {
  return p.$transaction(async (tx) => {
    const isMonthly = opts.bookingType !== 'daily';
    const shouldAddRoomCharge = !isMonthly || (opts.collectUpfront && !!opts.upfrontPaymentMethod);

    // 3a — add ROOM charge to folio
    if (shouldAddRoomCharge) {
      if (!isMonthly && opts.nights && opts.nights > 0) {
        await addNightlyRoomCharges(tx, {
          folioId: opts.folioId, roomNumber: opts.roomNumber,
          startDate: opts.checkIn, nights: opts.nights,
          ratePerNight: opts.rate, taxType: 'no_tax',
          referenceType: 'booking', referenceId: opts.bookingId,
          notes: 'E2E check-in', createdBy: opts.userId,
        });
      } else {
        await addCharge(tx, {
          folioId: opts.folioId, chargeType: 'ROOM',
          description: `ค่าห้องพัก — ห้อง ${opts.roomNumber}`,
          amount: opts.stayAmount, quantity: 1, unitPrice: opts.stayAmount,
          serviceDate: opts.checkIn, periodEnd: opts.checkOut,
          createdBy: opts.userId,
        });
      }
    }

    // 3b — Phase 6.9 — always create INV-CI when there's something to bill
    let stayInvoiceResult: { invoiceId: string; grandTotal: number; invoiceNumber: string } | null = null;
    const dueDate = isMonthly
      ? new Date(opts.checkIn.getFullYear(), opts.checkIn.getMonth() + 1, 1)
      : opts.checkOut;
    stayInvoiceResult = await createInvoiceFromFolio(tx, {
      folioId: opts.folioId, guestId: opts.guestId, bookingId: opts.bookingId,
      invoiceType: 'CI', dueDate, notes: 'E2E', createdBy: opts.userId,
    });

    // 3b' — mark paid only when actually collecting upfront
    if (opts.collectUpfront && opts.upfrontPaymentMethod && stayInvoiceResult) {
      await tx.invoice.update({
        where: { id: stayInvoiceResult.invoiceId },
        data:  { paidAmount: stayInvoiceResult.grandTotal, status: 'paid' },
      });
      await markLineItemsPaid(tx, stayInvoiceResult.invoiceId);
    }

    // 5 — Payment row for upfront
    let paymentId: string | null = null;
    if (opts.collectUpfront && opts.upfrontPaymentMethod && stayInvoiceResult) {
      const pay = await createPayment(tx, {
        idempotencyKey: `ci-${opts.bookingId}-${Date.now()}`,
        guestId: opts.guestId, bookingId: opts.bookingId,
        amount: stayInvoiceResult.grandTotal,
        paymentMethod: opts.upfrontPaymentMethod, paymentDate: new Date(),
        receivedBy: opts.userId, cashSessionId: opts.cashSessionId,
        allocations: [{ invoiceId: stayInvoiceResult.invoiceId, amount: stayInvoiceResult.grandTotal }],
        createdBy: opts.userId,
      });
      paymentId = pay.id;
    }

    await tx.booking.update({
      where: { id: opts.bookingId },
      data:  { status: 'checked_in', actualCheckIn: new Date() },
    });
    await recalculateFolioBalance(tx, opts.folioId);

    return {
      stayInvoiceId: stayInvoiceResult?.invoiceId ?? null,
      stayInvoiceAmount: stayInvoiceResult?.grandTotal ?? 0,
      paymentId,
    };
  });
}

async function setupConfirmedBooking(opts: {
  tag: string; guestId: string; roomId: string; userId: string;
  rate: number; bookingType: 'daily' | 'monthly_short' | 'monthly_long';
  nights?: number;
}) {
  return p.$transaction(async (tx) => {
    const suffix = `${opts.tag}-${Math.random().toString(36).slice(2, 5)}`;
    const checkIn  = new Date('2026-12-28');
    const checkOut = new Date('2026-12-28');
    if (opts.nights) checkOut.setUTCDate(checkOut.getUTCDate() + opts.nights);
    else checkOut.setUTCMonth(checkOut.getUTCMonth() + 1);
    const stayAmount = opts.bookingType === 'daily' ? opts.rate * (opts.nights ?? 1) : opts.rate;

    const booking = await tx.booking.create({
      data: {
        bookingNumber: `BK-${suffix}`,
        guestId: opts.guestId, roomId: opts.roomId,
        bookingType: opts.bookingType, status: 'confirmed', source: 'direct',
        checkIn, checkOut, rate: new Prisma.Decimal(opts.rate),
      },
    });
    const folio = await tx.folio.create({
      data: {
        folioNumber: `FLO-${suffix}`, bookingId: booking.id, guestId: opts.guestId,
        totalCharges: 0, totalPayments: 0, balance: 0,
      },
    });
    return {
      bookingId: booking.id, folioId: folio.id,
      checkIn, checkOut, stayAmount,
    };
  });
}

async function main() {
  console.log('🧪  Phase 6.9 — Check-in without upfront still cuts INV-CI\n');

  const room = await p.room.findFirst({ where: { status: 'available' } });
  const admin = await p.user.findFirst({ where: { email: 'admin@pms.com' } });
  if (!room || !admin) { console.error('missing fixtures'); process.exit(1); }

  let session = await p.cashSession.findFirst({ where: { openedBy: admin.id, status: 'OPEN' } });
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

  const tag = `ci-${Math.random().toString(36).slice(2, 6)}`;
  console.log(`Tag: ${tag} · room: ${room.number}\n`);

  const guest = await p.guest.create({
    data: {
      firstName: `E2E-${tag.slice(-4)}`, lastName: 'Checkin', phone: '0000000000',
      nationality: 'Thai', idType: 'thai_id',
      idNumber: `3333${Date.now().toString().slice(-9)}`,
    },
  });

  const allBookings: string[] = [];
  const allFolios:   string[] = [];
  const allInvoices: string[] = [];
  const allPayments: string[] = [];

  try {
    // ─── Scenario 1: daily no-prepay ─────────────────────────────────────
    console.log('1️⃣   Daily check-in, NO upfront pay');
    const f1 = await setupConfirmedBooking({
      tag, guestId: guest.id, roomId: room.id, userId: admin.id,
      rate: 1000, bookingType: 'daily', nights: 2,
    });
    allBookings.push(f1.bookingId); allFolios.push(f1.folioId);

    const r1 = await checkinInTx({
      bookingId: f1.bookingId, guestId: guest.id, folioId: f1.folioId,
      roomNumber: room.number, bookingType: 'daily',
      checkIn: f1.checkIn, checkOut: f1.checkOut,
      nights: 2, rate: 1000, stayAmount: f1.stayAmount,
      collectUpfront: false, userId: admin.id,
    });
    if (r1.stayInvoiceId) allInvoices.push(r1.stayInvoiceId);

    expect(r1.stayInvoiceId !== null, `INV-CI created (got id ${r1.stayInvoiceId ? '✓' : 'null'})`);
    expect(r1.stayInvoiceAmount === 2000, `grandTotal = 2000 (got ${r1.stayInvoiceAmount})`);
    expect(r1.paymentId === null, 'no payment row');

    const inv1 = await p.invoice.findUniqueOrThrow({
      where: { id: r1.stayInvoiceId! },
      select: { status: true, paidAmount: true,
                items: { select: { folioLineItem: { select: { billingStatus: true } } } } },
    });
    expect(inv1.status === 'unpaid', `invoice unpaid (got ${inv1.status})`);
    expect(Number(inv1.paidAmount) === 0, `paidAmount = 0`);
    const allBilled = inv1.items.every(it => it.folioLineItem?.billingStatus === ('BILLED' as never));
    expect(allBilled, 'all line items BILLED (no longer UNBILLED → visible in bill tab)');
    console.log('');

    // ─── Scenario 2: daily upfront — regression ─────────────────────────
    console.log('2️⃣   Daily check-in, upfront cash pay (regression)');
    // Use a fresh room since the previous one is now "checked_in"
    const room2 = (await p.room.findFirst({ where: { status: 'available', id: { not: room.id } } })) ?? room;
    const f2 = await setupConfirmedBooking({
      tag: `${tag}-b`, guestId: guest.id, roomId: room2.id, userId: admin.id,
      rate: 1500, bookingType: 'daily', nights: 1,
    });
    allBookings.push(f2.bookingId); allFolios.push(f2.folioId);

    const r2 = await checkinInTx({
      bookingId: f2.bookingId, guestId: guest.id, folioId: f2.folioId,
      roomNumber: room2.number, bookingType: 'daily',
      checkIn: f2.checkIn, checkOut: f2.checkOut,
      nights: 1, rate: 1500, stayAmount: f2.stayAmount,
      collectUpfront: true, upfrontPaymentMethod: 'cash',
      cashSessionId: session!.id, userId: admin.id,
    });
    if (r2.stayInvoiceId) allInvoices.push(r2.stayInvoiceId);
    if (r2.paymentId) allPayments.push(r2.paymentId);

    expect(r2.stayInvoiceId !== null, 'INV-CI created');
    expect(r2.paymentId !== null, 'payment created');
    const inv2 = await p.invoice.findUniqueOrThrow({
      where: { id: r2.stayInvoiceId! },
      select: { status: true, paidAmount: true },
    });
    expect(inv2.status === 'paid', `invoice paid (got ${inv2.status})`);
    expect(Number(inv2.paidAmount) === 1500, `paidAmount = 1500 (got ${inv2.paidAmount})`);
    console.log('');

    // ─── Scenario 3: monthly no-prepay → no invoice ─────────────────────
    console.log('3️⃣   Monthly check-in, no upfront → no invoice (billed at renewal)');
    const room3 = (await p.room.findFirst({ where: { status: 'available', id: { notIn: [room.id, room2.id] } } })) ?? room;
    const f3 = await setupConfirmedBooking({
      tag: `${tag}-m`, guestId: guest.id, roomId: room3.id, userId: admin.id,
      rate: 8000, bookingType: 'monthly_short',
    });
    allBookings.push(f3.bookingId); allFolios.push(f3.folioId);

    const r3 = await checkinInTx({
      bookingId: f3.bookingId, guestId: guest.id, folioId: f3.folioId,
      roomNumber: room3.number, bookingType: 'monthly_short',
      checkIn: f3.checkIn, checkOut: f3.checkOut,
      nights: null, rate: 8000, stayAmount: f3.stayAmount,
      collectUpfront: false, userId: admin.id,
    });
    if (r3.stayInvoiceId) allInvoices.push(r3.stayInvoiceId);

    expect(r3.stayInvoiceId === null, `no invoice for monthly no-prepay (got ${r3.stayInvoiceId})`);
    expect(r3.paymentId === null, 'no payment');
    console.log('');

    // ─── Scenario 4: daily no-prepay + later extend pay-later ───────────
    console.log('4️⃣   Daily check-in (unpaid) → extend pay-later → BOTH invoices visible');
    // Reuse scenario 1's booking (already checked-in, INV-CI unpaid).
    // Simulate the extend pay-later flow by appending 1 more night and cutting INV-GN.
    const extResult = await p.$transaction(async (tx) => {
      const newCheckOut = new Date(f1.checkOut);
      newCheckOut.setUTCDate(newCheckOut.getUTCDate() + 1);
      await tx.booking.update({ where: { id: f1.bookingId }, data: { checkOut: newCheckOut } });
      const { lineItemIds } = await addNightlyRoomCharges(tx, {
        folioId: f1.folioId, roomNumber: room.number,
        startDate: f1.checkOut, nights: 1, ratePerNight: 1000,
        taxType: 'no_tax', referenceType: 'booking', referenceId: f1.bookingId,
        notes: 'E2E extend', createdBy: admin.id,
      });
      // Phase 6.7: always cut INV-EX even when pay-later
      const inv = await createInvoiceFromFolio(tx, {
        folioId: f1.folioId, guestId: guest.id, bookingId: f1.bookingId,
        invoiceType: 'GN', dueDate: newCheckOut,
        notes: 'E2E extend invoice', createdBy: admin.id,
        lineItemIds,
      });
      return inv?.invoiceId ?? null;
    });
    if (extResult) allInvoices.push(extResult);

    const allInvForBk = await p.invoice.findMany({
      where: { bookingId: f1.bookingId, status: { not: 'voided' } },
      select: { id: true, status: true, grandTotal: true, invoiceType: true },
    });
    expect(allInvForBk.length === 2, `2 invoices on booking (INV-CI + INV-GN, got ${allInvForBk.length})`);
    expect(allInvForBk.every(i => i.status === 'unpaid'), `both unpaid (got ${allInvForBk.map(i => i.status).join(',')})`);
    const totalOutstanding = allInvForBk.reduce((s, i) => s + Number(i.grandTotal), 0);
    expect(totalOutstanding === 3000, `total outstanding = 3000 (stay 2000 + extend 1000, got ${totalOutstanding})`);
    console.log('');
  } finally {
    console.log('🧹  Cleanup');
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
    if (tempSession && session) {
      await p.cashSession.delete({ where: { id: session.id } }).catch(() => {});
    }
    console.log('    cleanup done\n');
  }

  if (failures.length) {
    console.log(`\n❌  ${failures.length} assertion(s) failed:`);
    failures.forEach((f) => console.log(`     • ${f}`));
    process.exit(1);
  } else {
    console.log('✅  All check-in invoice assertions passed\n');
  }
  await p.$disconnect();
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1); });
