/**
 * GET /api/card-batches/[id] — batch detail with matched Payment list
 * Gated by `cashier.close_shift` (same actor who creates batches).
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { loadRbacUser } from '@/lib/rbac/requirePermission';
import { hasPermission } from '@/lib/rbac/permissions';
import { getBatchDetail } from '@/services/cardBatch.service';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rbac = await loadRbacUser(session);
  if (!rbac || !hasPermission(rbac, 'cashier.close_shift')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const detail = await prisma.$transaction((tx) => getBatchDetail(tx, params.id));
  if (!detail) return NextResponse.json({ error: 'ไม่พบ batch' }, { status: 404 });
  return NextResponse.json(detail);
}
