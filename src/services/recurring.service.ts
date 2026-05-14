/**
 * recurring.service.ts
 *
 * CRUD + cycle-overlap query for RecurringCharge (TV, Internet, monthly services).
 *
 * All functions take a TransactionClient (tx) — callers MUST wrap in prisma.$transaction().
 * Money stored as Prisma.Decimal; never pass raw floats for amounts.
 */

import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

// ─── Error types ──────────────────────────────────────────────────────────────

export type RecurringErrorCode = 'NOT_FOUND' | 'ALREADY_CANCELLED' | 'INVALID_DATES';

export class RecurringValidationError extends Error {
  constructor(
    public code: RecurringErrorCode,
    msg: string,
  ) {
    super(msg);
    this.name = 'RecurringValidationError';
  }
}

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreateRecurringInput {
  bookingId:   string;
  chargeType:  'EXTRA_SERVICE' | 'OTHER';
  description: string;
  amount:      number;
  startDate:   Date;
  endDate?:    Date | null;
  notes?:      string;
  createdBy:   string;
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Create a new recurring charge for a booking.
 *
 * Validates:
 * - amount > 0
 * - endDate >= startDate (if provided)
 */
export async function createRecurringCharge(tx: Tx, input: CreateRecurringInput) {
  if (input.amount <= 0) {
    throw new RecurringValidationError('INVALID_DATES', 'amount must be > 0');
  }
  if (input.endDate && input.endDate < input.startDate) {
    throw new RecurringValidationError('INVALID_DATES', 'endDate must be >= startDate');
  }
  return tx.recurringCharge.create({
    data: {
      bookingId:   input.bookingId,
      chargeType:  input.chargeType,
      description: input.description,
      amount:      new Prisma.Decimal(input.amount),
      startDate:   input.startDate,
      endDate:     input.endDate ?? null,
      notes:       input.notes,
      createdBy:   input.createdBy,
      status:      'active',
    },
  });
}

/**
 * Soft-cancel a recurring charge.
 *
 * Throws NOT_FOUND if the charge doesn't exist.
 * Throws ALREADY_CANCELLED if already cancelled.
 */
export async function cancelRecurringCharge(
  tx: Tx,
  id: string,
  cancelledBy: string,
): Promise<void> {
  const existing = await tx.recurringCharge.findUnique({
    where:  { id },
    select: { status: true },
  });
  if (!existing) {
    throw new RecurringValidationError('NOT_FOUND', `RecurringCharge ${id} not found`);
  }
  if (existing.status === 'cancelled') {
    throw new RecurringValidationError('ALREADY_CANCELLED', 'Already cancelled');
  }
  await tx.recurringCharge.update({
    where: { id },
    data:  { status: 'cancelled', cancelledAt: new Date(), cancelledBy },
  });
}

/**
 * List all active recurring charges for a booking (ordered by startDate asc).
 */
export async function listActiveForBooking(tx: Tx, bookingId: string) {
  return tx.recurringCharge.findMany({
    where:   { bookingId, status: 'active' },
    orderBy: { startDate: 'asc' },
  });
}

/**
 * Returns recurring charges whose [startDate, endDate or +∞] range overlaps
 * the given cycle window [cycleStart, cycleEnd]. These are the lines that
 * should be added to the cycle's draft invoice.
 *
 * Overlap condition:
 *   charge.startDate <= cycleEnd
 *   AND (charge.endDate IS NULL OR charge.endDate >= cycleStart)
 */
export async function listForCycle(
  tx: Tx,
  bookingId: string,
  cycleStart: Date,
  cycleEnd: Date,
) {
  return tx.recurringCharge.findMany({
    where: {
      bookingId,
      status:    'active',
      startDate: { lte: cycleEnd },
      OR: [
        { endDate: null },
        { endDate: { gte: cycleStart } },
      ],
    },
    orderBy: { startDate: 'asc' },
  });
}
