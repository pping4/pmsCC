/**
 * Phase 6.8 Fix #1 — Bill-tab per-invoice payment
 *
 * Reproduces the bug where clicking 💳 รับชำระเงิน on ONE unpaid invoice card
 * (a) opened the picker on every unpaid card simultaneously (UI bug), and
 * (b) sent a single amount = full booking total which the server then
 *     allocated across ALL unpaid invoices oldest-first (server bug).
 *
 * Fix: /api/bookings/[id]/pay accepts optional invoiceId — when present,
 * allocation is restricted to that invoice only. UI tracks billingPayInvoiceId
 * per row so the picker is scoped to the clicked card.
 *
 * E2E mirrors the route's tx body and verifies the new scoped behaviour:
 *   1. 3 unpaid invoices, pay the MIDDLE one → only middle flips paid
 *   2. 3 unpaid invoices, pay the FIRST one → only first flips paid
 *   3. Legacy path (no invoiceId) → all flip paid oldest-first (regression)
 *   4. Pay a non-existent invoiceId on this booking → throws
 *
 *   npx tsx scripts/e2e-bill-tab-per-invoice.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { createPayment } from '../src/services/payment.service';

const p = new PrismaClient();
const failures: string[] = [];
function expect(c: boolean, m: string) {
  if (c) console.log(`    ✓ ${m}`);
  else   { console.log(`    ✗ ${m}`); failures.push(m); }
}

/** Mirror of the route's tx body — filter unpaid invoices by optional invoiceId. */
async function payInTx(opts: {
  bookingId: string;
  guestId: string;
  cashSessionId: string;
  userId: string;
  targetInvoiceId?: string;   // Phase 6.8 — when set, scope to this invoice
}) {
  return p.$transaction(async (tx) => {
    const unpaid = await tx.invoice.findMany({
      where: {
        bookingId: opts.bookingId,
        ...(opts.targetInvoiceId ? { id: opts.targetInvoiceId } : {}),
        status: { in: ['unpaid', 'overdue', 'partial'] as never[] },
      },
      orderBy: { issueDate: 'asc' },
      select: { id: true, grandTotal: true, paidAmount: true, invoiceNumber: true },
    });
    if (opts.targetInvoiceId && unpaid.length === 0) {
      throw new Error('TARGET_INVOICE_NOT_FOUND');
    }
    const allocations = unpaid
      .map(inv => ({ invoiceId: inv.id, amount: Math.max(0, Number(inv.grandTotal) - Number(inv.paidAmount)) }))
      .filter(a => a.amount > 0);
    const total = allocations.reduce((s, a) => s + a.amount, 0);
    if (total <= 0) throw new Error('NOTHING_TO_PAY');

    const pay = await createPayment(tx, {
      idempotencyKey: `e2e-pay-${opts.bookingId}-${opts.targetInvoiceId ?? 'all'}-${Date.now()}`,
      guestId:        opts.guestId,
      bookingId:      opts.bookingId,
      amount:         total,
      paymentMethod:  'cash',
      paymentDate:    new Date(),
      receivedBy:     opts.userId,
      cashSessionId:  opts.cashSessionId,
      allocations,
      createdBy:      opts.userId,
    });
    return { paymentId: pay.id, total, allocationCount: allocations.length };
  });
}

