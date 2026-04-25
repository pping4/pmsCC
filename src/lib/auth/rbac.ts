/**
 * Minimal role-gate helper for API routes.
 *
 * We repeat the same inline role check in several API routes (see
 * `/api/refunds/[id]/process`, `/api/cash-sessions`, …). This helper
 * centralises the pattern — a caller throws or returns a 403 response
 * when the authenticated user is missing one of the allowed roles.
 *
 * Usage:
 *   const session = await getServerSession(authOptions);
 *   if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 *   const forbidden = requireRole(session, ['admin', 'manager']);
 *   if (forbidden) return forbidden;
 */

import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';

export type AppRole = 'admin' | 'manager' | 'staff' | string;

/**
 * Returns a 403 NextResponse if the session's user role is NOT in `allowed`.
 * Returns `null` when the user is authorised. Does not throw.
 */
export function requireRole(
  session: Session | null,
  allowed: AppRole[],
): NextResponse | null {
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!role || !allowed.includes(role)) {
    return NextResponse.json(
      { error: 'Forbidden', message: 'ต้องมีสิทธิ์ในการดำเนินการนี้' },
      { status: 403 },
    );
  }
  return null;
}

/** Convenience read-only accessor for the user id / email on a session. */
export function getUserRef(session: Session | null): string {
  const u = session?.user as { id?: string; email?: string } | undefined;
  return u?.id ?? u?.email ?? 'system';
}
