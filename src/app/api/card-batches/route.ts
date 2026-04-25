/**
 * /api/card-batches — Sprint 5 Phase 5 (EDC batch close)
 *
 * GET  ?terminalId=&from=&to=&preview=1&closeDate=  → list or preview
 * POST                                              → create a batch
 *
 * Security:
 *  - Auth required
 *  - Gate: `cashier.close_shift` (cashier/night-auditor actor)
 *  - All input validated with Zod; P2002 → 409 on dup (terminalId, batchNo)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { loadRbacUser } from '@/lib/rbac/requirePermission';
import { hasPermission } from '@/lib/rbac/permissions';
import {
  createBatch, previewBatch, listBatches,
} from '@/services/cardBatch.service';

const PERM = 'cashier.close_shift';

const CreateSchema = z.object({
  terminalId:     z.string().uuid(),
  batchNo:        z.string().trim().min(1).max(32),
  closeDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  edcTotalAmount: z.number().nonnegative().finite(),
  edcTxCount:     z.number().int().nonnegative(),
  note:           z.string().trim().max(500).optional(),
});

function parseDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rbac = await loadRbacUser(session);
  if (!rbac || !hasPermission(rbac, PERM)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(request.url);
  const preview = url.searchParams.get('preview') === '1';

  if (preview) {
    const terminalId = url.searchParams.get('terminalId');
    const closeDate  = url.searchParams.get('closeDate');
    if (!terminalId || !closeDate || !/^\d{4}-\d{2}-\d{2}$/.test(closeDate)) {
      return NextResponse.json({ error: 'terminalId และ closeDate (YYYY-MM-DD) จำเป็น' }, { status: 400 });
    }
    const prev = await prisma.$transaction((tx) => previewBatch(tx, terminalId, parseDate(closeDate)));
    if (!prev) return NextResponse.json({ error: 'ไม่พบเครื่อง EDC' }, { status: 404 });
    return NextResponse.json(prev);
  }

  const terminalId = url.searchParams.get('terminalId') ?? undefined;
  const fromStr    = url.searchParams.get('from');
  const toStr      = url.searchParams.get('to');
  const from = fromStr && /^\d{4}-\d{2}-\d{2}$/.test(fromStr) ? parseDate(fromStr) : undefined;
  const to   = toStr   && /^\d{4}-\d{2}-\d{2}$/.test(toStr)
    ? (() => { const d = parseDate(toStr); d.setDate(d.getDate() + 1); return d; })()
    : undefined;

  const rows = await prisma.$transaction((tx) => listBatches(tx, { terminalId, from, to }));
  return NextResponse.json({ batches: rows });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rbac = await loadRbacUser(session);
  if (!rbac || !hasPermission(rbac, PERM)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const result = await prisma.$transaction((tx) => createBatch(tx, {
      terminalId:     parsed.data.terminalId,
      batchNo:        parsed.data.batchNo,
      closeDate:      parseDate(parsed.data.closeDate),
      edcTotalAmount: parsed.data.edcTotalAmount,
      edcTxCount:     parsed.data.edcTxCount,
      note:           parsed.data.note,
      closedByUserId: session.user.id,
      closedByName:   session.user.name ?? session.user.email ?? null,
    }));
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json({ error: 'Batch นี้ถูกปิดไปแล้ว (terminal + batchNo ซ้ำ)' }, { status: 409 });
    }
    if (e instanceof Error && e.message === 'TERMINAL_NOT_FOUND') {
      return NextResponse.json({ error: 'ไม่พบเครื่อง EDC' }, { status: 404 });
    }
    console.error('[POST /api/card-batches]', e);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด' }, { status: 500 });
  }
}
