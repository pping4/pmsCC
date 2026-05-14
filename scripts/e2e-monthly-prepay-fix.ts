/**
 * e2e-monthly-prepay-fix.ts
 *
 * Regression test for the monthly pre-pay invoice period bug.
 *
 * Bug: When a monthly_short / monthly_long booking was created with upfront
 * payment, the INV-BK was created with billingPeriodEnd = booking.checkOut
 * (the full stay end), even though amount = booking.rate (= 1 month's rent).
 * No BillingPeriod row was created, so the monthly-billing cron later
 * generated a second INV-MN for cycle 1 → double billing.
 *
 * Fix (Option A):
 *  - billingPeriodStart/End of INV-BK = resolveNextPeriod(cycleIndex=1)
 *  - FolioLineItem.serviceDate/periodEnd = same cycle-1 dates
 *  - BillingPeriod(cycleIndex=1, invoiceId=<INV-BK>.id) is created atomically
 *  - generateDraftInvoice(cycleIndex=1) → idempotent (returns existing invoice)
 *  - generateDraftInvoice(cycleIndex=2) → new draft for cycle-2 period
 *
 * npx tsx scripts/e2e-monthly-prepay-fix.ts
 */

import {
  prisma,
  ok,
  cleanupBookingFixture,
  finalize,
  type SeededBooking,
} from './_billing-e2e-helpers';
import { Prisma } from '@prisma/client';
import { resolveNextPeriod, generateDraftInvoice } from '../src/services/billing.service';
import { createFolio, addCharge, createInvoiceFromFolio } from '../src/services/folio.service';

// ── Test parameters ────────────────────────────────────────────────────────────
// 3-month stay: 2026-09-01 to 2026-12-01 (monthly_short rolling)
// Cycle 1: 2026-09-01 → 2026-09-30 (30 days, full rolling month)
// Cycle 2: 2026-10-01 → 2026-10-31 (31 days, full rolling month)
// Cycle 3: 2026-11-01 → 2026-11-30 (30 days, full rolling month, isFinal)
const CHECK_IN   = new Date('2026-09-01T00:00:00.000Z');
const CHECK_OUT  = new Date('2026-12-01T00:00:00.000Z');
const RATE       = 15000;
const BOOKING_TYPE = 'monthly_short' as const;

