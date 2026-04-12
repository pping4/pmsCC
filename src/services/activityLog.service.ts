/**
 * activityLog.service.ts
 *
 * Centralised helper for writing Activity Log entries.
 *
 * Design principles:
 *  - Non-fatal: a logging failure NEVER breaks the parent transaction / request.
 *    All writes are wrapped in try/catch; errors are console.warn'd only.
 *  - Atomic when possible: accepts a Prisma transaction client (tx) so the log
 *    row is committed together with the triggering business action.
 *  - Typed: uses strict TypeScript; no `any` except for metadata (Json).
 */

import { Prisma } from '@prisma/client';
import { Session } from 'next-auth';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Severity levels for log entries */
export type LogSeverity = 'info' | 'warning' | 'error' | 'success';

/** Activity categories — maps to the `category` column */
export type LogCategory =
  | 'booking'
  | 'checkin'
  | 'checkout'
  | 'room'
  | 'payment'
  | 'invoice'
  | 'housekeeping'
  | 'maintenance'
  | 'guest'
  | 'system'
  | 'city_ledger';

/** Parameters for a single log entry */
export interface LogActivityParams {
  /** Session from getServerSession — used to extract userId/userName */
  session?: Session | null;
  /** Alternatively, pass userId/userName directly (for background jobs) */
  userId?: string;
  userName?: string;

  /** Machine-readable action verb, e.g. "booking.created", "checkin.completed" */
  action: string;
  /** High-level category for filtering */
  category: LogCategory;
  /** Human-readable description (Thai or English) */
  description: string;

  /** Optional related entity IDs */
  bookingId?: string | null;
  roomId?: string | null;
  guestId?: string | null;
  invoiceId?: string | null;
  cityLedgerAccountId?: string | null;

  /** Arbitrary JSON metadata — use for before/after state snapshots */
  metadata?: Record<string, unknown>;

  /** Emoji icon shown in the timeline UI */
  icon?: string;
  /** Severity level */
  severity?: LogSeverity;
}

/**
 * Prisma transaction client type — compatible with both
 * `prisma.$transaction(async (tx) => ...)` and top-level `prisma`.
 */
type PrismaTxClient = Omit<
  Prisma.TransactionClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// ─── Category → default icon map ─────────────────────────────────────────────

const CATEGORY_ICONS: Record<LogCategory, string> = {
  booking:       '📋',
  checkin:       '🛎️',
  checkout:      '🧳',
  room:          '🚪',
  payment:       '💳',
  invoice:       '🧾',
  housekeeping:  '🧹',
  maintenance:   '🔧',
  guest:         '👤',
  system:        '⚙️',
  city_ledger:   '🏢',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract userId and userName from a next-auth Session object.
 * Falls back gracefully when session is null/undefined.
 */
export function extractUser(session?: Session | null): {
  userId: string | null;
  userName: string | null;
} {
  if (!session?.user) return { userId: null, userName: null };
  return {
    userId:   (session.user as { id?: string }).id   ?? null,
    userName: session.user.name ?? session.user.email ?? null,
  };
}

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * Write a single activity log entry.
 *
 * @param tx   - Prisma client or transaction client. Pass the `tx` from
 *               `prisma.$transaction` to make the log atomic with the action.
 * @param params - Log entry details.
 *
 * @example — inside a $transaction:
 * ```ts
 * const result = await prisma.$transaction(async (tx) => {
 *   const booking = await tx.booking.update({ ... });
 *   await logActivity(tx, {
 *     session,
 *     action: 'booking.checkin',
 *     category: 'checkin',
 *     description: `Check-in: ห้อง ${room.number} — ${guestName}`,
 *     bookingId: booking.id,
 *     roomId: booking.roomId,
 *     guestId: booking.guestId,
 *     metadata: { before: { status: 'confirmed' }, after: { status: 'checked_in' } },
 *   });
 *   return booking;
 * });
 * ```
 */
export async function logActivity(
  tx: PrismaTxClient,
  params: LogActivityParams,
): Promise<void> {
  try {
    // Resolve user identity
    let userId   = params.userId   ?? null;
    let userName = params.userName ?? null;

    if (params.session) {
      const extracted = extractUser(params.session);
      userId   = userId   ?? extracted.userId;
      userName = userName ?? extracted.userName;
    }

    const icon = params.icon ?? CATEGORY_ICONS[params.category] ?? '📝';

    await (tx as Prisma.TransactionClient).activityLog.create({
      data: {
        userId,
        userName,
        action:      params.action,
        category:    params.category,
        description: params.description,
        bookingId:           params.bookingId           ?? null,
        roomId:              params.roomId              ?? null,
        guestId:             params.guestId             ?? null,
        invoiceId:           params.invoiceId           ?? null,
        cityLedgerAccountId: params.cityLedgerAccountId ?? null,
        metadata:    params.metadata   as Prisma.InputJsonValue | undefined,
        icon,
        severity:    params.severity   ?? 'info',
      },
    });
  } catch (err) {
    // Non-fatal — log to console but never throw
    console.warn('[activityLog] Failed to write log entry:', err);
  }
}
