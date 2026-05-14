/**
 * _verify-recurring-service.ts
 *
 * Unit-level assertions for recurring.service:
 *  - createRecurringCharge (happy path)
 *  - listActiveForBooking
 *  - listForCycle — full overlap, partial overlap (start mid-cycle, end mid-cycle),
 *                   no overlap (ends before cycle, starts after cycle)
 *  - cancelRecurringCharge — happy path, NOT_FOUND, ALREADY_CANCELLED
 *  - createRecurringCharge — validation: amount<=0, endDate<startDate
 *
 * All operations run inside a single $transaction that rolls back at the end
 * — no permanent test data left in the DB.
 *
 * npx tsx scripts/_verify-recurring-service.ts
 */

import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma';
import {
  createRecurringCharge,
  cancelRecurringCharge,
  listActiveForBooking,
  listForCycle,
  RecurringValidationError,
} from '../src/services/recurring.service';

// Cycle window used for all listForCycle assertions:
//   2026-06-12 – 2026-07-11  (30 days)
const CYCLE_START = new Date('2026-06-12T00:00:00.000Z');
const CYCLE_END   = new Date('2026-07-11T00:00:00.000Z');

async function main() {
  // Resolve a real room + booking to satisfy FK constraints.
  const room = await prisma.room.findFirstOrThrow({ select: { id: true, number: true } });
  const guest = await prisma.guest.create({
    data: {
      firstName:   'E2E-RecVerify',
      lastName:    'Service',
      nationality: 'TH',
      idNumber:    `VRY-RC-${Date.now()}`,
    },
  });
  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `VRY-RC-${Date.now().toString(36)}`,
      guestId:       guest.id,
      roomId:        room.id,
      bookingType:   'monthly_short',
      checkIn:       new Date('2026-05-12T00:00:00.000Z'),
      checkOut:      new Date('2026-09-25T00:00:00.000Z'),
      rate:          15000,
      status:        'checked_in',
      source:        'walkin',
    },
  });

  try {
    await prisma.$transaction(async (tx) => {
      console.log('\n  ── createRecurringCharge ──────────────────────────────────────');

      // 1) Happy path — full overlap (startDate before cycle, no endDate)
      const rc1 = await createRecurringCharge(tx, {
        bookingId:   booking.id,
        chargeType:  'EXTRA_SERVICE',
        description: 'เช่า TV',
        amount:      500,
        startDate:   new Date('2026-06-01T00:00:00.000Z'),
        createdBy:   'verify-script',
      });
      assert.strictEqual(rc1.status, 'active');
      assert.strictEqual(Number(rc1.amount), 500);
      assert.ok(!rc1.endDate, 'rc1 endDate is null (no end)');
      console.log('    ✓ create rc1 (เช่า TV, 500, no end) — active');

      // 2) Ends before cycle — should NOT appear in listForCycle
      const rc2 = await createRecurringCharge(tx, {
        bookingId:   booking.id,
        chargeType:  'EXTRA_SERVICE',
        description: 'Old Service',
        amount:      200,
        startDate:   new Date('2026-04-01T00:00:00.000Z'),
        endDate:     new Date('2026-06-10T00:00:00.000Z'),  // ends before CYCLE_START
        createdBy:   'verify-script',
      });
      assert.strictEqual(rc2.status, 'active');
      console.log('    ✓ create rc2 (ends before cycle) — active');

      // 3) Starts after cycle — should NOT appear in listForCycle
      const rc3 = await createRecurringCharge(tx, {
        bookingId:   booking.id,
        chargeType:  'OTHER',
        description: 'Future Service',
        amount:      300,
        startDate:   new Date('2026-07-12T00:00:00.000Z'),  // starts after CYCLE_END
        createdBy:   'verify-script',
      });
      assert.strictEqual(rc3.status, 'active');
      console.log('    ✓ create rc3 (starts after cycle) — active');

      // 4) Partial overlap — starts mid-cycle (2026-06-20)
      const rc4 = await createRecurringCharge(tx, {
        bookingId:   booking.id,
        chargeType:  'EXTRA_SERVICE',
        description: 'Internet',
        amount:      800,
        startDate:   new Date('2026-06-20T00:00:00.000Z'),  // starts mid-cycle
        createdBy:   'verify-script',
      });
      console.log('    ✓ create rc4 (Internet, starts mid-cycle) — active');

      // 5) Partial overlap — ends mid-cycle (2026-06-25)
      const rc5 = await createRecurringCharge(tx, {
        bookingId:   booking.id,
        chargeType:  'EXTRA_SERVICE',
        description: 'Expiring Service',
        amount:      400,
        startDate:   new Date('2026-06-01T00:00:00.000Z'),
        endDate:     new Date('2026-06-25T00:00:00.000Z'),  // ends mid-cycle
        createdBy:   'verify-script',
      });
      console.log('    ✓ create rc5 (ends mid-cycle 2026-06-25) — active');

      console.log('\n  ── listActiveForBooking ───────────────────────────────────────');

      const activeList = await listActiveForBooking(tx, booking.id);
      assert.strictEqual(activeList.length, 5, `expected 5 active, got ${activeList.length}`);
      console.log(`    ✓ listActiveForBooking: 5 active charges`);

      console.log('\n  ── listForCycle (full overlap) ────────────────────────────────');

      // rc1: startDate=2026-06-01 <= CYCLE_END, no endDate → overlaps
      // rc2: endDate=2026-06-10 < CYCLE_START=2026-06-12 → does NOT overlap
      // rc3: startDate=2026-07-12 > CYCLE_END=2026-07-11 → does NOT overlap
      // rc4: startDate=2026-06-20 <= CYCLE_END, no endDate → overlaps (partial)
      // rc5: startDate=2026-06-01 <= CYCLE_END, endDate=2026-06-25 >= CYCLE_START → overlaps (partial)
      const cycleList = await listForCycle(tx, booking.id, CYCLE_START, CYCLE_END);
      assert.strictEqual(cycleList.length, 3, `expected 3 in cycle, got ${cycleList.length}`);
      const cycleIds = cycleList.map((r) => r.id);
      assert.ok(cycleIds.includes(rc1.id), 'rc1 (full overlap) in cycle list');
      assert.ok(!cycleIds.includes(rc2.id), 'rc2 (ends before) NOT in cycle list');
      assert.ok(!cycleIds.includes(rc3.id), 'rc3 (starts after) NOT in cycle list');
      assert.ok(cycleIds.includes(rc4.id), 'rc4 (starts mid-cycle) in cycle list');
      assert.ok(cycleIds.includes(rc5.id), 'rc5 (ends mid-cycle) in cycle list');
      console.log('    ✓ listForCycle: 3 overlapping charges (rc1, rc4, rc5)');
      console.log('    ✓ rc2 (ends before cycle) excluded');
      console.log('    ✓ rc3 (starts after cycle) excluded');

      console.log('\n  ── cancelRecurringCharge ──────────────────────────────────────');

      // Cancel rc1
      await cancelRecurringCharge(tx, rc1.id, 'verify-script');
      const rc1After = await tx.recurringCharge.findUniqueOrThrow({
        where: { id: rc1.id },
        select: { status: true, cancelledAt: true, cancelledBy: true },
      });
      assert.strictEqual(rc1After.status, 'cancelled');
      assert.ok(rc1After.cancelledAt instanceof Date);
      assert.strictEqual(rc1After.cancelledBy, 'verify-script');
      console.log('    ✓ cancel rc1 — status=cancelled, cancelledAt set');

      // listForCycle should now exclude rc1
      const cycleAfterCancel = await listForCycle(tx, booking.id, CYCLE_START, CYCLE_END);
      assert.strictEqual(cycleAfterCancel.length, 2, `expected 2 after cancel, got ${cycleAfterCancel.length}`);
      assert.ok(!cycleAfterCancel.map((r) => r.id).includes(rc1.id), 'cancelled rc1 excluded from cycle');
      console.log('    ✓ listForCycle after cancel: 2 results (rc4, rc5), rc1 excluded');

      // ALREADY_CANCELLED
      await assert.rejects(
        () => cancelRecurringCharge(tx, rc1.id, 'verify-script'),
        (e: unknown) => e instanceof RecurringValidationError && e.code === 'ALREADY_CANCELLED',
      );
      console.log('    ✓ double-cancel throws ALREADY_CANCELLED');

      // NOT_FOUND
      await assert.rejects(
        () => cancelRecurringCharge(tx, '00000000-0000-0000-0000-000000000000', 'verify-script'),
        (e: unknown) => e instanceof RecurringValidationError && e.code === 'NOT_FOUND',
      );
      console.log('    ✓ cancel non-existent throws NOT_FOUND');

      console.log('\n  ── Validation errors ──────────────────────────────────────────');

      // amount <= 0
      await assert.rejects(
        () => createRecurringCharge(tx, {
          bookingId:   booking.id,
          chargeType:  'EXTRA_SERVICE',
          description: 'Bad',
          amount:      0,
          startDate:   new Date(),
          createdBy:   'verify-script',
        }),
        (e: unknown) => e instanceof RecurringValidationError && e.code === 'INVALID_DATES',
      );
      console.log('    ✓ amount=0 throws INVALID_DATES');

      await assert.rejects(
        () => createRecurringCharge(tx, {
          bookingId:   booking.id,
          chargeType:  'EXTRA_SERVICE',
          description: 'Negative',
          amount:      -100,
          startDate:   new Date(),
          createdBy:   'verify-script',
        }),
        (e: unknown) => e instanceof RecurringValidationError && e.code === 'INVALID_DATES',
      );
      console.log('    ✓ amount<0 throws INVALID_DATES');

      // endDate < startDate
      await assert.rejects(
        () => createRecurringCharge(tx, {
          bookingId:   booking.id,
          chargeType:  'EXTRA_SERVICE',
          description: 'BadDates',
          amount:      100,
          startDate:   new Date('2026-07-01T00:00:00.000Z'),
          endDate:     new Date('2026-06-01T00:00:00.000Z'),  // end before start
          createdBy:   'verify-script',
        }),
        (e: unknown) => e instanceof RecurringValidationError && e.code === 'INVALID_DATES',
      );
      console.log('    ✓ endDate < startDate throws INVALID_DATES');

      // Roll back all test data
      throw new Error('__rollback__');
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === '__rollback__') {
      // expected — just roll back
    } else {
      throw e;
    }
  } finally {
    // Clean up the booking/guest we created outside the transaction
    await prisma.booking.delete({ where: { id: booking.id } });
    await prisma.guest.delete({ where: { id: guest.id } });
  }

  console.log('\n✅  All assertions passed — _verify-recurring-service\n');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
