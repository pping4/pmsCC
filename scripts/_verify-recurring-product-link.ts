/**
 * _verify-recurring-product-link.ts
 *
 * Verifies that RecurringCharge.productId FK works correctly:
 *  1. Create with productId → assert product relation populated on read-back
 *  2. Create with productId pointing to inactive product → assert throws INVALID_DATES
 *  3. Create with non-existent productId → assert throws INVALID_DATES
 *  4. Create without productId (manual entry) → still works, product is null
 *
 * All DB writes run inside a $transaction that rolls back — no permanent test data.
 *
 * npx tsx scripts/_verify-recurring-product-link.ts
 */

import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma';
import {
  createRecurringCharge,
  RecurringValidationError,
} from '../src/services/recurring.service';

async function main() {
  // ── Resolve room + create guest + booking (FK anchors) ─────────────────────
  const room = await prisma.room.findFirstOrThrow({ select: { id: true, number: true } });
  const guest = await prisma.guest.create({
    data: {
      firstName:   'E2E-RecProdLink',
      lastName:    'Verify',
      nationality: 'TH',
      idNumber:    `VRY-RPL-${Date.now()}`,
    },
  });
  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `VRY-RPL-${Date.now().toString(36)}`,
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

  // Create an active and an inactive product for the tests
  const activeProduct = await prisma.product.create({
    data: {
      code:     `TVRPL-${Date.now()}`,
      name:     'ค่าเช่า TV (test)',
      unit:     'เดือน',
      price:    500,
      active:   true,
      taxType:  'included',
      category: 'service',
    },
  });
  const inactiveProduct = await prisma.product.create({
    data: {
      code:     `TVOFF-${Date.now()}`,
      name:     'TV Discontinued (test)',
      unit:     'เดือน',
      price:    400,
      active:   false,
      taxType:  'included',
      category: 'service',
    },
  });

  try {
    await prisma.$transaction(async (tx) => {
      console.log('\n  ── Case 1: create with valid productId ────────────────────────');

      const rc1 = await createRecurringCharge(tx, {
        bookingId:   booking.id,
        productId:   activeProduct.id,
        chargeType:  'EXTRA_SERVICE',
        description: activeProduct.name,  // snapshot — product name at create time
        amount:      500,
        startDate:   new Date('2026-06-01T00:00:00.000Z'),
        createdBy:   'verify-script',
      });
      assert.strictEqual(rc1.status, 'active');
      assert.strictEqual(rc1.productId, activeProduct.id, 'productId stored on row');

      // Read back with product relation to verify FK resolves
      const rc1WithProduct = await tx.recurringCharge.findUniqueOrThrow({
        where:  { id: rc1.id },
        select: { productId: true, product: { select: { id: true, code: true, name: true } } },
      });
      assert.ok(rc1WithProduct.product !== null, 'product relation not null');
      assert.strictEqual(rc1WithProduct.product!.id, activeProduct.id, 'product.id matches');
      assert.strictEqual(rc1WithProduct.product!.name, activeProduct.name, 'product.name matches');
      console.log('    ✓ productId stored; product relation resolves on read-back');

      console.log('\n  ── Case 2: create with inactive productId → throws ────────────');

      await assert.rejects(
        () => createRecurringCharge(tx, {
          bookingId:   booking.id,
          productId:   inactiveProduct.id,
          chargeType:  'EXTRA_SERVICE',
          description: 'should fail',
          amount:      400,
          startDate:   new Date('2026-06-01T00:00:00.000Z'),
          createdBy:   'verify-script',
        }),
        (e: unknown) => e instanceof RecurringValidationError && e.code === 'INVALID_DATES',
      );
      console.log('    ✓ inactive productId throws RecurringValidationError(INVALID_DATES)');

      console.log('\n  ── Case 3: create with non-existent productId → throws ────────');

      await assert.rejects(
        () => createRecurringCharge(tx, {
          bookingId:   booking.id,
          productId:   '00000000-0000-0000-0000-000000000000',
          chargeType:  'EXTRA_SERVICE',
          description: 'should fail',
          amount:      300,
          startDate:   new Date('2026-06-01T00:00:00.000Z'),
          createdBy:   'verify-script',
        }),
        (e: unknown) => e instanceof RecurringValidationError && e.code === 'INVALID_DATES',
      );
      console.log('    ✓ non-existent productId throws RecurringValidationError(INVALID_DATES)');

      console.log('\n  ── Case 4: manual entry (no productId) → product null ─────────');

      const rc4 = await createRecurringCharge(tx, {
        bookingId:   booking.id,
        chargeType:  'OTHER',
        description: 'ค่าบริการพิเศษ',
        amount:      250,
        startDate:   new Date('2026-06-01T00:00:00.000Z'),
        createdBy:   'verify-script',
      });
      assert.strictEqual(rc4.productId, null, 'productId is null for manual entry');
      const rc4WithProduct = await tx.recurringCharge.findUniqueOrThrow({
        where:  { id: rc4.id },
        select: { product: { select: { id: true } } },
      });
      assert.strictEqual(rc4WithProduct.product, null, 'product relation null for manual entry');
      console.log('    ✓ no productId → productId=null, product relation=null');

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
    // Clean up data created outside the transaction
    await prisma.booking.delete({ where: { id: booking.id } });
    await prisma.guest.delete({ where: { id: guest.id } });
    await prisma.product.delete({ where: { id: activeProduct.id } });
    await prisma.product.delete({ where: { id: inactiveProduct.id } });
  }

  console.log('\n✅  All assertions passed — _verify-recurring-product-link\n');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
