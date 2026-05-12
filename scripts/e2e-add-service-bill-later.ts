/**
 * Phase 6.11 — Add-service "ลงบิลไว้ก่อน" creates INV-EX
 *
 * Reproduction (BK-BK-2026-0017 in the user's report):
 *   1. Booking is checked_in with existing invoices
 *   2. Cashier adds minibar via 🛒 add-service → picks "ลงบิลไว้ก่อน"
 *      (collectNow=false)
 *   3. Bill tab shows NO new minibar invoice — the FolioLineItem rows are
 *      added but stay UNBILLED with no invoice attached
 *   4. Cashier has no row to pay against until checkout bundles them into
 *      INV-CO
 *
 * Fix: hoist createInvoiceFromFolio out of the collectNow guard so an
 * INV-EX is always cut, status=unpaid when pay-later, status=paid when
 * collectNow. Mirror of Phase 6.7 (extend) and 6.9 (check-in) fixes.
 *
 * Scenarios:
 *   1. Add minibar (1 item) + collectNow=false → 1 invoice (unpaid),
 *      0 payment, line items BILLED, follow-up payment works
 *   2. Add 3 cart items + collectNow=true (cash) → 1 invoice (paid),
 *      1 payment, ledger DR=CR (regression — unchanged behaviour)
 *   3. Add 2 items + collectNow=false → both line items in same INV-EX
 *
 *   npx tsx scripts/e2e-add-service-bill-later.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { createPayment } from '../src/services/payment.service';
import { addCharge, createInvoiceFromFolio, recalculateFolioBalance } from '../src/services/folio.service';

const p = new PrismaClient();
const failures: string[] = [];
function expect(c: boolean, m: string) {
  if (c) console.log(`    ✓ ${m}`);
  else   { console.log(`    ✗ ${m}`); failures.push(m); }
}

/** Mirror of the add-service route's tx body (both branches gated by collectNow). */
async function addServiceInTx(opts: {
  bookingId: string;
  guestId: string;
  folioId: string;
  bookingNumber: string;
  items: Array<{ description: string; quantity: number; unitPrice: number }>;
  collectNow: boolean;
  paymentMethod?: 'cash';
  cashSessionId?: string;
  userId: string;
}) {
  return p.$transaction(async (tx) => {
    const lineItemIds: string[] = [];
    for (const item of opts.items) {
      const amount = +(item.quantity * item.unitPrice).toFixed(2);
      const { lineItemId } = await addCharge(tx, {
        folioId:    opts.folioId,
        chargeType: 'EXTRA_SERVICE',
        description: item.description,
        amount,
        quantity:   item.quantity,
        unitPrice:  item.unitPrice,
        createdBy:  opts.userId,
      });
      lineItemIds.push(lineItemId);
    }

    const totalAmount = +opts.items.reduce((s, it) => s + it.quantity * it.unitPrice, 0).toFixed(2);

    // Phase 6.11 — always cut INV-EX
    const invResult = totalAmount > 0
      ? await createInvoiceFromFolio(tx, {
          folioId:     opts.folioId,
          guestId:     opts.guestId,
          bookingId:   opts.bookingId,
          invoiceType: 'EX',
          dueDate:     new Date(),
          notes:       `E2E add-service — BK-${opts.bookingNumber}`,
          createdBy:   opts.userId,
          lineItemIds,
        })
      : null;

    let paymentId: string | null = null;
    if (opts.collectNow && invResult && opts.paymentMethod) {
      await tx.invoice.update({
        where: { id: invResult.invoiceId },
        data:  { paidAmount: new Prisma.Decimal(invResult.grandTotal), status: 'paid' },
      });
      const pay = await createPayment(tx, {
        idempotencyKey: `e2e-add-${opts.bookingId}-${Date.now()}`,
        guestId:        opts.guestId,
        bookingId:      opts.bookingId,
        amount:         invResult.grandTotal,
        paymentMethod:  opts.paymentMethod,
        paymentDate:    new Date(),
        receivedBy:     opts.userId,
        cashSessionId:  opts.cashSessionId,
        allocations:    [{ invoiceId: invResult.invoiceId, amount: invResult.grandTotal }],
        createdBy:      opts.userId,
      });
      paymentId = pay.id;
    }

    await recalculateFolioBalance(tx, opts.folioId);

    return {
      lineItemIds,
      invoiceId: invResult?.invoiceId ?? null,
      grandTotal: invResult?.grandTotal ?? 0,
      paymentId,
    };
  });
}

