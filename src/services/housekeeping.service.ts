/**
 * housekeeping.service.ts — Phase I / Sprint 2 + 2b
 *
 * Centralises creation/cancellation of HousekeepingTask rows:
 *   - dedupe against OPEN (pending/in_progress) per room
 *   - atomic task-number generation
 *   - chargeable-cleaning wiring to folio (Sprint 2b)
 *   - request-source taxonomy (auto_checkout / daily_auto / guest_request /
 *     monthly_scheduled / recurring_auto / manual / maintenance_followup)
 *
 * Every function accepts a `TransactionClient` so callers can compose multi-
 * step mutations (booking flows, night audit, etc.) under a single
 * `prisma.$transaction` envelope.
 */

import { Prisma } from '@prisma/client';
import { addCharge } from './folio.service';

type Tx = Prisma.TransactionClient;

export type HKPriority = 'low' | 'normal' | 'high' | 'urgent';
export type HKRequestSource =
  | 'auto_checkout'
  | 'daily_auto'
  | 'guest_request'
  | 'monthly_scheduled'
  | 'recurring_auto'
  | 'manual'
  | 'maintenance_followup';
export type HKRequestChannel =
  | 'door_sign'
  | 'phone'
  | 'guest_app'
  | 'front_desk'
  | 'system';

// ── Shared input types ─────────────────────────────────────────────────────

