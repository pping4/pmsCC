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
 * Throws if readingDate is in the future.
 */
export async function recordReading(tx: Tx, input: RecordReadingInput) {
  if (input.readingDate.getTime() > Date.now()) {
    throw new Error('readingDate cannot be in the future');
  }

  const prev = await tx.utilityReading.findFirst({
    where: {
      roomId: input.roomId,
      readingDate: { lt: input.readingDate },
    },
    orderBy: { readingDate: 'desc' },
    select: { currWater: true, currElectric: true },
  });

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
