/**
 * scripts/e2e-receipt-std.ts
 *
 * Comprehensive end-to-end harness that exercises every flow that
 * Receipt-Standardization touched, using the SAME service functions the
 * API routes use. No HTTP, no auth, no React — straight against the DB
 * inside one big rolled-back transaction so the DB stays clean.
 *
 * Each "scenario" is a numbered section; failures collected and printed
 * at the end so partial breaks are visible.
 *
 * Run:
 *   npx tsx scripts/e2e-receipt-std.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import {
  createFolio,
  addCharge,
  addNightlyRoomCharges,
  createInvoiceFromFolio,
  getFolioByBookingId,
  markLineItemsPaid,
} from '../src/services/folio.service';
import { createPayment } from '../src/services/payment.service';
import { generateBookingNumber } from '../src/services/invoice-number.service';

const prisma = new PrismaClient();

const failures: string[] = [];
function expect(cond: boolean, msg: string) {
  if (cond) { console.log(`    ✓ ${msg}`); }
  else      { console.log(`    ✗ ${msg}`); failures.push(msg); }
}

function dateAt(y: number, m: number, d: number): Date {
  const x = new Date(Date.UTC(y, m - 1, d));
  return x;
}

function fmtIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Open or reuse a cash session for the test cashier so cash payments
 * have a session to attach to.  Returns sessionId.
 */
async function ensureOpenSession(tx: Prisma.TransactionClient, userId: string): Promise<string> {
  // Pick any active CashBox
  const box = await tx.cashBox.findFirst({
    where: { isActive: true },
    select: { id: true, code: true, financialAccountId: true },
  });
  if (!box) throw new Error('No active CashBox — run scripts/seed-cash-boxes.mjs first');

  // Reuse open session if there is one (per user)
  const existing = await tx.cashSession.findFirst({
    where: { openedBy: userId, status: 'OPEN' },
    select: { id: true },
  });
  if (existing) return existing.id;

  const session = await tx.cashSession.create({
    data: {
      cashBoxId:        box.id,
      openedBy:         userId,
      openedByName:     'Test Cashier',
      openedAt:         new Date(),
      openingBalance:   new Prisma.Decimal(0),
      status:           'OPEN',
    },
    select: { id: true },
  });
  // Wire the box's currentSessionId pointer (the schema enforces this is set)
  await tx.cashBox.update({
    where: { id: box.id },
    data:  { currentSessionId: session.id },
  });
  return session.id;
}