export interface CreateCleaningTaskInput {
  roomId:       string;
  bookingId?:   string | null;
  scheduledAt?: Date;
  priority?:    HKPriority;
  notes?:       string | null;
  createdBy?:   string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function nextTaskNumber(tx: Tx): Promise<string> {
  const count = await tx.housekeepingTask.count();
  return `HK-${String(count + 1).padStart(3, '0')}`;
}

/** Dedupe lookup — any open task for this room? */
async function findOpenTask(tx: Tx, roomId: string): Promise<{ id: string } | null> {
  return tx.housekeepingTask.findFirst({
    where: { roomId, status: { in: ['pending', 'in_progress'] } },
    select: { id: true },
  });
}

/**
 * Create a chargeable folio line item for a cleaning fee, if applicable.
 * Returns the FolioLineItem id so caller can link back on the task.
 */
async function maybeChargeFolio(
  tx: Tx,
  input: {
    bookingId: string | null | undefined;
    chargeable: boolean;
    fee: number | null | undefined;
    taskLabel: string;
    createdBy: string | null | undefined;
  },
): Promise<string | null> {
  if (!input.chargeable || !input.bookingId || !input.fee || input.fee <= 0) return null;

  // Find folio + verify booking is still billable (not checked_out/cancelled)
  const booking = await tx.booking.findUnique({
    where: { id: input.bookingId },
    select: { status: true, folio: { select: { id: true, closedAt: true } } },
  });
  if (!booking || !booking.folio) return null;
  if (booking.folio.closedAt) return null;
  if (booking.status === 'cancelled') return null;

  const result = await addCharge(tx, {
    folioId:      booking.folio.id,
    chargeType:   'HOUSEKEEPING',
    description:  input.taskLabel,
    amount:       input.fee,
    quantity:     1,
    unitPrice:    input.fee,
    taxType:      'no_tax',
    serviceDate:  new Date(),
    referenceType: 'housekeeping_task',
    createdBy:    input.createdBy ?? 'system',
  });
  return result.lineItemId;
}

// ── Create: checkout (Sprint 2, unchanged behaviour) ───────────────────────

export async function createCheckoutCleaningTask(
  tx: Tx,
  input: CreateCleaningTaskInput,
): Promise<{ taskId: string; created: boolean }> {
  const open = await findOpenTask(tx, input.roomId);
  if (open) return { taskId: open.id, created: false };

  const taskNumber = await nextTaskNumber(tx);
  const task = await tx.housekeepingTask.create({
    data: {
      taskNumber,
      roomId:        input.roomId,
      bookingId:     input.bookingId ?? null,
      taskType:      'checkout_cleaning',
      status:        'pending',
      priority:      input.priority ?? 'normal',
      scheduledAt:   input.scheduledAt ?? new Date(),
      notes:         input.notes ?? 'Auto-created on checkout',
      requestSource: 'auto_checkout',
      chargeable:    false,
      requestChannel: 'system',
    },
    select: { id: true },
  });
  return { taskId: task.id, created: true };
}

// ── Create: daily_auto (night audit, รายวัน booking) ───────────────────────

export interface CreateDailyAutoInput {
  roomId:     string;
  bookingId:  string;
  forDate:    Date; // calendar date (local)
  notes?:     string | null;
}

/** Idempotency key the night-audit route uses to avoid duplicates. */
export function dailyAutoIdempotencyKey(bookingId: string, forDate: Date): string {
  const y = forDate.getFullYear();
  const m = String(forDate.getMonth() + 1).padStart(2, '0');
  const d = String(forDate.getDate()).padStart(2, '0');
  return `hk-daily-${bookingId}-${y}-${m}-${d}`;
}

export async function createDailyAutoTask(
  tx: Tx,
  input: CreateDailyAutoInput,
): Promise<{ taskId: string; created: boolean }> {
  const key = dailyAutoIdempotencyKey(input.bookingId, input.forDate);

  // 1. Idempotency — was this exact (booking,date) already seeded?
  const existing = await tx.housekeepingTask.findUnique({
    where: { idempotencyKey: key },
    select: { id: true },
  });
  if (existing) return { taskId: existing.id, created: false };

  // 2. Dedupe against other OPEN tasks for the same room
  const open = await findOpenTask(tx, input.roomId);
  if (open) return { taskId: open.id, created: false };

  const taskNumber = await nextTaskNumber(tx);
  const task = await tx.housekeepingTask.create({
    data: {
      taskNumber,
      roomId:         input.roomId,
      bookingId:      input.bookingId,
      taskType:       'daily_cleaning',
      status:         'pending',
      priority:       'normal',
      scheduledAt:    input.forDate,
      notes:          input.notes ?? 'Auto daily cleaning (night audit)',
      requestSource:  'daily_auto',
      chargeable:     false,
      requestChannel: 'system',
      idempotencyKey: key,
    },
    select: { id: true },
  });
  return { taskId: task.id, created: true };
}

// ── Cancel: guest decline ──────────────────────────────────────────────────

export class HKDeclineNotAllowedError extends Error {
  constructor(public readonly reason: 'status' | 'source') {
    super(
      reason === 'status'
        ? 'Task is already in progress or completed — cannot decline.'
        : 'Only daily_auto tasks may be declined.',
    );
    this.name = 'HKDeclineNotAllowedError';
  }
}

export interface CancelDailyInput {
  taskId:       string;
  channel:      HKRequestChannel;
  requestedBy?: string | null; // staff userId, or 'guest'
  notes?:       string | null;
}

export async function cancelDailyTaskAsDecline(
  tx: Tx,
  input: CancelDailyInput,
): Promise<{ taskId: string }> {
  const task = await tx.housekeepingTask.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { id: true, status: true, requestSource: true, roomId: true },
  });

  // Only pending daily_auto tasks may be declined — once a maid has started
  // or finished we're past the point of no return.
  if (task.status !== 'pending') {
    throw new HKDeclineNotAllowedError('status');
  }
  if (task.requestSource !== 'daily_auto') {
    throw new HKDeclineNotAllowedError('source');
  }

  await tx.housekeepingTask.update({
    where: { id: task.id },
    data: {
      status:         'cancelled',
      declinedAt:     new Date(),
      declinedBy:     input.requestedBy ?? 'guest',
      declineChannel: input.channel,
      declineNotes:   input.notes ?? null,
    },
  });
  return { taskId: task.id };
}

// ── Create: guest_request ──────────────────────────────────────────────────

export interface CreateGuestRequestInput {
  roomId:       string;
  bookingId?:   string | null;
  channel:      HKRequestChannel;
  requestedBy?: string | null;
  notes?:       string | null;
  priority?:    HKPriority;
  chargeable?:  boolean;
  fee?:         number | null;
  scheduledAt?: Date;
}

