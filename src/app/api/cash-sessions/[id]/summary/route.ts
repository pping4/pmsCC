/**
 * GET /api/cash-sessions/[id]/summary — Sprint 5 Phase 4.2
 *
 * Returns the rich Close-Shift breakdown:
 *   - cash expected total
 *   - non-cash grouped by receiving account (transfer/promptpay)
 *   - non-cash grouped by terminal+brand (credit_card)
 *   - pendingRecon count for "awaiting reconciliation" awareness
 *
 * Scope:
 *   - opener of the session, OR
 *   - user with `cashier.view_other_shifts`
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getShiftSummary } from '@/services/cashSession.service';
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

  const summary = await prisma.$transaction((tx) => getShiftSummary(tx, params.id));
  if (!summary) {
    return NextResponse.json({ error: 'ไม่พบ cash session' }, { status: 404 });
  }

  // Scope check — match the [id] GET behaviour
  const openedById = summary.session.openedBy;
  if (openedById !== session.user.id && openedById !== session.user.email) {
    const rbac = await loadRbacUser(session);
    if (!rbac || !hasPermission(rbac, 'cashier.view_other_shifts')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  return NextResponse.json(summary);
}
