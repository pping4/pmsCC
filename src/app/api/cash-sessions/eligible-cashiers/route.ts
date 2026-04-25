/**
 * GET /api/cash-sessions/eligible-cashiers — Sprint 4B.
 *
 * Returns active users who can open a shift (have `cashier.open_shift`),
 * minus the caller. Powers the "รับกะ" dropdown inside HandoverDialog.
 *
 * Access: any authenticated user who is themselves allowed to hand off
 * (i.e. has `cashier.handover`). Rationale: only someone in the middle
 * of a shift and allowed to hand it off ever needs this list.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/rbac/requirePermission';
import { hasPermission } from '@/lib/rbac/permissions';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const forbidden = await requirePermission(session, 'cashier.handover');
  if (forbidden) return forbidden;

  const users = await prisma.user.findMany({
    where: {
      active: true,
      id: { not: session.user.id },
    },
    select: {
      id:                  true,
      name:                true,
      email:               true,
      role:                true,
      permissionOverrides: true,
    },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });

  // Filter in-memory — pool is small (typically < 100 users) and the
  // permission resolver is pure, so a findMany + filter is simpler than
  // encoding overrides into a SQL predicate.
  const eligible = users
    .filter((u) =>
      hasPermission(
        // We already filtered active: true in the query; pass it as true here.
        { role: u.role, active: true, permissionOverrides: u.permissionOverrides },
        'cashier.open_shift',
      ),
    )
    .map(({ permissionOverrides: _po, ...rest }) => {
      void _po;
      return rest;
    });

  return NextResponse.json({ users: eligible });
}