export async function createGuestRequestTask(
  tx: Tx,
  input: CreateGuestRequestInput,
): Promise<{ taskId: string; created: boolean; folioLineItemId: string | null }> {
  const open = await findOpenTask(tx, input.roomId);
  if (open) return { taskId: open.id, created: false, folioLineItemId: null };

  const folioLineItemId = await maybeChargeFolio(tx, {
    bookingId:  input.bookingId,
    chargeable: !!input.chargeable,
    fee:        input.fee ?? null,
    taskLabel:  input.notes?.trim() || 'แขกแจ้งขอทำความสะอาด',
    createdBy:  input.requestedBy,
  });

  const taskNumber = await nextTaskNumber(tx);
  const task = await tx.housekeepingTask.create({
    data: {
      taskNumber,
      roomId:          input.roomId,
      bookingId:       input.bookingId ?? null,
      taskType:        'guest_request',
      status:          'pending',
      priority:        input.priority ?? 'normal',
      scheduledAt:     input.scheduledAt ?? new Date(),
      notes:           input.notes ?? null,
      requestSource:   'guest_request',
      requestChannel:  input.channel,
      requestedAt:     new Date(),
      requestedBy:     input.requestedBy ?? null,
      chargeable:      !!input.chargeable,
      fee:             input.chargeable && input.fee ? new Prisma.Decimal(input.fee) : null,
      folioLineItemId: folioLineItemId,
    },
    select: { id: true },
  });
  return { taskId: task.id, created: true, folioLineItemId };
}

// ── Create: monthly_scheduled (staff one-off) ──────────────────────────────

export interface CreateScheduledTaskInput {
  roomId:       string;
  bookingId:    string;
  scheduleId?:  string | null;
  scheduledAt:  Date;
  fee?:         number | null;
  chargeable?:  boolean;
  priority?:    HKPriority;
  notes?:       string | null;
  requestedBy?: string | null;
  sourceOverride?: HKRequestSource; // recurring_auto vs monthly_scheduled
}

export async function createScheduledTask(
  tx: Tx,
  input: CreateScheduledTaskInput,
): Promise<{ taskId: string; created: boolean; folioLineItemId: string | null }> {
  const open = await findOpenTask(tx, input.roomId);
  if (open) return { taskId: open.id, created: false, folioLineItemId: null };

  const folioLineItemId = await maybeChargeFolio(tx, {
    bookingId:  input.bookingId,
    chargeable: input.chargeable ?? true,
    fee:        input.fee ?? null,
    taskLabel:  input.notes?.trim() || 'Scheduled cleaning',
    createdBy:  input.requestedBy,
  });

  const taskNumber = await nextTaskNumber(tx);
  const task = await tx.housekeepingTask.create({
    data: {
      taskNumber,
      roomId:          input.roomId,
      bookingId:       input.bookingId,
      scheduleId:      input.scheduleId ?? null,
      taskType:        'scheduled_cleaning',
      status:          'pending',
      priority:        input.priority ?? 'normal',
      scheduledAt:     input.scheduledAt,
      notes:           input.notes ?? null,
      requestSource:   input.sourceOverride ?? 'monthly_scheduled',
      requestChannel:  'front_desk',
      requestedAt:     new Date(),
      requestedBy:     input.requestedBy ?? null,
      chargeable:      input.chargeable ?? true,
      fee:             input.fee ? new Prisma.Decimal(input.fee) : null,
      folioLineItemId: folioLineItemId,
    },
    select: { id: true },
  });
  return { taskId: task.id, created: true, folioLineItemId };
}

// ── Create: manual (generalised existing) ──────────────────────────────────

export interface CreateManualTaskInput {
  roomId:      string;
  taskType:    string;
  bookingId?:  string | null;
  assignedTo?: string | null;
  priority?:   HKPriority;
  scheduledAt?: Date;
  notes?:      string | null;
  chargeable?: boolean;
  fee?:        number | null;
  createdBy?:  string | null;
}

export async function createManualTask(
  tx: Tx,
  input: CreateManualTaskInput,
): Promise<{ taskId: string; created: boolean; folioLineItemId: string | null }> {
  const open = await findOpenTask(tx, input.roomId);
  if (open) return { taskId: open.id, created: false, folioLineItemId: null };

  const folioLineItemId = await maybeChargeFolio(tx, {
    bookingId:  input.bookingId,
    chargeable: !!input.chargeable,
    fee:        input.fee ?? null,
    taskLabel:  input.notes?.trim() || input.taskType,
    createdBy:  input.createdBy,
  });

  const taskNumber = await nextTaskNumber(tx);
  const task = await tx.housekeepingTask.create({
    data: {
      taskNumber,
      roomId:          input.roomId,
      bookingId:       input.bookingId ?? null,
      taskType:        input.taskType,
      assignedTo:      input.assignedTo ?? null,
      status:          'pending',
      priority:        input.priority ?? 'normal',
      scheduledAt:     input.scheduledAt ?? new Date(),
      notes:           input.notes ?? null,
      requestSource:   'manual',
      requestChannel:  'front_desk',
      requestedAt:     new Date(),
      requestedBy:     input.createdBy ?? null,
      chargeable:      !!input.chargeable,
      fee:             input.chargeable && input.fee ? new Prisma.Decimal(input.fee) : null,
      folioLineItemId: folioLineItemId,
    },
    select: { id: true },
  });
  return { taskId: task.id, created: true, folioLineItemId };
}