async function main() {
  console.log('🧪  Receipt-Standardization E2E Test\n');

  // Pick fixture data from seeded values
  const guest = await prisma.guest.findFirst({ select: { id: true, firstName: true, lastName: true } });
  const room  = await prisma.room.findFirst({ where: { status: 'available' }, select: { id: true, number: true } });
  const user  = await prisma.user.findFirst({ select: { id: true, email: true } });
  if (!guest || !room || !user) throw new Error('Missing fixture data — need at least 1 guest, room, user');

  console.log('Fixtures:');
  console.log(`  Guest:  ${guest.firstName} ${guest.lastName} (${guest.id.slice(0, 8)})`);
  console.log(`  Room:   ${room.number} (${room.id.slice(0, 8)})`);
  console.log(`  User:   ${user.email}`);
  console.log('');

  let bookingId = '';
  let folioId   = '';

  // We can't roll back across awaits because prisma.$transaction has a 5s
  // default. Use one transaction per scenario; cleanup at the very end via
  // a teardown step that voids/deletes everything we created.
  const createdEntities = {
    bookingIds:       [] as string[],
    paymentIds:       [] as string[],
    folioIds:         [] as string[],
    cashSessionIds:   [] as string[],
    invoiceIds:       [] as string[],
  };

  try {

    // ─── Scenario 1: Booking with FULL pre-pay (cash) ─────────────────────
    console.log('1️⃣   Booking with FULL pre-pay (3 nights, cash)');
    const checkIn1  = dateAt(2026, 5, 1);
    const checkOut1 = dateAt(2026, 5, 4);   // 3 nights
    const rate1     = 1000;
    const total1    = rate1 * 3;

    await prisma.$transaction(async (tx) => {
      const sessionId = await ensureOpenSession(tx, user.id);
      createdEntities.cashSessionIds.push(sessionId);

      const bookingNumber = await generateBookingNumber(tx);
      const booking = await tx.booking.create({
        data: {
          bookingNumber,
          guestId:     guest.id,
          roomId:      room.id,
          bookingType: 'daily',
          status:      'confirmed',
          source:      'direct',
          checkIn:     checkIn1,
          checkOut:    checkOut1,
          rate:        new Prisma.Decimal(rate1),
        },
        select: { id: true, bookingNumber: true },
      });
      bookingId = booking.id;
      createdEntities.bookingIds.push(booking.id);

      const folio = await createFolio(tx, {
        bookingId: booking.id,
        guestId:   guest.id,
      });
      folioId = folio.folioId;
      createdEntities.folioIds.push(folio.folioId);

      await addNightlyRoomCharges(tx, {
        folioId:      folio.folioId,
        roomNumber:   room.number,
        startDate:    checkIn1,
        nights:       3,
        ratePerNight: rate1,
        taxType:      'no_tax',
        referenceType: 'booking',
        referenceId:   booking.id,
        createdBy:    user.id,
      });

      const invResult = await createInvoiceFromFolio(tx, {
        folioId:     folio.folioId,
        guestId:     guest.id,
        bookingId:   booking.id,
        invoiceType: 'BK',
        dueDate:     checkOut1,
        createdBy:   user.id,
      });
      if (!invResult) throw new Error('Scenario 1: createInvoiceFromFolio returned null');
      createdEntities.invoiceIds.push(invResult.invoiceId);

      const pay = await createPayment(tx, {
        idempotencyKey: `e2e-1-${booking.id}`,
        guestId:        guest.id,
        bookingId:      booking.id,
        amount:         invResult.grandTotal,
        paymentMethod:  'cash',
        paymentDate:    new Date(),
        cashSessionId:  sessionId,
        receivedBy:     user.id,
        allocations:    [{ invoiceId: invResult.invoiceId, amount: invResult.grandTotal }],
        createdBy:      user.id,
      });
      createdEntities.paymentIds.push(pay.id);
    });

    // Verify
    const items1 = await prisma.folioLineItem.findMany({
      where: { folioId },
      orderBy: { serviceDate: 'asc' },
      select: { description: true, quantity: true, amount: true, serviceDate: true, periodEnd: true, billingStatus: true, chargeType: true },
    });
    const room1Items = items1.filter(i => i.chargeType === 'ROOM');
    expect(room1Items.length === 3, `3 ROOM rows persisted (got ${room1Items.length})`);
    expect(room1Items.every(i => i.quantity === 1), 'every ROOM row has quantity=1');
    expect(room1Items.every(i => i.periodEnd !== null), 'every ROOM row has periodEnd set');
    expect(room1Items.every(i => i.billingStatus === 'PAID'), 'all rows marked PAID after createPayment');
    expect(room1Items[0].serviceDate?.toISOString().slice(0, 10) === '2026-05-01', 'first row serviceDate = 2026-05-01');
    expect(room1Items[0].periodEnd?.toISOString().slice(0, 10) === '2026-05-02', 'first row periodEnd   = 2026-05-02');
    console.log('');

    // ─── Scenario 2: Drag-resize extend +2 nights, then pay against INV-EX ─
    console.log('2️⃣   Drag-resize extend +2 nights → pay against existing INV-EX');
    let extInvoiceId = '';
    await prisma.$transaction(async (tx) => {
      // Mimic reservation/route.ts scenario D: addNightlyRoomCharges + createInvoiceFromFolio (no payment)
      const folio = await getFolioByBookingId(tx, bookingId);
      if (!folio) throw new Error('Scenario 2: folio gone');
      await tx.booking.update({
        where: { id: bookingId },
        data:  { checkOut: dateAt(2026, 5, 6) },  // +2 nights
      });
      await addNightlyRoomCharges(tx, {
        folioId:      folio.folioId,
        roomNumber:   room.number,
        startDate:    checkOut1,    // extension starts at OLD checkOut
        nights:       2,
        ratePerNight: rate1,
        taxType:      'no_tax',
        referenceType: 'booking',
        referenceId:   bookingId,
        notes:         'Drag-resize extension',
        createdBy:    user.id,
      });
      const invResult = await createInvoiceFromFolio(tx, {
        folioId:     folio.folioId,
        guestId:     guest.id,
        bookingId,
        invoiceType: 'EX',
        dueDate:     new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdBy:   user.id,
      });
      if (!invResult) throw new Error('Scenario 2: createInvoiceFromFolio returned null');
      extInvoiceId = invResult.invoiceId;
      createdEntities.invoiceIds.push(extInvoiceId);
    });

    // Verify INV-EX has 2 line items (only the extension)
    const extItems = await prisma.invoiceItem.findMany({
      where: { invoiceId: extInvoiceId },
      select: { description: true, amount: true, folioLineItem: { select: { serviceDate: true, periodEnd: true } } },
    });
    expect(extItems.length === 2, `INV-EX has 2 line items (got ${extItems.length})`);
    expect(extItems[0].folioLineItem?.serviceDate?.toISOString().slice(0,10) === '2026-05-04', 'INV-EX first item starts at OLD checkOut (2026-05-04)');

    // Now mimic POST /api/bookings/[id]/pay's NEW logic: allocate to existing unpaid invoices
    await prisma.$transaction(async (tx) => {
      const sessionId = await ensureOpenSession(tx, user.id);

      // The pay route's NEW behavior:
      const existingUnpaid = await tx.invoice.findMany({
        where: { bookingId, status: { in: ['unpaid', 'overdue', 'partial'] as never[] } },
        orderBy: { issueDate: 'asc' },
        select: { id: true, invoiceNumber: true, grandTotal: true, paidAmount: true },
      });
      expect(existingUnpaid.length === 1, `pay route sees 1 unpaid invoice (got ${existingUnpaid.length})`);
      expect(existingUnpaid[0].id === extInvoiceId, 'unpaid invoice IS our INV-EX');

      const allocations = existingUnpaid.map(inv => ({
        invoiceId: inv.id,
        amount:    Math.max(0, Number(inv.grandTotal) - Number(inv.paidAmount)),
      })).filter(a => a.amount > 0);
      const total = allocations.reduce((s, a) => s + a.amount, 0);
      expect(total === 2000, `extension owed = ฿2,000 (got ฿${total})`);

      const pay = await createPayment(tx, {
        idempotencyKey: `e2e-2-${bookingId}`,
        guestId:        guest.id,
        bookingId,
        amount:         total,
        paymentMethod:  'cash',
        paymentDate:    new Date(),
        cashSessionId:  sessionId,
        receivedBy:     user.id,
        allocations,
        createdBy:      user.id,
      });
      createdEntities.paymentIds.push(pay.id);
    });

    // Verify INV-EX is now paid
    const extInvAfter = await prisma.invoice.findUnique({
      where: { id: extInvoiceId },
      select: { status: true, paidAmount: true, grandTotal: true },
    });
    expect(extInvAfter?.status === 'paid', `INV-EX status=paid (got ${extInvAfter?.status})`);
    expect(Number(extInvAfter?.paidAmount) === Number(extInvAfter?.grandTotal), 'INV-EX fully paid');
    console.log('');

    // ─── Scenario 3: Receipt builder (read invoice items, expect per-night) ─
    console.log('3️⃣   Receipt for the extension payment shows ONLY extension nights');
    const receiptItems = await prisma.invoiceItem.findMany({
      where: { invoiceId: extInvoiceId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        description: true,
        amount:      true,
        folioLineItem: { select: { quantity: true, unitPrice: true, serviceDate: true, periodEnd: true } },
      },
    });
    expect(receiptItems.length === 2, '2 receipt rows for the extension');
    expect(
      receiptItems.every(i => i.folioLineItem?.serviceDate && i.folioLineItem.periodEnd),
      'every row carries serviceDate + periodEnd from the linked FolioLineItem'
    );
    const startDates = receiptItems.map(i => i.folioLineItem?.serviceDate?.toISOString().slice(0,10)).sort();
    expect(startDates[0] === '2026-05-04' && startDates[1] === '2026-05-05',
      `extension rows = 2026-05-04 + 2026-05-05 (got ${startDates.join(', ')})`);
    console.log('');

    // ─── Scenario 4: Active payments grouped by paymentMethod (finance API) ─
    console.log('4️⃣   payment.groupBy returns non-zero for cash');
    const groups = await prisma.payment.groupBy({
      by: ['paymentMethod'],
      where: { status: 'ACTIVE', bookingId },
      _sum: { amount: true },
    });
    const cashSum = Number(groups.find(g => g.paymentMethod === 'cash')?._sum.amount ?? 0);
    expect(cashSum === 5000, `cash payments for this booking total ฿5,000 (got ฿${cashSum})`);
    console.log('');

    // ─── Scenario 5: Bank account auto-default lookup ─────────────────────
    console.log('5️⃣   ReceivingAccountPicker default lookup');
    const banks = await prisma.financialAccount.findMany({
      where: { isActive: true, subKind: 'BANK' },
      select: { id: true, isDefault: true, name: true },
    });
    if (banks.length === 0) {
      console.log('    ⚠  no BANK-subKind accounts — picker would show empty list. Seed at least one BANK account in /settings/accounts.');
    } else {
      const def = banks.find(b => b.isDefault) ?? (banks.length === 1 ? banks[0] : null);
      expect(def !== null, `picker would auto-select (have ${banks.length} BANK account${banks.length>1?'s':''}, default=${banks.find(b=>b.isDefault)?.name ?? '<none>'})`);
    }
    console.log('');

  } finally {
    // ─── Teardown: void/delete everything we created ───────────────────────
    console.log('🧹  Tearing down test fixtures…');
    if (createdEntities.paymentIds.length > 0) {
      await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: createdEntities.paymentIds } } });
      await prisma.payment.deleteMany({ where: { id: { in: createdEntities.paymentIds } } });
    }
    if (createdEntities.invoiceIds.length > 0) {
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: createdEntities.invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: createdEntities.invoiceIds } } });
    }
    if (createdEntities.folioIds.length > 0) {
      await prisma.folioLineItem.deleteMany({ where: { folioId: { in: createdEntities.folioIds } } });
      await prisma.folio.deleteMany({ where: { id: { in: createdEntities.folioIds } } });
    }
    if (createdEntities.bookingIds.length > 0) {
      await prisma.activityLog.deleteMany({ where: { bookingId: { in: createdEntities.bookingIds } } });
      await prisma.booking.deleteMany({ where: { id: { in: createdEntities.bookingIds } } });
    }
    if (createdEntities.cashSessionIds.length > 0) {
      // Detach FK first
      await prisma.cashBox.updateMany({
        where: { currentSessionId: { in: createdEntities.cashSessionIds } },
        data:  { currentSessionId: null },
      });
      await prisma.cashSession.deleteMany({ where: { id: { in: createdEntities.cashSessionIds } } });
    }
    // Sequence numbers we minted (BK / INV / PAY / RCP) we leave — they're meant
    // to be monotonic and would gap-skip on the next real run anyway.
    console.log('   done.\n');
  }

  // ─── Result ─────────────────────────────────────────────────────────────
  if (failures.length === 0) {
    console.log('🎉  ALL ASSERTIONS PASSED');
  } else {
    console.log(`❌  ${failures.length} ASSERTION${failures.length === 1 ? '' : 'S'} FAILED:`);
    for (const f of failures) console.log(`   - ${f}`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error('\n💥  Fatal error during test run:');
    console.error(e);
    process.exitCode = 2;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
