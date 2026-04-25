/**
 * /api/tax-invoices/[id] — detail + void (PATCH)
 *
 * GET   — full detail incl. covered invoice breakdown
 * PATCH — { action: 'void', reason: string } → mark VOIDED
 *
 * Void rules (plan §6.4):
 *  - Only ISSUED → VOIDED transition allowed
 *  - Reason required (≥ 3 chars)
 *  - Row is kept (Revenue can inspect); running number is NOT reused
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { loadRbacUser } from '@/lib/rbac/requirePermission';
import { hasPermission } from '@/lib/rbac/permissions';
import { getTaxInvoiceDetail, voidTaxInvoice } from '@/services/taxInvoice.service';

const PERM = 'finance.post_invoice';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rbac = await loadRbacUser(session);
  if (!rbac || !hasPermission(rbac, PERM)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const ti = await prisma.$transaction((tx) => getTaxInvoiceDetail(tx, params.id));
  if (!ti) return NextResponse.json({ error: 'ไม่พบใบกำกับภาษี' }, { status: 404 });
  return NextResponse.json(ti);
}

const PatchSchema = z.object({
  action: z.literal('void'),
  reason: z.string().trim().min(3).max(500),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rbac = await loadRbacUser(session);
  if (!rbac || !hasPermission(rbac, PERM)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'ข้อมูลไม่ถูกต้อง', issues: parsed.error.flatten() }, { status: 422 });
  }

  try {
    const res = await prisma.$transaction((tx) => voidTaxInvoice(tx, params.id, parsed.data.reason, session.user.id));
    return NextResponse.json({ taxInvoice: res });
  } catch (e) {
    if (e instanceof Error) {
      switch (e.message) {
        case 'NOT_FOUND':
          return NextResponse.json({ error: 'ไม่พบใบกำกับภาษี' }, { status: 404 });
        case 'ALREADY_VOIDED':
          return NextResponse.json({ error: 'ใบกำกับภาษีถูกยกเลิกไปแล้ว' }, { status: 409 });
        case 'REASON_REQUIRED':
          return NextResponse.json({ error: 'ต้องระบุเหตุผลในการยกเลิก' }, { status: 422 });
      }
    }
    console.error('[PATCH /api/tax-invoices/[id]]', e);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด' }, { status: 500 });
  }
}