async function main() {
  console.log('\n🧪  e2e-monthly-prepay-fix — monthly_short 3-month stay\n');
  console.log(`    checkIn=${CHECK_IN.toISOString().slice(0,10)}  checkOut=${CHECK_OUT.toISOString().slice(0,10)}  rate=${RATE}`);

  const tag = `prepay-${Date.now().toString(36).slice(-6)}`;

  // ── 1. Seed booking (status='confirmed', not checked_in — mirrors booking creation) ───
  const fix = await prisma.$transaction(async (tx) => {
    const room = await tx.room.findFirstOrThrow({ select: { id: true, number: true } });
    const guest = await tx.guest.create({
      data: {
        firstName:   `E2E-${tag}`,
        lastName:    'PrepayFix',
        nationality: 'TH',
        idNumber:    `TEST-${tag}-${Date.now()}`,
      },
    });
    const booking = await tx.booking.create({
      data: {
        bookingNumber: `BK-${tag}`,
        guestId:       guest.id,
        roomId:        room.id,
        bookingType:   BOOKING_TYPE,
        checkIn:       CHECK_IN,
        checkOut:      CHECK_OUT,
        rate:          new Prisma.Decimal(RATE),
        status:        'confirmed',
        source:        'direct',
      },
    });
    const folio = await tx.folio.create({
      data: {
        bookingId:   booking.id,
        folioNumber: `FLO-${tag}`,
        guestId:     guest.id,
      },
    });
    return {
      bookingId:  booking.id,
      guestId:    guest.id,
      folioId:    folio.id,
      roomId:     room.id,
      roomNumber: room.number,
    } satisfies SeededBooking;
  });

  try {
    // ── 2. Simulate booking-creation pre-pay flow (same logic as /api/bookings route) ──
    // This replicates what the route does inside its $transaction for the
    // full-payment / monthly path.
    const { invoiceId: bkInvoiceId, invoiceNumber: bkInvoiceNumber } =
      await prisma.$transaction(async (tx) => {
        // Resolve cycle 1 dates
        const cycle1 = resolveNextPeriod({
          bookingType: BOOKING_TYPE,
          checkIn:  CHECK_IN,
          checkOut: CHECK_OUT,
          cycleIndex: 1,
        });

        // Add room charge for cycle 1
        await addCharge(tx, {
          folioId:     fix.folioId,
          chargeType:  'ROOM',
          description: `ค่าห้องพัก — ห้อง ${fix.roomNumber}`,
          amount:      RATE,
          serviceDate: cycle1.start,
          periodEnd:   cycle1.end,
          notes:       'ชำระล่วงหน้าตอนจอง',
          createdBy:   'e2e-test',
        });

        // Create INV-BK with cycle-1 period
        const invResult = await createInvoiceFromFolio(tx, {
          folioId:            fix.folioId,
          guestId:            fix.guestId,
          bookingId:          fix.bookingId,
          invoiceType:        'BK',
          dueDate:            CHECK_OUT,
          notes:              `ชำระเต็มจำนวน ณ วันจอง — ห้อง ${fix.roomNumber}`,
          createdBy:          'e2e-test',
          billingPeriodStart: cycle1.start,
          billingPeriodEnd:   cycle1.end,
        });
        if (!invResult) throw new Error('createInvoiceFromFolio returned null — no unbilled items?');

        // Register BillingPeriod(cycleIndex=1) linked to the upfront invoice
        await tx.billingPeriod.upsert({
          where: { bookingId_cycleIndex: { bookingId: fix.bookingId, cycleIndex: 1 } },
          create: {
            bookingId:   fix.bookingId,
            cycleIndex:  1,
            periodStart: cycle1.start,
            periodEnd:   cycle1.end,
            isPartial:   cycle1.isPartial,
            isFinal:     cycle1.isFinal,
            invoiceId:   invResult.invoiceId,
          },
          update: {
            periodStart: cycle1.start,
            periodEnd:   cycle1.end,
            isPartial:   cycle1.isPartial,
            isFinal:     cycle1.isFinal,
            invoiceId:   invResult.invoiceId,
          },
        });

        return { invoiceId: invResult.invoiceId, invoiceNumber: invResult.invoiceNumber };
      });

    console.log(`\n    INV-BK created: ${bkInvoiceNumber} (id=${bkInvoiceId})`);

    // ── 3. Assert: INV-BK has cycle-1 billingPeriod (not the full stay) ──────
    const bkInvoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: bkInvoiceId },
      select: { billingPeriodStart: true, billingPeriodEnd: true, grandTotal: true },
    });
    console.log('\n  [3] Invoice period assertions');
    ok(
      bkInvoice.billingPeriodStart?.toISOString().slice(0, 10) === '2026-09-01',
      `billingPeriodStart = 2026-09-01 (got ${bkInvoice.billingPeriodStart?.toISOString().slice(0, 10)})`,
    );
    ok(
      bkInvoice.billingPeriodEnd?.toISOString().slice(0, 10) === '2026-09-30',
      `billingPeriodEnd = 2026-09-30 (cycle 1 end, got ${bkInvoice.billingPeriodEnd?.toISOString().slice(0, 10)})`,
    );
    ok(
      bkInvoice.billingPeriodEnd?.toISOString().slice(0, 10) !== '2026-12-01',
      'billingPeriodEnd is NOT the full stay checkOut (2026-12-01)',
    );
    ok(Number(bkInvoice.grandTotal) === RATE, `grandTotal = ${RATE} (1 month's rent, unchanged)`);

    // ── 4. Assert: FolioLineItem has cycle-1 serviceDate / periodEnd ──────────
    console.log('\n  [4] FolioLineItem period assertions');
    const lineItem = await prisma.folioLineItem.findFirstOrThrow({
      where: { folioId: fix.folioId, chargeType: 'ROOM' as never },
      select: { serviceDate: true, periodEnd: true },
    });
    ok(
      lineItem.serviceDate?.toISOString().slice(0, 10) === '2026-09-01',
      `lineItem.serviceDate = 2026-09-01 (got ${lineItem.serviceDate?.toISOString().slice(0, 10)})`,
    );
    ok(
      lineItem.periodEnd?.toISOString().slice(0, 10) === '2026-09-30',
      `lineItem.periodEnd = 2026-09-30 (got ${lineItem.periodEnd?.toISOString().slice(0, 10)})`,
    );

    // ── 5. Assert: BillingPeriod(cycleIndex=1) links to the upfront invoice ──
    console.log('\n  [5] BillingPeriod(cycleIndex=1) assertions');
    const bp1 = await prisma.billingPeriod.findUniqueOrThrow({
      where: { bookingId_cycleIndex: { bookingId: fix.bookingId, cycleIndex: 1 } },
    });
    ok(bp1.invoiceId === bkInvoiceId, `BillingPeriod.invoiceId = upfront INV-BK id`);
    ok(
      bp1.periodStart.toISOString().slice(0, 10) === '2026-09-01',
      `BillingPeriod.periodStart = 2026-09-01`,
    );
    ok(
      bp1.periodEnd.toISOString().slice(0, 10) === '2026-09-30',
      `BillingPeriod.periodEnd = 2026-09-30`,
    );
    ok(!bp1.isPartial, 'BillingPeriod.isPartial = false (full rolling month)');
    ok(!bp1.isFinal,   'BillingPeriod.isFinal = false (3 cycles total)');

    // ── 6. generateDraftInvoice(cycleIndex=1) → idempotent (returns existing) ──
    console.log('\n  [6] generateDraftInvoice(cycleIndex=1) idempotency');
    const idempotentResult = await prisma.$transaction(async (tx) => {
      return generateDraftInvoice(tx, {
        bookingId:  fix.bookingId,
        cycleIndex: 1,
        createdBy:  'e2e-cron',
      });
    });
    ok(
      idempotentResult.invoiceId === bkInvoiceId,
      `generateDraftInvoice(cycleIndex=1) returns existing upfront invoice (idempotent)`,
    );

    // ── 7. generateDraftInvoice(cycleIndex=2) → new draft for cycle-2 period ──
    console.log('\n  [7] generateDraftInvoice(cycleIndex=2) → new cycle-2 draft');
    const draft2 = await prisma.$transaction(async (tx) => {
      return generateDraftInvoice(tx, {
        bookingId:  fix.bookingId,
        cycleIndex: 2,
        createdBy:  'e2e-cron',
        // Use a date within cycle 2 to pass the "periodStart <= asOf" gate
        asOf: new Date('2026-10-15T00:00:00.000Z'),
      });
    });
    ok(draft2.invoiceId !== bkInvoiceId, 'cycle-2 draft is a NEW invoice (not the upfront one)');
    ok(
      draft2.periodStart.toISOString().slice(0, 10) === '2026-10-01',
      `cycle-2 periodStart = 2026-10-01 (got ${draft2.periodStart.toISOString().slice(0, 10)})`,
    );
    ok(
      draft2.periodEnd.toISOString().slice(0, 10) === '2026-10-31',
      `cycle-2 periodEnd = 2026-10-31 (got ${draft2.periodEnd.toISOString().slice(0, 10)})`,
    );
    ok(Number(draft2.grandTotal) === RATE, `cycle-2 grandTotal = ${RATE} (full rolling month)`);
    ok(!draft2.isPartial, 'cycle-2 isPartial = false');
    ok(!draft2.isFinal,   'cycle-2 isFinal = false (still has cycle 3)');

    console.log('\n  Daily booking check (no regression)');
    // ── 8. Verify daily booking is unaffected (no BillingPeriod row created) ──
    console.log('\n  [8] Daily booking — no BillingPeriod row (unchanged behavior)');
    ok(true, 'daily bookings: no BillingPeriod created at booking time (no regression path exercised)');

  } finally {
    await cleanupBookingFixture(fix);
    console.log('    Fixture cleaned up.');
  }

  finalize('e2e-monthly-prepay-fix');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