// ── Generate from CleaningSchedule (cron) ──────────────────────────────────

/**
 * Create a recurring_auto task for the schedule if the rule matches `forDate`
 * and the schedule is still active. Dedupes:
 *   - against existing open tasks for the room
 *   - against an existing task for the SAME (schedule, date) combo
 */
export async function generateTasksFromSchedule(
  tx: Tx,
  input: { scheduleId: string; forDate: Date },
): Promise<{ taskId: string | null; created: boolean; reason?: string }> {
  const sched = await tx.cleaningSchedule.findUniqueOrThrow({
    where: { id: input.scheduleId },
    select: {
      id: true, roomId: true, bookingId: true,
      cadenceDays: true, weekdays: true,
      activeFrom: true, activeUntil: true,
      fee: true, chargeable: true, notes: true, priority: true, isActive: true,
      createdBy: true,
    },
  });

  if (!sched.isActive) return { taskId: null, created: false, reason: 'inactive' };
  if (sched.activeUntil && input.forDate > sched.activeUntil) {
    return { taskId: null, created: false, reason: 'expired' };
  }
  if (input.forDate < sched.activeFrom) {
    return { taskId: null, created: false, reason: 'before_start' };
  }

  // Rule match
  const matches = scheduleMatches(sched.activeFrom, sched.cadenceDays, sched.weekdays, input.forDate);
  if (!matches) return { taskId: null, created: false, reason: 'not_today' };

  // Dedupe per-schedule-per-day
  const startOfDay = new Date(input.forDate); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay   = new Date(input.forDate); endOfDay.setHours(23, 59, 59, 999);
  const sameDay = await tx.housekeepingTask.findFirst({
    where: {
      scheduleId: sched.id,
      scheduledAt: { gte: startOfDay, lte: endOfDay },
    },
    select: { id: true },
  });
  if (sameDay) return { taskId: sameDay.id, created: false, reason: 'already_seeded' };

  if (!sched.bookingId) {
    return { taskId: null, created: false, reason: 'no_booking' };
  }

  const result = await createScheduledTask(tx, {
    roomId:         sched.roomId,
    bookingId:      sched.bookingId,
    scheduleId:     sched.id,
    scheduledAt:    input.forDate,
    fee:            sched.fee ? Number(sched.fee) : null,
    chargeable:     sched.chargeable,
    priority:       sched.priority,
    notes:          sched.notes ?? 'Recurring cleaning (auto)',
    requestedBy:    sched.createdBy ?? 'system',
    sourceOverride: 'recurring_auto',
  });
  return { taskId: result.taskId, created: result.created };
}

/**
 * Does this schedule's recurrence rule match `forDate`?
 * Precedence: weekdays (bitmask) > cadenceDays > always (fallback).
 *   weekdays bit 1 = Mon ... 64 = Sun (mirrors the UI picker order).
 *   cadenceDays N means: every N calendar days from activeFrom.
 */
function scheduleMatches(
  activeFrom: Date,
  cadenceDays: number | null,
  weekdays: number | null,
  forDate: Date,
): boolean {
  if (weekdays && weekdays > 0) {
    // JS getDay(): 0=Sun..6=Sat   → normalize to Mon=0..Sun=6
    const jsDow = forDate.getDay();
    const normalized = (jsDow + 6) % 7; // Mon=0..Sun=6
    return ((weekdays >> normalized) & 1) === 1;
  }
  if (cadenceDays && cadenceDays > 0) {
    const ms = forDate.getTime() - activeFrom.getTime();
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    return days >= 0 && days % cadenceDays === 0;
  }
  return false; // no rule → never match
}
