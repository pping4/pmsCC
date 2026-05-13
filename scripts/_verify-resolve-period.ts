/* eslint-disable no-console */
import assert from 'node:assert/strict';
import { resolveNextPeriod } from '../src/services/billing.service';

function d(s: string): Date { return new Date(s + 'T00:00:00.000Z'); }

// Rolling — Cycle 1 starts at checkIn
{
  const r = resolveNextPeriod({
    bookingType: 'monthly_short',
    checkIn:  d('2026-05-12'),
    checkOut: d('2026-07-25'),
    cycleIndex: 1,
  });
  assert.strictEqual(r.start.toISOString().slice(0,10), '2026-05-12');
  assert.strictEqual(r.end.toISOString().slice(0,10),   '2026-06-11');
  assert.strictEqual(r.isPartial, false);
  console.log('✓ rolling cycle 1');
}

// Rolling — Cycle 2 (next anniversary)
{
  const r = resolveNextPeriod({
    bookingType: 'monthly_short',
    checkIn:  d('2026-05-12'),
    checkOut: d('2026-07-25'),
    cycleIndex: 2,
  });
  assert.strictEqual(r.start.toISOString().slice(0,10), '2026-06-12');
  assert.strictEqual(r.end.toISOString().slice(0,10),   '2026-07-11');
  assert.strictEqual(r.isPartial, false);
  console.log('✓ rolling cycle 2');
}

// Rolling — Cycle 3 (partial — checkout before full anniversary)
{
  const r = resolveNextPeriod({
    bookingType: 'monthly_short',
    checkIn:  d('2026-05-12'),
    checkOut: d('2026-07-25'),
    cycleIndex: 3,
  });
  assert.strictEqual(r.start.toISOString().slice(0,10), '2026-07-12');
  assert.strictEqual(r.end.toISOString().slice(0,10),   '2026-07-24');  // checkOut - 1 day
  assert.strictEqual(r.isPartial, true);
  console.log('✓ rolling cycle 3 partial');
}

// Calendar — Cycle 1 starts at checkIn, ends end-of-month
{
  const r = resolveNextPeriod({
    bookingType: 'monthly_long',
    checkIn:  d('2026-05-12'),
    checkOut: d('2026-07-25'),
    cycleIndex: 1,
  });
  assert.strictEqual(r.start.toISOString().slice(0,10), '2026-05-12');
  assert.strictEqual(r.end.toISOString().slice(0,10),   '2026-05-31');
  assert.strictEqual(r.isPartial, true);  // partial — didn't start on 1st
  console.log('✓ calendar cycle 1 partial-start');
}

// Calendar — Cycle 2 is a full calendar month
{
  const r = resolveNextPeriod({
    bookingType: 'monthly_long',
    checkIn:  d('2026-05-12'),
    checkOut: d('2026-07-25'),
    cycleIndex: 2,
  });
  assert.strictEqual(r.start.toISOString().slice(0,10), '2026-06-01');
  assert.strictEqual(r.end.toISOString().slice(0,10),   '2026-06-30');
  assert.strictEqual(r.isPartial, false);
  console.log('✓ calendar cycle 2 full');
}

// Calendar — Cycle 3 partial (checkout 25 Jul)
{
  const r = resolveNextPeriod({
    bookingType: 'monthly_long',
    checkIn:  d('2026-05-12'),
    checkOut: d('2026-07-25'),
    cycleIndex: 3,
  });
  assert.strictEqual(r.start.toISOString().slice(0,10), '2026-07-01');
  assert.strictEqual(r.end.toISOString().slice(0,10),   '2026-07-24');
  assert.strictEqual(r.isPartial, true);
  console.log('✓ calendar cycle 3 partial-end');
}

console.log('\nAll resolveNextPeriod assertions passed');
