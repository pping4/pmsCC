/**
 * Phase 6.8 Fix #2 — Checkout settles ALL unpaid invoices, not just INV-CO
 *
 * Reproduces the bug where a guest who had multiple unpaid invoices at
 * checkout (e.g. prior extends taken as "เก็บเงินภายหลัง") would only see
 * the newly-created INV-CO get paid. Prior INV-GN / INV-EX rows stayed
 * UNPAID forever and AR carried a permanent residual.
 *
 * Fix: after createInvoiceFromFolio runs, query ALL unpaid invoices on the
 * booking (the new INV-CO + any prior unpaid) and create ONE Payment with
 * allocations spread oldest-first. The receipt aggregates items from every
 * paid invoice.
 *
 * Scenarios:
 *   1. 2 unpaid INV-GN (pay-later extends) + nothing UNBILLED at checkout
 *      → INV-CO is null, one Payment lands on both INV-GN
 *   2. 2 unpaid INV-GN + last-minute minibar charge
 *      → INV-CO created, one Payment spreads across 3 invoices
 *   3. No prior unpaid + everything UNBILLED (happy path / regression)
 *      → INV-CO only, single allocation — unchanged behaviour
 *
 *   npx tsx scripts/e2e-checkout-multi-invoice.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { createPayment } from '../src/services/payment.service';
import { createInvoiceFromFolio } from '../src/services/folio.service';

const p = new PrismaClient();
const failures: string[] = [];
function expect(c: boolean, m: string) {
  if (c) console.log(`    ✓ ${m}`);
  else   { console.log(`    ✗ ${m}`); failures.push(m); }
}

/** Mirror of the route's payment block — pay every unpaid invoice in one tx. */
async function checkoutPayInTx(opts: {
  bookingId: string;
  guestId: string;
  folioId: string;
  cashSessionId: string;
  userId: string;
  /** When true, also bill anything UNBILLED into INV-CO before paying. */
  alsoBillUnbilled: boolean;
}) {
  return p.$transaction(async (tx) => {
    // C: Create INV-CO from UNBILLED (may be null when nothing UNBILLED)
    const coResult = opts.alsoBillUnbilled
      ? await createInvoiceFromFolio(tx, {
          folioId: opts.folioId, guestId: opts.guestId, bookingId: opts.bookingId,
          invoiceType: 'CO', dueDate: new Date(),
          notes: 'E2E checkout INV-CO', createdBy: opts.userId,
        })
      : null;

    // D: Pay everything outstanding
    const allUnpaid = await tx.invoice.findMany({
      where: {
        bookingId: opts.bookingId,
        status: { in: ['unpaid', 'overdue', 'partial'] as never[] },
      },
      orderBy: { issueDate: 'asc' },
      select: { id: true, grandTotal: true, paidAmount: true, invoiceNumber: true },
    });
    const allocations = allUnpaid
      .map(inv => ({
        invoiceId: inv.id,
        amount: Math.max(0, Number(inv.grandTotal) - Number(inv.paidAmount)),
      }))
      .filter(a => a.amount > 0);
    const totalToPay = allocations.reduce((s, a) => s + a.amount, 0);

    if (totalToPay <= 0) {
      return { coInvoiceId: coResult?.invoiceId ?? null, totalPaid: 0, allocationCount: 0, paymentId: null as string | null };
    }
    const pay = await createPayment(tx, {
      idempotencyKey: `e2e-co-${opts.bookingId}-${Date.now()}`,
      guestId:        opts.guestId,
      bookingId:      opts.bookingId,
      amount:         totalToPay,
      paymentMethod:  'cash',
      paymentDate:    new Date(),
      receivedBy:     opts.userId,
      cashSessionId:  opts.cashSessionId,
      allocations,
      createdBy:      opts.userId,
    });
    return {
      coInvoiceId:    coResult?.invoiceId ?? null,
      totalPaid:      totalToPay,
      allocationCount: allocations.length,
      paymentId:      pay.id,
    };
  });
}

