/**
 * API-route permission guard (Sprint 4A / A-T1)
 * ----------------------------------------------
 * Parallel to `src/lib/auth/rbac.ts`'s `requireRole()` — but checks a
 * *permission* string instead of a role. Use this in all new code;
 * `requireRole()` remains for legacy callsites but should be migrated.
 *
 * Usage:
 *   const session = await getServerSession(authOptions);
 *   if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 *   const forbidden = await requirePermission(session, 'cashier.refund');
 *   if (forbidden) return forbidden;
 *   // ... proceed
 *
 * The guard hits the DB once per call to pull the latest
 * `role / active / permissionOverrides` (the JWT only carries `id` + `role`,
 * not overrides). That is deliberate — overrides change rarely but when they
 * do we want the effect to be immediate without forcing a re-login.
 *
 * Perf note: if an endpoint checks multiple permissions per request, call
 * `loadRbacUser(session)` once and pass the result into `hasPermission()`
 * directly instead of invoking this guard multiple times.
 */

import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { prisma } from '@/lib/prisma';
import {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  type RbacUser,
} from './permissions';

/**
 * Load the RBAC-relevant slice of a user by session id.
 * Returns `null` if session is missing, user deleted, or inactive.
 */
export async function loadRbacUser(session: Session | null): Promise<RbacUser | null> {
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) return null;

  const user = await prisma.user.findUnique({
    where: { id },
    select: { role: true, active: true, permissionOverrides: true },
  });
  if (!user || !user.active) return null;
  return user as RbacUser;
}

function forbidden(message = 'ต้องมีสิทธิ์ในการดำเนินการนี้'): NextResponse {
  return NextResponse.json({ error: 'Forbidden', message }, { status: 403 });
}

function unauthenticated(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/**
 * Guard: require a single permission.
 * Returns `null` when authorised; a `NextResponse` (401/403) otherwise.
 */
export async function requirePermission(
  session: Session | null,
  permission: string,
): Promise<NextResponse | null> {
  const user = await loadRbacUser(session);
  if (!user) return session ? forbidden() : unauthenticated();
  if (!hasPermission(user, permission)) return forbidden();
  return null;
}

/** Guard: require at least one of the listed permissions. */
export async function requireAnyPermission(
  session: Session | null,
  permissions: string[],
): Promise<NextResponse | null> {
  const user = await loadRbacUser(session);
  if (!user) return session ? forbidden() : unauthenticated();
  if (!hasAnyPermission(user, permissions)) return forbidden();
  return null;
}

/** Guard: require every listed permission (AND). */
export async function requireAllPermissions(
  session: Session | null,
  permissions: string[],
): Promise<NextResponse | null> {
  const user = await loadRbacUser(session);
  if (!user) return session ? forbidden() : unauthenticated();
  if (!hasAllPermissions(user, permissions)) return forbidden();
  return null;
}
