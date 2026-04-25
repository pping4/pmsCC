/**
 * GET /api/me/permissions
 * ------------------------
 * Returns the effective permission set for the currently-authenticated user.
 * The client `useEffectivePermissions()` hook calls this once per mount so
 * the sidebar + menus can hide links the user has no rights to.
 *
 * Response:
 *   { role, active, permissions: string[], wildcard: boolean }
 *
 * `wildcard=true` means the user is admin and has every permission (including
 * future ones). Clients should treat wildcard as "allow anything".
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { loadRbacUser } from '@/lib/rbac/requirePermission';
import { resolveEffectivePermissions } from '@/lib/rbac/permissions';

export async function GET() {
  const session = await getServerSession(authOptions);
  const user = await loadRbacUser(session);

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const effective = resolveEffectivePermissions(user);
  const wildcard = effective.has('*');
  const permissions = wildcard ? [] : [...effective];

  return NextResponse.json({
    role: user.role,
    active: user.active,
    wildcard,
    permissions,
  });
}