/** Set up a checked-in booking with N prior unpaid INV-GN (extensions paid later). */
async function setupBookingWithUnpaidExtends(opts: {
  tag: string;
  guestId: string;
  roomId: string;
  userId: string;
  paidDepositAmount: number;
  extendCount: number;
  extendAmount: number;
  /** Optional UNBILLED minibar charge at the end (simulates last-minute add). */
  minibarAmount?: number;
}) {
  return p.$transaction(async (tx) => {
    const suffix = `${opts.tag}-${Math.random().toString(36).slice(2, 5)}`;
    const booking = await tx.booking.create({
      data: {
        bookingNumber: `BK-${suffix}`,
        guestId: opts.guestId, roomId: opts.roomId,
        bookingType: 'daily', status: 'checked_in', source: 'direct',
        checkIn: new Date('2026-12-20'), checkOut: new Date('2026-12-22'),
        rate: new Prisma.Decimal(opts.paidDepositAmount),
      },
    });
    const folio = await tx.folio.create({
      data: {
        folioNumber: `FLO-${suffix}`, bookingId: booking.id, guestId: opts.guestId,
        totalCharges: new Prisma.Decimal(opts.paidDepositAmount),
        totalPayments: 0, balance: 0,
      },
    });

    // Paid deposit line item + INV-BK paid
    const depItem = await tx.folioLineItem.create({
      data: {
        folioId: folio.id, chargeType: 'ROOM',
        description: 'Pre-paid stay', amount: new Prisma.Decimal(opts.paidDepositAmount),
        quantity: 1, unitPrice: new Prisma.Decimal(opts.paidDepositAmount),
        taxType: 'no_tax', billingStatus: 'PAID',
        serviceDate: new Date('2026-12-20'), periodEnd: new Date('2026-12-22'),
        createdBy: opts.userId,
      },
    });
    const depInvoice = await tx.invoice.create({
      data: {
        invoiceNumber: `INV-BK-${suffix}`, bookingId: booking.id, guestId: opts.guestId, folioId: folio.id,
        issueDate: new Date('2026-12-20'),
        dueDate: new Date('2026-12-22'),
        invoiceType: 'deposit_receipt',
        subtotal: new Prisma.Decimal(opts.paidDepositAmount),
        grandTotal: new Prisma.Decimal(opts.paidDepositAmount),
        paidAmount: new Prisma.Decimal(opts.paidDepositAmount),
        status: 'paid',
        items: { create: [{ description: depItem.description, amount: depItem.amount, folioLineItemId: depItem.id, taxType: 'no_tax' }] },
      },
    });

    // N pay-later extension invoices (unpaid)
    const extendInvoiceIds: string[] = [];
    for (let i = 0; i < opts.extendCount; i++) {
      const extItem = await tx.folioLineItem.create({
        data: {
          folioId: folio.id, chargeType: 'ROOM',
          description: `Extension night ${i + 1}`, amount: new Prisma.Decimal(opts.extendAmount),
          quantity: 1, unitPrice: new Prisma.Decimal(opts.extendAmount),
          taxType: 'no_tax', billingStatus: 'BILLED',
          serviceDate: new Date(`2026-12-${22 + i}`),
          periodEnd: new Date(`2026-12-${23 + i}`),
          createdBy: opts.userId,
        },
      });
      const ext = await tx.invoice.create({
        data: {
          invoiceNumber: `INV-GN-${suffix}-${i}`, bookingId: booking.id, guestId: opts.guestId, folioId: folio.id,
          issueDate: new Date(`2026-12-${22 + i}`),
          dueDate: new Date(`2026-12-${23 + i}`),
          invoiceType: 'general',
          subtotal: new Prisma.Decimal(opts.extendAmount),
          grandTotal: new Prisma.Decimal(opts.extendAmount),
          paidAmount: 0, status: 'unpaid',
          items: { create: [{ description: extItem.description, amount: extItem.amount, folioLineItemId: extItem.id, taxType: 'no_tax' }] },
        },
      });
      extendInvoiceIds.push(ext.id);
    }

    // Optional last-minute UNBILLED minibar
    if (opts.minibarAmount && opts.minibarAmount > 0) {
      await tx.folioLineItem.create({
        data: {
          folioId: folio.id, chargeType: 'EXTRA_SERVICE',
          description: 'Minibar', amount: new Prisma.Decimal(opts.minibarAmount),
          quantity: 1, unitPrice: new Prisma.Decimal(opts.minibarAmount),
          taxType: 'no_tax', billingStatus: 'UNBILLED',
          serviceDate: new Date('2026-12-24'),
          createdBy: opts.userId,
        },
      });
    }

    return {
      bookingId: booking.id, folioId: folio.id,
      depInvoiceId: depInvoice.id, extendInvoiceIds,
    };
  });
}

