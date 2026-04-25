/**
 * GET /api/cash-sessions/[id] — Sprint 4B.
 *
 * Returns full session summary (totals, breakdown, lineage). Viewable by:
 *   - the opener
 *   - anyone with `cashier.view_other_shifts`
 *
 * Close/handover/force-close live in sibling routes so each action maps
 * to exactly one URL and one permission — easier to gate per-button in UI.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getSessionSummary, SessionNotFoundError } from '@/services/cashSession.service';
import { loadRbacUser } from '@/lib/rbac/requirePermission';
import { hasPermission } from '@/lib/rbac/permissions';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await prisma.$transaction((tx) =>
      getSessionSummary(tx, params.id),
    );

    // Scope: only the opener or someone with view_other_shifts may read it.
    if (summary.openedById !== session.user.id) {
      const rbac = await loadRbacUser(session);
      if (!rbac || !hasPermission(rbac, 'cashier.view_other_shifts')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    return NextResponse.json({ session: summary });
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 404 });
    }
    const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