async function setupCheckedInBooking(opts: {
  tag: string;
  guestId: string;
  roomId: string;
  userId: string;
}) {
  return p.$transaction(async (tx) => {
    const suffix = `${opts.tag}-${Math.random().toString(36).slice(2, 5)}`;
    const booking = await tx.booking.create({
      data: {
        bookingNumber: `${suffix}`,
        guestId: opts.guestId, roomId: opts.roomId,
        bookingType: 'daily', status: 'checked_in', source: 'direct',
        checkIn: new Date('2026-12-29'), checkOut: new Date('2026-12-30'),
        rate: new Prisma.Decimal(2000),
      },
    });
    const folio = await tx.folio.create({
      data: {
        folioNumber: `FLO-${suffix}`, bookingId: booking.id, guestId: opts.guestId,
        totalCharges: 0, totalPayments: 0, balance: 0,
      },
    });
    return { bookingId: booking.id, folioId: folio.id, bookingNumber: suffix };
  });
}

async function main() {
  console.log('🧪  Phase 6.11 — Add-service "ลงบิลไว้ก่อน" creates INV-EX\n');

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

  const tag = `as-${Math.random().toString(36).slice(2, 6)}`;
  console.log(`Tag: ${tag} · room: ${room.number}\n`);

  const guest = await p.guest.create({
    data: {
      firstName: `E2E-${tag.slice(-4)}`, lastName: 'AddSvc', phone: '0000000000',
      nationality: 'Thai', idType: 'thai_id',
      idNumber: `2222${Date.now().toString().slice(-9)}`,
    },
  });

  const allBookings: string[] = [];
  const allFolios:   string[] = [];
  const allInvoices: string[] = [];
  const allPayments: string[] = [];

  try {
    // ─── Scenario 1: single item, bill later ────────────────────────────
    console.log('1️⃣   Minibar 1 รายการ, collectNow=false');
    const f1 = await setupCheckedInBooking({ tag, guestId: guest.id, roomId: room.id, userId: admin.id });
    allBookings.push(f1.bookingId); allFolios.push(f1.folioId);

    const r1 = await addServiceInTx({
      bookingId: f1.bookingId, guestId: guest.id, folioId: f1.folioId,
      bookingNumber: f1.bookingNumber,
      items: [{ description: 'Minibar — น้ำดื่ม', quantity: 1, unitPrice: 150 }],
      collectNow: false, userId: admin.id,
    });
    if (r1.invoiceId) allInvoices.push(r1.invoiceId);

    expect(r1.invoiceId !== null, `invoice created (got id ${r1.invoiceId ? '✓' : 'null'})`);
    expect(r1.grandTotal === 150, `grandTotal = 150 (got ${r1.grandTotal})`);
    expect(r1.paymentId === null, 'no payment when pay-later');

    const inv1 = await p.invoice.findUniqueOrThrow({
      where: { id: r1.invoiceId! },
      select: { status: true, paidAmount: true, invoiceType: true,
                items: { select: { folioLineItem: { select: { billingStatus: true } } } } },
    });
    expect(inv1.status === 'unpaid', `invoice unpaid (got ${inv1.status})`);
    expect(Number(inv1.paidAmount) === 0, `paidAmount = 0`);
    const allBilled = inv1.items.every(it => it.folioLineItem?.billingStatus === ('BILLED' as never));
    expect(allBilled, 'line item flipped UNBILLED → BILLED via invoice');

    // Follow-up payment to confirm the new invoice is collectible
    console.log('\n    └── pay the unpaid INV-EX later');
    const pay = await p.$transaction((tx) => createPayment(tx, {
      idempotencyKey: `${tag}-followup`,
      guestId: guest.id, bookingId: f1.bookingId,
      amount: 150, paymentMethod: 'cash', paymentDate: new Date(),
      receivedBy: admin.id, cashSessionId: session!.id,
      allocations: [{ invoiceId: r1.invoiceId!, amount: 150 }],
      createdBy: admin.id,
    }));
    allPayments.push(pay.id);
    const inv1After = await p.invoice.findUniqueOrThrow({
      where: { id: r1.invoiceId! },
      select: { status: true, paidAmount: true },
    });
    expect(inv1After.status === 'paid', `flips paid after follow-up (got ${inv1After.status})`);
    console.log('');

    // ─── Scenario 2: multi item, collect now (regression) ───────────────
    console.log('2️⃣   3 รายการ, collectNow=true cash');
    const room2 = (await p.room.findFirst({ where: { status: 'available', id: { not: room.id } } })) ?? room;
    const f2 = await setupCheckedInBooking({ tag: `${tag}-b`, guestId: guest.id, roomId: room2.id, userId: admin.id });
    allBookings.push(f2.bookingId); allFolios.push(f2.folioId);

    const r2 = await addServiceInTx({
      bookingId: f2.bookingId, guestId: guest.id, folioId: f2.folioId,
      bookingNumber: f2.bookingNumber,
      items: [
        { description: 'Minibar — เบียร์', quantity: 2, unitPrice: 100 },
        { description: 'Minibar — ขนม',     quantity: 3, unitPrice: 50 },
        { description: 'Laundry',           quantity: 1, unitPrice: 200 },
      ],
      collectNow: true, paymentMethod: 'cash',
      cashSessionId: session!.id, userId: admin.id,
    });
    if (r2.invoiceId) allInvoices.push(r2.invoiceId);
    if (r2.paymentId) allPayments.push(r2.paymentId);

    expect(r2.invoiceId !== null, 'invoice created');
    expect(r2.grandTotal === 550, `grandTotal = 550 (200 + 150 + 200, got ${r2.grandTotal})`);
    expect(r2.paymentId !== null, 'payment created');

    const inv2 = await p.invoice.findUniqueOrThrow({
      where: { id: r2.invoiceId! },
      select: { status: true, paidAmount: true,
                items: { select: { id: true } } },
    });
    expect(inv2.status === 'paid', `invoice paid (got ${inv2.status})`);
    expect(Number(inv2.paidAmount) === 550, `paidAmount = 550`);
    expect(inv2.items.length === 3, `3 items on invoice (got ${inv2.items.length})`);

    const ledger2 = await p.ledgerEntry.findMany({
      where: { referenceType: 'Payment', referenceId: r2.paymentId! },
      select: { type: true, amount: true },
    });
    const dr2 = ledger2.filter(e => e.type === 'DEBIT').reduce((s, e) => s + Number(e.amount), 0);
    const cr2 = ledger2.filter(e => e.type === 'CREDIT').reduce((s, e) => s + Number(e.amount), 0);
    expect(dr2 === 550 && cr2 === 550, `DR=CR=550 (got DR=${dr2} CR=${cr2})`);
    console.log('');

    // ─── Scenario 3: 2 items bill later, both in same INV-EX ────────────
    console.log('3️⃣   2 รายการ, collectNow=false — both in one INV-EX');
    const room3 = (await p.room.findFirst({ where: { status: 'available', id: { notIn: [room.id, room2.id] } } })) ?? room;
    const f3 = await setupCheckedInBooking({ tag: `${tag}-c`, guestId: guest.id, roomId: room3.id, userId: admin.id });
    allBookings.push(f3.bookingId); allFolios.push(f3.folioId);

    const r3 = await addServiceInTx({
      bookingId: f3.bookingId, guestId: guest.id, folioId: f3.folioId,
      bookingNumber: f3.bookingNumber,
      items: [
        { description: 'Minibar — น้ำผลไม้', quantity: 1, unitPrice: 80 },
        { description: 'Minibar — ขนม',      quantity: 2, unitPrice: 60 },
      ],
      collectNow: false, userId: admin.id,
    });
    if (r3.invoiceId) allInvoices.push(r3.invoiceId);

    expect(r3.invoiceId !== null, 'invoice created (multi-item bill-later)');
    expect(r3.grandTotal === 200, `grandTotal = 200 (80 + 120, got ${r3.grandTotal})`);
    expect(r3.paymentId === null, 'no payment row');

    const inv3 = await p.invoice.findUniqueOrThrow({
      where: { id: r3.invoiceId! },
      select: { status: true, items: { select: { id: true } } },
    });
    expect(inv3.status === 'unpaid', `unpaid (got ${inv3.status})`);
    expect(inv3.items.length === 2, `2 line items bundled into 1 INV-EX (got ${inv3.items.length})`);

    // Folio shows the new unbilled charges as outstanding
    const folio3 = await p.folio.findUniqueOrThrow({
      where: { id: f3.folioId },
      select: { totalCharges: true, balance: true },
    });
    expect(Number(folio3.totalCharges) === 200, `folio.totalCharges = 200 (got ${folio3.totalCharges})`);
    expect(Number(folio3.balance) === 200, `folio.balance = 200 outstanding (got ${folio3.balance})`);
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
    console.log('✅  All add-service bill-later assertions passed\n');
  }
  await p.$disconnect();
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1); });