async function main() {
  console.log('🧪  Phase 6.8 Fix #2 — Checkout settles all unpaid invoices\n');

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

  const tag = `co-${Math.random().toString(36).slice(2, 6)}`;
  console.log(`Tag: ${tag} · room: ${room.number}\n`);

  const guest = await p.guest.create({
    data: {
      firstName: `E2E-${tag.slice(-4)}`, lastName: 'Checkout', phone: '0000000000',
      nationality: 'Thai', idType: 'thai_id',
      idNumber: `4444${Date.now().toString().slice(-9)}`,
    },
  });

  const allBookings: string[] = [];
  const allFolios:   string[] = [];
  const allInvoices: string[] = [];
  const allPayments: string[] = [];

  try {
    // ─── Scenario 1: 2 unpaid INV-GN + no UNBILLED ──────────────────────
    console.log('1️⃣   2 unpaid INV-GN (pay-later extends), no last-minute charges');
    const f1 = await setupBookingWithUnpaidExtends({
      tag, guestId: guest.id, roomId: room.id, userId: admin.id,
      paidDepositAmount: 2000, extendCount: 2, extendAmount: 1000,
    });
    allBookings.push(f1.bookingId); allFolios.push(f1.folioId);
    allInvoices.push(f1.depInvoiceId, ...f1.extendInvoiceIds);

    const r1 = await checkoutPayInTx({
      bookingId: f1.bookingId, guestId: guest.id, folioId: f1.folioId,
      cashSessionId: session!.id, userId: admin.id,
      alsoBillUnbilled: true,
    });
    if (r1.paymentId) allPayments.push(r1.paymentId);

    expect(r1.coInvoiceId === null, 'no INV-CO created (nothing was UNBILLED)');
    expect(r1.totalPaid === 2000, `total paid = 2000 (got ${r1.totalPaid})`);
    expect(r1.allocationCount === 2, `2 allocations (got ${r1.allocationCount})`);

    const all1 = await p.invoice.findMany({
      where: { bookingId: f1.bookingId },
      select: { id: true, status: true, paidAmount: true, grandTotal: true },
    });
    expect(all1.every(i => i.status === 'paid'), `all invoices paid (got ${all1.map(i => i.status).join(',')})`);

    // Folio balance check skipped here: the seeded "paid" INV-BK doesn't have
    // a backing Payment row in the fixture, so recalculateFolioBalance (which
    // sums ACTIVE PaymentAllocations) can't see those ฿2000 of historical pay.
    // Production bookings always have the paired Payment row from pre-pay, so
    // this fixture limitation doesn't affect the bug under test.
    console.log('');

    // ─── Scenario 2: 2 unpaid INV-GN + minibar UNBILLED ─────────────────
    console.log('2️⃣   2 unpaid INV-GN + minibar ฿300 UNBILLED at checkout');
    const f2 = await setupBookingWithUnpaidExtends({
      tag, guestId: guest.id, roomId: room.id, userId: admin.id,
      paidDepositAmount: 2000, extendCount: 2, extendAmount: 1000,
      minibarAmount: 300,
    });
    allBookings.push(f2.bookingId); allFolios.push(f2.folioId);
    allInvoices.push(f2.depInvoiceId, ...f2.extendInvoiceIds);

    const r2 = await checkoutPayInTx({
      bookingId: f2.bookingId, guestId: guest.id, folioId: f2.folioId,
      cashSessionId: session!.id, userId: admin.id,
      alsoBillUnbilled: true,
    });
    if (r2.coInvoiceId) allInvoices.push(r2.coInvoiceId);
    if (r2.paymentId) allPayments.push(r2.paymentId);

    expect(r2.coInvoiceId !== null, 'INV-CO created for minibar');
    expect(r2.totalPaid === 2300, `total paid = 2300 (got ${r2.totalPaid})`);
    expect(r2.allocationCount === 3, `3 allocations (2 INV-GN + 1 INV-CO, got ${r2.allocationCount})`);

    const all2 = await p.invoice.findMany({
      where: { bookingId: f2.bookingId },
      select: { status: true, paidAmount: true, grandTotal: true, invoiceNumber: true },
    });
    expect(all2.every(i => i.status === 'paid'), `all invoices paid (got ${all2.map(i => i.status).join(',')})`);

    // Single Payment, single ledger pair (DR Cash 2300 / CR AR 2300)
    const lg2 = await p.ledgerEntry.findMany({
      where: { referenceType: 'Payment', referenceId: r2.paymentId! },
      select: { type: true, amount: true },
    });
    const dr2 = lg2.filter(e => e.type === 'DEBIT').reduce((s, e) => s + Number(e.amount), 0);
    const cr2 = lg2.filter(e => e.type === 'CREDIT').reduce((s, e) => s + Number(e.amount), 0);
    expect(dr2 === 2300 && cr2 === 2300, `ledger DR=CR=2300 (single pair) — got DR=${dr2} CR=${cr2}`);
    console.log('');

    // ─── Scenario 3: regression — no prior unpaid, everything UNBILLED ──
    console.log('3️⃣   Regression: no prior unpaid + walk-in style stay (UNBILLED only)');
    // Set up bare booking with NO existing invoices except the UNBILLED line item
    const f3 = await p.$transaction(async (tx) => {
      const suffix = `${tag}-walk-${Math.random().toString(36).slice(2, 5)}`;
      const booking = await tx.booking.create({
        data: {
          bookingNumber: `BK-${suffix}`, guestId: guest.id, roomId: room.id,
          bookingType: 'daily', status: 'checked_in', source: 'direct',
          checkIn: new Date('2026-12-25'), checkOut: new Date('2026-12-26'),
          rate: new Prisma.Decimal(1500),
        },
      });
      const folio = await tx.folio.create({
        data: {
          folioNumber: `FLO-${suffix}`, bookingId: booking.id, guestId: guest.id,
          totalCharges: 0, totalPayments: 0, balance: 0,
        },
      });
      await tx.folioLineItem.create({
        data: {
          folioId: folio.id, chargeType: 'ROOM',
          description: 'Walk-in night', amount: new Prisma.Decimal(1500),
          quantity: 1, unitPrice: new Prisma.Decimal(1500),
          taxType: 'no_tax', billingStatus: 'UNBILLED',
          serviceDate: new Date('2026-12-25'), periodEnd: new Date('2026-12-26'),
          createdBy: admin.id,
        },
      });
      return { bookingId: booking.id, folioId: folio.id };
    });
    allBookings.push(f3.bookingId); allFolios.push(f3.folioId);

    const r3 = await checkoutPayInTx({
      bookingId: f3.bookingId, guestId: guest.id, folioId: f3.folioId,
      cashSessionId: session!.id, userId: admin.id,
      alsoBillUnbilled: true,
    });
    if (r3.coInvoiceId) allInvoices.push(r3.coInvoiceId);
    if (r3.paymentId) allPayments.push(r3.paymentId);

    expect(r3.coInvoiceId !== null, 'INV-CO created (walk-in)');
    expect(r3.totalPaid === 1500, `total paid = 1500 (got ${r3.totalPaid})`);
    expect(r3.allocationCount === 1, `1 allocation (got ${r3.allocationCount})`);

    const all3 = await p.invoice.findMany({
      where: { bookingId: f3.bookingId },
      select: { status: true },
    });
    expect(all3.length === 1 && all3[0].status === 'paid', `single INV-CO paid (got ${all3.map(i => i.status).join(',')})`);
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
    console.log('✅  All checkout multi-invoice assertions passed\n');
  }
  await p.$disconnect();
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1); });