async function setupBookingWith3Invoices(opts: {
  tag: string;
  guestId: string;
  roomId: string;
  userId: string;
}) {
  return p.$transaction(async (tx) => {
    const suffix = `${opts.tag}-${Math.random().toString(36).slice(2, 5)}`;
    const booking = await tx.booking.create({
      data: {
        bookingNumber: `BK-${suffix}`,
        guestId: opts.guestId, roomId: opts.roomId,
        bookingType: 'daily', status: 'checked_in', source: 'direct',
        checkIn: new Date('2026-12-15'), checkOut: new Date('2026-12-17'),
        rate: new Prisma.Decimal(2000),
      },
    });
    const folio = await tx.folio.create({
      data: {
        folioNumber: `FLO-${suffix}`, bookingId: booking.id, guestId: opts.guestId,
        totalCharges: new Prisma.Decimal(4000),
        totalPayments: 0,
        balance: new Prisma.Decimal(4000),
      },
    });
    // Three line items + three invoices (1 PAID, 2 UNPAID at different dates)
    const lineItemA = await tx.folioLineItem.create({
      data: {
        folioId: folio.id, chargeType: 'ROOM',
        description: 'Night 1', amount: new Prisma.Decimal(2000),
        quantity: 1, unitPrice: new Prisma.Decimal(2000),
        taxType: 'no_tax', billingStatus: 'PAID',
        serviceDate: new Date('2026-12-15'), periodEnd: new Date('2026-12-16'),
        createdBy: opts.userId,
      },
    });
    const lineItemB = await tx.folioLineItem.create({
      data: {
        folioId: folio.id, chargeType: 'EXTRA_SERVICE',
        description: 'Extra service B', amount: new Prisma.Decimal(1000),
        quantity: 1, unitPrice: new Prisma.Decimal(1000),
        taxType: 'no_tax', billingStatus: 'BILLED',
        serviceDate: new Date('2026-12-16'),
        createdBy: opts.userId,
      },
    });
    const lineItemC = await tx.folioLineItem.create({
      data: {
        folioId: folio.id, chargeType: 'EXTRA_SERVICE',
        description: 'Extra service C', amount: new Prisma.Decimal(1000),
        quantity: 1, unitPrice: new Prisma.Decimal(1000),
        taxType: 'no_tax', billingStatus: 'BILLED',
        serviceDate: new Date('2026-12-16'),
        createdBy: opts.userId,
      },
    });
    // INV-BK paid 2000 (oldest)
    const invA = await tx.invoice.create({
      data: {
        invoiceNumber: `INV-BK-${suffix}`, bookingId: booking.id, guestId: opts.guestId, folioId: folio.id,
        issueDate: new Date('2026-12-15T08:00:00Z'),
        dueDate:   new Date('2026-12-17'),
        invoiceType: 'deposit_receipt',
        subtotal: new Prisma.Decimal(2000), grandTotal: new Prisma.Decimal(2000),
        paidAmount: new Prisma.Decimal(2000), status: 'paid',
        items: { create: [{ description: lineItemA.description, amount: lineItemA.amount, folioLineItemId: lineItemA.id, taxType: 'no_tax' }] },
      },
    });
    // INV-GN unpaid 1000 (middle)
    const invB = await tx.invoice.create({
      data: {
        invoiceNumber: `INV-GN-B-${suffix}`, bookingId: booking.id, guestId: opts.guestId, folioId: folio.id,
        issueDate: new Date('2026-12-15T09:00:00Z'),
        dueDate:   new Date('2026-12-17'),
        invoiceType: 'general',
        subtotal: new Prisma.Decimal(1000), grandTotal: new Prisma.Decimal(1000),
        paidAmount: 0, status: 'unpaid',
        items: { create: [{ description: lineItemB.description, amount: lineItemB.amount, folioLineItemId: lineItemB.id, taxType: 'no_tax' }] },
      },
    });
    // INV-GN unpaid 1000 (newest)
    const invC = await tx.invoice.create({
      data: {
        invoiceNumber: `INV-GN-C-${suffix}`, bookingId: booking.id, guestId: opts.guestId, folioId: folio.id,
        issueDate: new Date('2026-12-15T10:00:00Z'),
        dueDate:   new Date('2026-12-17'),
        invoiceType: 'general',
        subtotal: new Prisma.Decimal(1000), grandTotal: new Prisma.Decimal(1000),
        paidAmount: 0, status: 'unpaid',
        items: { create: [{ description: lineItemC.description, amount: lineItemC.amount, folioLineItemId: lineItemC.id, taxType: 'no_tax' }] },
      },
    });
    return {
      bookingId: booking.id, folioId: folio.id,
      invA: invA.id, invB: invB.id, invC: invC.id,
    };
  });
}

