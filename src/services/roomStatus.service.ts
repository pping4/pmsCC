/**
 * roomStatus.service.ts — Phase I / Sprint 2
 *
 * Single chokepoint for ALL writes to `Room.status`. Enforces a whitelist of
 * allowed transitions so downstream modules (housekeeping, checkout, room
 * moves) can't accidentally put a room into an impossible state
 * (e.g., available → checkout skipping cleaning).
 *
 * Every transition is logged to ActivityLog with the reason, so auditors can
 * reconstruct a room's lifecycle. If a transition is disallowed the caller
 * gets a typed error — translate to HTTP 409 at the API boundary.
 *
 * WHY a service rather than inline `room.update`:
 *   - The rule set is non-trivial; scattering it leaks bugs.
 *   - Activity log was missing for many writers.
 *   - Housekeeping auto-task logic needs a clean hook point.
 */

import { Prisma, RoomStatus } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Allowed state transitions. Keys are the FROM status; values are the set of
 * statuses the room may move to. If a transition is not listed, it is
 * rejected.
 *
 * Same-state transitions (x → x) are always allowed and become no-ops, so
 * callers can be idempotent without special-casing.
 */
const ALLOWED: Record<RoomStatus, RoomStatus[]> = {
  available:   ['occupied', 'reserved', 'maintenance', 'cleaning'],
  occupied:    ['checkout', 'maintenance', 'cleaning'],
  reserved:    ['occupied', 'available'],
  checkout:    ['cleaning', 'available'],
  cleaning:    ['available', 'maintenance'],
  maintenance: ['available'],
};

export class RoomTransitionError extends Error {
  constructor(
    public readonly roomId: string,
    public readonly from: RoomStatus,
    public readonly to: RoomStatus,
  ) {
    super(`Invalid room transition: ${from} → ${to} (room ${roomId})`);
    this.name = 'RoomTransitionError';
  }
}

export interface TransitionInput {
  roomId: string;
  to:     RoomStatus;
  reason: string;            // free-form, logged verbatim
  userId?: string | null;    // for activity log
  userName?: string | null;
  bookingId?: string | null; // cross-reference for activity log
  /**
   * Set `currentBookingId` on the room. Use `undefined` to leave untouched,
   * `null` to clear (e.g., after checkout), or a booking id to set.
   * Most callers paired room.status + currentBookingId historically — this
   * keeps the two writes atomic through the chokepoint.
   */
  currentBookingId?: string | null | undefined;
}

/**
 * Move a room to a new status. Idempotent when to === current.
 *
 * @throws RoomTransitionError if transition not allowed.
 */
export async function transitionRoom(tx: Tx, input: TransitionInput): Promise<{
  from: RoomStatus;
  to:   RoomStatus;
  noop: boolean;
}> {
  const room = await tx.room.findUniqueOrThrow({
    where:  { id: input.roomId },
    select: { id: true, status: true, number: true },
  });

  if (room.status === input.to) {
    return { from: room.status, to: input.to, noop: true };
  }

  const allowed = ALLOWED[room.status] ?? [];
  if (!allowed.includes(input.to)) {
    throw new RoomTransitionError(input.roomId, room.status, input.to);
  }

  const updateData: { status: RoomStatus; currentBookingId?: string | null } = {
    status: input.to,
  };
  if (input.currentBookingId !== undefined) {
    updateData.currentBookingId = input.currentBookingId;
  }
  await tx.room.update({
    where: { id: input.roomId },
    data:  updateData,
  });

  await tx.activityLog.create({
    data: {
      userId:      input.userId ?? null,
      userName:    input.userName ?? null,
      action:      'room_status_change',
      category:    'room',
      roomId:      input.roomId,
      bookingId:   input.bookingId ?? null,
      description: `ห้อง ${room.number}: ${room.status} → ${input.to} — ${input.reason}`,
      metadata:    { from: room.status, to: input.to, reason: input.reason },
      icon:        '🚪',
      severity:    'info',
    },
  });

  return { from: room.status, to: input.to, noop: false };
}

/**
 * True if the transition would be accepted by `transitionRoom`. Useful for
 * pre-flight UI checks (disable buttons) without performing the write.
 */
export function canTransition(from: RoomStatus, to: RoomStatus): boolean {
  if (from === to) return true;
  return (ALLOWED[from] ?? []).includes(to);
}
