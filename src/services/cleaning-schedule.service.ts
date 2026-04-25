/**
 * cleaning-schedule.service.ts — Phase I / Sprint 2b
 *
 * CleaningSchedule is a recurrence spec for *monthly* bookings only.
 * The night audit cron iterates active schedules and calls
 * `generateTasksFromSchedule` on match.
 *
 * Invariants enforced here:
 *   - schedule must bind to a booking with bookingType ∈ {monthly_short, monthly_long}
 *   - exactly one of cadenceDays / weekdays must be non-null
 *   - activeFrom ≤ activeUntil when both given
 *
 * Soft-delete via isActive=false preserves history on tasks already created.
 */

import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export type HKPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface CreateScheduleInput {
  roomId:      string;
  bookingId:   string;                  // REQUIRED: schedules scope to a stay
  cadenceDays?: number | null;          // exclusive with weekdays
  weekdays?:   number | null;           // bitmask, Mon=1..Sun=64
  timeOfDay?:  string | null;           // "HH:mm"
  activeFrom:  Date;
  activeUntil?: Date | null;
  fee?:        number | null;
  chargeable?: boolean;
  notes?:      string | null;
  priority?:   HKPriority;
  createdBy?:  string | null;
}

export class ScheduleValidationError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ScheduleValidationError'; }
}

export async function createSchedule(
  tx: Tx,
  input: CreateScheduleInput,
): Promise<{ id: string }> {
  // Exactly one recurrence rule
  const hasCadence  = !!(input.cadenceDays && input.cadenceDays > 0);
  const hasWeekdays = !!(input.weekdays    && input.weekdays    > 0);
  if (hasCadence === hasWeekdays) {
    throw new ScheduleValidationError('ต้องเลือกรูปแบบใดรูปแบบหนึ่ง: cadenceDays หรือ weekdays');
  }
  if (input.activeUntil && input.activeUntil < input.activeFrom) {
    throw new ScheduleValidationError('activeUntil ต้องไม่น้อยกว่า activeFrom');
  }

  // Monthly-only enforcement
  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: input.bookingId },
    select: { id: true, roomId: true, bookingType: true, status: true },
  });
  if (booking.bookingType === 'daily') {
    throw new ScheduleValidationError('รอบทำความสะอาดใช้ได้เฉพาะจองรายเดือน — รายวันใช้ daily_auto แทน');
  }
  if (booking.roomId !== input.roomId) {
    throw new ScheduleValidationError('Room ไม่ตรงกับ booking');
  }

  const row = await tx.cleaningSchedule.create({
    data: {
      roomId:      input.roomId,
      bookingId:   input.bookingId,
      cadenceDays: hasCadence  ? input.cadenceDays! : null,
      weekdays:    hasWeekdays ? input.weekdays!    : null,
      timeOfDay:   input.timeOfDay ?? null,
      activeFrom:  input.activeFrom,
      activeUntil: input.activeUntil ?? null,
      fee:         input.fee ? new Prisma.Decimal(input.fee) : null,
      chargeable:  input.chargeable ?? true,
      notes:       input.notes ?? null,
      priority:    input.priority ?? 'normal',
      createdBy:   input.createdBy ?? null,
      isActive:    true,
    },
    select: { id: true },
  });
  return row;
}

export interface UpdateScheduleInput {
  cadenceDays?: number | null;
  weekdays?:    number | null;
  timeOfDay?:   string | null;
  activeFrom?:  Date;
  activeUntil?: Date | null;
  fee?:         number | null;
  chargeable?:  boolean;
  notes?:       string | null;
  priority?:    HKPriority;
  isActive?:    boolean;
}

export async function updateSchedule(
  tx: Tx,
  id: string,
  input: UpdateScheduleInput,
): Promise<void> {
  const data: Prisma.CleaningScheduleUpdateInput = {};
  if (input.cadenceDays !== undefined) data.cadenceDays = input.cadenceDays;
  if (input.weekdays    !== undefined) data.weekdays    = input.weekdays;
  if (input.timeOfDay   !== undefined) data.timeOfDay   = input.timeOfDay;
  if (input.activeFrom  !== undefined) data.activeFrom  = input.activeFrom;
  if (input.activeUntil !== undefined) data.activeUntil = input.activeUntil;
  if (input.fee         !== undefined) data.fee         = input.fee === null ? null : new Prisma.Decimal(input.fee);
  if (input.chargeable  !== undefined) data.chargeable  = input.chargeable;
  if (input.notes       !== undefined) data.notes       = input.notes;
  if (input.priority    !== undefined) data.priority    = input.priority;
  if (input.isActive    !== undefined) data.isActive    = input.isActive;

  await tx.cleaningSchedule.update({ where: { id }, data });
}

export async function softDeleteSchedule(tx: Tx, id: string): Promise<void> {
  await tx.cleaningSchedule.update({
    where: { id },
    data:  { isActive: false },
  });
}

export async function listSchedules(
  tx: Tx,
  filter: { roomId?: string; bookingId?: string; includeInactive?: boolean },
) {
  return tx.cleaningSchedule.findMany({
    where: {
      ...(filter.roomId    ? { roomId:    filter.roomId }    : {}),
      ...(filter.bookingId ? { bookingId: filter.bookingId } : {}),
      ...(filter.includeInactive ? {} : { isActive: true }),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, roomId: true, bookingId: true,
      cadenceDays: true, weekdays: true, timeOfDay: true,
      activeFrom: true, activeUntil: true,
      fee: true, chargeable: true, notes: true,
      priority: true, isActive: true, createdAt: true, createdBy: true,
      room:    { select: { number: true, floor: true } },
      booking: { select: { bookingNumber: true, guest: { select: { firstName: true, lastName: true } } } },
    },
  });
}