async function main() {
  console.log('🧪  Phase 6.8 Fix #1 — Bill-tab per-invoice payment\n');

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

  const tag = `pi-${Math.random().toString(36).slice(2, 6)}`;
  console.log(`Tag: ${tag} · room: ${room.number}\n`);

  const guest = await p.guest.create({
    data: {
      firstName: `E2E-${tag.slice(-4)}`, lastName: 'BillTab', phone: '0000000000',
      nationality: 'Thai', idType: 'thai_id',
      idNumber: `5555${Date.now().toString().slice(-9)}`,
    },
  });

  const allBookings: string[] = [];
  const allFolios:   string[] = [];
  const allInvoices: string[] = [];
  const allPayments: string[] = [];

  try {
    // ─── Scenario 1: pay the MIDDLE invoice only ─────────────────────────
    console.log('1️⃣   3 invoices (1 paid, 2 unpaid) — pay the MIDDLE');
    const f1 = await setupBookingWith3Invoices({ tag, guestId: guest.id, roomId: room.id, userId: admin.id });
    allBookings.push(f1.bookingId); allFolios.push(f1.folioId);
    allInvoices.push(f1.invA, f1.invB, f1.invC);

    const r1 = await payInTx({
      bookingId: f1.bookingId, guestId: guest.id,
      cashSessionId: session!.id, userId: admin.id,
      targetInvoiceId: f1.invB,
    });
    allPayments.push(r1.paymentId);

    expect(r1.total === 1000, `total = 1000 (got ${r1.total})`);
    expect(r1.allocationCount === 1, `1 allocation (got ${r1.allocationCount})`);

    const after1ById = new Map(
      (await p.invoice.findMany({
        where: { id: { in: [f1.invA, f1.invB, f1.invC] } },
        select: { id: true, status: true, paidAmount: true },
      })).map(r => [r.id, r] as const),
    );
    const a1 = after1ById.get(f1.invA)!;
    const b1 = after1ById.get(f1.invB)!;
    const c1 = after1ById.get(f1.invC)!;
    expect(a1.status === 'paid' && Number(a1.paidAmount) === 2000, `INV-A still paid (got ${a1.status} ${a1.paidAmount})`);
    expect(b1.status === 'paid' && Number(b1.paidAmount) === 1000, `INV-B (target) flipped paid (got ${b1.status} ${b1.paidAmount})`);
    expect(c1.status === 'unpaid' && Number(c1.paidAmount) === 0, `INV-C still unpaid (got ${c1.status} ${c1.paidAmount})`);
    console.log('');

    // ─── Scenario 2: pay the FIRST unpaid (INV-C — wait we already paid B, let's pay C now) ─
    console.log('2️⃣   Now pay INV-C (the remaining unpaid)');
    const r2 = await payInTx({
      bookingId: f1.bookingId, guestId: guest.id,
      cashSessionId: session!.id, userId: admin.id,
      targetInvoiceId: f1.invC,
    });
    allPayments.push(r2.paymentId);

    expect(r2.total === 1000, `total = 1000`);
    expect(r2.allocationCount === 1, '1 allocation');

    const after2 = await p.invoice.findMany({
      where: { id: { in: [f1.invA, f1.invB, f1.invC] } },
      orderBy: { issueDate: 'asc' },
      select: { status: true },
    });
    expect(after2.every(i => i.status === 'paid'), `all 3 invoices paid (got ${after2.map(i => i.status).join(',')})`);
    console.log('');

    // ─── Scenario 3: legacy path (no invoiceId) — regression ─────────────
    console.log('3️⃣   Regression: no invoiceId → pay all outstanding oldest-first');
    const f3 = await setupBookingWith3Invoices({ tag: `${tag}-b`, guestId: guest.id, roomId: room.id, userId: admin.id });
    allBookings.push(f3.bookingId); allFolios.push(f3.folioId);
    allInvoices.push(f3.invA, f3.invB, f3.invC);

    const r3 = await payInTx({
      bookingId: f3.bookingId, guestId: guest.id,
      cashSessionId: session!.id, userId: admin.id,
      // targetInvoiceId omitted → legacy path
    });
    allPayments.push(r3.paymentId);

    expect(r3.total === 2000, `total = 2000 (both unpaid)`);
    expect(r3.allocationCount === 2, `2 allocations (got ${r3.allocationCount})`);

    const after3 = await p.invoice.findMany({
      where: { id: { in: [f3.invA, f3.invB, f3.invC] } },
      orderBy: { issueDate: 'asc' },
      select: { status: true },
    });
    expect(after3.every(i => i.status === 'paid'), 'all 3 paid after legacy pay-everything');
    console.log('');

    // ─── Scenario 4: invoiceId not on this booking → error ──────────────
    console.log('4️⃣   Defensive: targetInvoiceId not on this booking → throws');
    const f4 = await setupBookingWith3Invoices({ tag: `${tag}-c`, guestId: guest.id, roomId: room.id, userId: admin.id });
    allBookings.push(f4.bookingId); allFolios.push(f4.folioId);
    allInvoices.push(f4.invA, f4.invB, f4.invC);

    let didThrow = false;
    try {
      await payInTx({
        bookingId: f4.bookingId, guestId: guest.id,
        cashSessionId: session!.id, userId: admin.id,
        targetInvoiceId: f1.invA, // belongs to f1, not f4
      });
    } catch (e) {
      didThrow = (e instanceof Error) && e.message === 'TARGET_INVOICE_NOT_FOUND';
    }
    expect(didThrow, 'foreign invoiceId throws TARGET_INVOICE_NOT_FOUND');
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
    console.log('✅  All bill-tab per-invoice assertions passed\n');
  }
  await p.$disconnect();
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1); });
