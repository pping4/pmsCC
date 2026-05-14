import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma';
import { recordReading, getLatestReadingBefore } from '../src/services/utility.service';

async function main() {
  // Use a throwaway room — pick any existing or create
  const room = await prisma.room.findFirst({ select: { id: true } });
  if (!room) throw new Error('seed at least one Room first');

  await prisma.$transaction(async (tx) => {
    // First reading — prev defaults to 0
    const r1 = await recordReading(tx, {
      roomId: room.id,
      readingDate: new Date('2026-03-31T00:00:00.000Z'),
      currWater: 150,
      currElectric: 2200,
      recordedBy: 'test',
    });
    assert.strictEqual(Number(r1.prevWater), 0);
    assert.strictEqual(Number(r1.currWater), 150);

    // Second reading — prev should be 150 / 2200
    const r2 = await recordReading(tx, {
      roomId: room.id,
      readingDate: new Date('2026-04-30T00:00:00.000Z'),
      currWater: 165,
      currElectric: 2510,
      recordedBy: 'test',
    });
    assert.strictEqual(Number(r2.prevWater), 150);
    assert.strictEqual(Number(r2.prevElectric), 2200);

    // Lookup latest before mid-cycle
    const found = await getLatestReadingBefore(tx, room.id, new Date('2026-04-15T00:00:00.000Z'));
    assert.ok(found);
    assert.strictEqual(Number(found.currWater), 150);

    // Throw on future date
    await assert.rejects(() => recordReading(tx, {
      roomId: room.id,
      readingDate: new Date(Date.now() + 86400000),
      currWater: 200, currElectric: 3000, recordedBy: 'test',
    }), /readingDate cannot be in the future/);

    // Throw on back-dated reading (same date as existing reading)
    await assert.rejects(() => recordReading(tx, {
      roomId: room.id,
      readingDate: new Date('2026-04-30T00:00:00.000Z'),  // same date as r2
      currWater: 166, currElectric: 2511, recordedBy: 'test',
    }), /readingDate must be after prior reading date/);

    // Throw on reading earlier than an existing reading
    await assert.rejects(() => recordReading(tx, {
      roomId: room.id,
      readingDate: new Date('2026-04-01T00:00:00.000Z'),  // between r1 and r2
      currWater: 155, currElectric: 2300, recordedBy: 'test',
    }), /readingDate must be after prior reading date/);

    // Cleanup
    await tx.utilityReading.deleteMany({ where: { roomId: room.id, recordedBy: 'test' } });
  });

  console.log('✓ utility.service: record + latest-before + future-guard + back-date guard');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
