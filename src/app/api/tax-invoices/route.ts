/**
 * /api/tax-invoices — Sprint 5 Phase 6
 *
 * POST — issue a new tax invoice (bundling 1+ invoices for one customer)
 * GET  — list with filters (?status=&from=&to=&customerTaxId=)
 *        plus builder helper: ?guestId=... → unissued invoices only
 *
 * Security:
 *  - Auth required
 *  - Gate: `finance.post_invoice`
 *  - Zod validated; service errors translated to 4xx
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
  createTaxInvoice, listTaxInvoices, listUnissuedInvoicesForGuest,
} from '@/services/taxInvoice.service';

const PERM = 'finance.post_invoice';

const CreateSchema = z.object({
  customerName:      z.string().trim().min(1).max(200),
  customerTaxId:     z.string().trim().regex(/^\d{13}$/).optional().or(z.literal('').transform(() => undefined)),
  customerBranch:    z.string().trim().max(100).optional().or(z.literal('').transform(() => undefined)),
  customerAddress:   z.string().trim().max(500).optional().or(z.literal('').transform(() => undefined)),
  coveredInvoiceIds: z.array(z.string().uuid()).min(1).max(50),
  coveredPaymentIds: z.array(z.string().uuid()).max(50).optional(),
  issueDate:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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

  // Builder helper: list unissued invoices for a guest
  const guestId = url.searchParams.get('guestId');
  if (guestId) {
    const rows = await prisma.$transaction((tx) => listUnissuedInvoicesForGuest(tx, guestId));
    return NextResponse.json({ invoices: rows });
  }

  const status = url.searchParams.get('status');
  const fromStr = url.searchParams.get('from');
  const toStr   = url.searchParams.get('to');
  const customerTaxId = url.searchParams.get('customerTaxId') ?? undefined;

  const rows = await prisma.$transaction((tx) => listTaxInvoices(tx, {
    status: status === 'ISSUED' || status === 'VOIDED' ? status : undefined,
    from: fromStr && /^\d{4}-\d{2}-\d{2}$/.test(fromStr) ? parseDate(fromStr) : undefined,
    to:   toStr   && /^\d{4}-\d{2}-\d{2}$/.test(toStr)
      ? (() => { const d = parseDate(toStr); d.setDate(d.getDate() + 1); return d; })()
      : undefined,
    customerTaxId,
  }));
  return NextResponse.json({ taxInvoices: rows });
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
    const ti = await prisma.$transaction(
      (tx) => createTaxInvoice(tx, {
        customerName:      parsed.data.customerName,
        customerTaxId:     parsed.data.customerTaxId,
        customerBranch:    parsed.data.customerBranch,
        customerAddress:   parsed.data.customerAddress,
        coveredInvoiceIds: parsed.data.coveredInvoiceIds,
        coveredPaymentIds: parsed.data.coveredPaymentIds,
        issueDate:         parsed.data.issueDate ? parseDate(parsed.data.issueDate) : undefined,
        issuedByUserId:    session.user.id,
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    return NextResponse.json({ taxInvoice: ti }, { status: 201 });
  } catch (e) {
    if (e instanceof Error) {
      switch (e.message) {
        case 'NO_INVOICES':
          return NextResponse.json({ error: 'ต้องเลือกใบแจ้งหนี้อย่างน้อย 1 ใบ' }, { status: 422 });
        case 'INVOICES_NOT_FOUND':
          return NextResponse.json({ error: 'ไม่พบใบแจ้งหนี้บางรายการ' }, { status: 404 });
        case 'MIXED_CUSTOMERS':
          return NextResponse.json({ error: 'ใบแจ้งหนี้ต้องมาจากลูกค้ารายเดียวกัน' }, { status: 422 });
        case 'INVOICE_ALREADY_COVERED': {
          const meta = e as Error & { conflictingInvoiceId?: string; taxInvoiceNumber?: string };
          return NextResponse.json({
            error: `ใบแจ้งหนี้ ${meta.conflictingInvoiceId ?? ''} อยู่ในใบกำกับภาษี ${meta.taxInvoiceNumber ?? ''} แล้ว`,
          }, { status: 409 });
        }
      }
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json({ error: 'หมายเลขซ้ำ (ลองใหม่อีกครั้ง)' }, { status: 409 });
    }
    console.error('[POST /api/tax-invoices]', e);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด' }, { status: 500 });
  }
}
