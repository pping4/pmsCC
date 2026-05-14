/**
 * utility.service.ts
 *
 * Manages meter readings (water + electric) for monthly tenants.
 * All functions take a Prisma.TransactionClient — callers own the $transaction.
 *
 * Security checklist (CLAUDE.md):
 * ✅ All functions accept tx → called inside $transaction
 * ✅ select used on lookups — no full model leaks
 * ✅ Future-date guard on recordReading
 */

import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

// ─── Typed error class ───────────────────────────────────────────────────────

export type UtilityErrorCode = 'FUTURE_DATE' | 'BACKDATED';

export class UtilityValidationError extends Error {
  constructor(public code: UtilityErrorCode, msg: string) {
    super(msg);
    this.name = 'UtilityValidationError';
  }
}

export interface RecordReadingInput {
  roomId:        string;
  bookingId?:    string;
  readingDate:   Date;
  currWater:     number;
  currElectric:  number;
  waterRate?:    number;
  electricRate?: number;
  notes?:        string;
  recordedBy:    string;
}

/**
 * Record a meter reading for a room. Automatically fills prevWater / prevElectric
 * from the most recent prior reading for this room.
 *
 * Throws UtilityValidationError('FUTURE_DATE') if readingDate is in the future.
 * Throws UtilityValidationError('BACKDATED') if readingDate <= the most recent
 *   existing reading's date — back-dating would corrupt the prevWater/prevElectric
 *   snapshot on that later reading.
 *
 * Uses pg_advisory_xact_lock to serialize concurrent writes for the same room,
 * preventing two simultaneous calls from both passing the ordering check and
 * then one overwriting the other's prev* values.
 */
export async function recordReading(tx: Tx, input: RecordReadingInput) {
  if (input.readingDate.getTime() > Date.now()) {
    throw new UtilityValidationError('FUTURE_DATE', 'readingDate cannot be in the future');
  }

  // Serialize concurrent reads for the same room within the transaction.
  // hashtext() is stable per Postgres session so the same roomId always maps
  // to the same lock slot, while different roomIds use different slots.
  // $executeRaw avoids Prisma's void-deserialization error (pg_advisory_xact_lock returns void).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.roomId}))`;

  // Find the most recent reading for this room (no date filter) to enforce
  // append-only ordering. Readings must be strictly chronological because
  // prevWater/prevElectric are snapshot values captured at insert time — a
  // back-dated insertion cannot retroactively fix the later row's snapshot.
  const latestReading = await tx.utilityReading.findFirst({
    where: { roomId: input.roomId },
    orderBy: { readingDate: 'desc' },
    select: { currWater: true, currElectric: true, readingDate: true },
  });

  if (latestReading && latestReading.readingDate && input.readingDate <= latestReading.readingDate) {
    throw new UtilityValidationError(
      'BACKDATED',
      'readingDate must be after prior reading date',
    );
  }

  // prev* snapshot: the reading immediately before this one (for the prevWater/prevElectric fields)
  const prev = latestReading; // after the guard, latestReading.readingDate < input.readingDate

  return tx.utilityReading.create({
    data: {
      roomId:       input.roomId,
      bookingId:    input.bookingId,
      readingDate:  input.readingDate,
      currWater:    new Prisma.Decimal(input.currWater),
      currElectric: new Prisma.Decimal(input.currElectric),
      prevWater:    prev?.currWater    ?? new Prisma.Decimal(0),
      prevElectric: prev?.currElectric ?? new Prisma.Decimal(0),
      waterRate:    input.waterRate    !== undefined ? new Prisma.Decimal(input.waterRate)    : undefined,
      electricRate: input.electricRate !== undefined ? new Prisma.Decimal(input.electricRate) : undefined,
      notes:        input.notes,
      recordedBy:   input.recordedBy,
      recordedAt:   new Date(),
      recorded:     true,
    },
  });
}

/**
 * Find the most recent reading for a room strictly before a given date.
 * Returns null if no prior reading exists.
 */
export async function getLatestReadingBefore(tx: Tx, roomId: string, before: Date) {
  return tx.utilityReading.findFirst({
    where: { roomId, readingDate: { lt: before } },
    orderBy: { readingDate: 'desc' },
  });
}

/**
 * Retrieve all readings for a booking, ordered chronologically.
 */
export async function getReadingsForBooking(tx: Tx, bookingId: string) {
  return tx.utilityReading.findMany({
    where: { bookingId },
    orderBy: { readingDate: 'asc' },
  });
}
