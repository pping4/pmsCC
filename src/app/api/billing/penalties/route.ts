/**
 * /api/billing/penalties
 *
 * GET  — preview penalty calculations for overdue invoices (dry-run, no DB write)
 * POST — apply penalties to specified invoice IDs
 *
 * Default penalty rate: 1.5% per month = 0.05% per day
 *
 * Security checklist:
 * ✅ Auth: Manager+ required for POST
 * ✅ GET is preview-only (read-only)
 * ✅ $transaction for all writes
 * ✅ No data leaks: select only required fields
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { calculatePenalties, applyLatePenalty } from '@/services/billing.service';
import { z } from 'zod';

// Default: 1.5% per month / 30 days
const DEFAULT_DAILY_RATE = 0.015 / 30;

// GET /api/billing/penalties?dailyRate=0.0005
export async function GET(request: NextRequest) {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const dailyRate = parseFloat(searchParams.get('dailyRate') ?? String(DEFAULT_DAILY_RATE));

  // Fetch all overdue invoices (not yet fully penalised / paid)
  const invoices = await prisma.invoice.findMany({
    where: {
      status:  { in: ['overdue', 'unpaid'] },
      dueDate: { lt: new Date() },
    },
    select: {
      id:          true,
      invoiceNumber: true,
      grandTotal:  true,
      latePenalty: true,
      dueDate:     true,
      bookingId:   true,
      guestId:     true,
      guest:       { select: { firstName: true, lastName: true } },
      booking: {
        select: {
          room: { select: { number: true } },
        },
      },
    },
    orderBy: { dueDate: 'asc' },
  });

  const penalties = calculatePenalties(
    invoices.map((inv) => ({
      id:           inv.id,
      invoiceNumber: inv.invoiceNumber,
      grandTotal:   Number(inv.grandTotal),
      latePenalty:  Number(inv.latePenalty),
      dueDate:      inv.dueDate,
    })),
    dailyRate
  );

  // Enrich with guest/room info
  const enriched = penalties.map((p) => {
    const inv = invoices.find((i) => i.id === p.invoiceId)!;
    return {
      ...p,
      guestName:  `${inv.guest.firstName} ${inv.guest.lastName}`,
      roomNumber: inv.booking?.room.number ?? '—',
    };
  });

  const totalPenalty = enriched.reduce((s, p) => s + p.penaltyAmount, 0);

  return NextResponse.json({
    dailyRate,
    totalInvoices: enriched.length,
    totalPenalty,
    penalties:     enriched,
  });
}

// POST /api/billing/penalties  → apply selected penalties
const ApplyPenaltiesSchema = z.object({
  invoiceIds:  z.array(z.string().uuid()).min(1, 'ต้องเลือกอย่างน้อย 1 invoice'),
  dailyRate:   z.number().positive().optional(),
  penaltyNote: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Manager+ only
  const role = authSession.user.role;
  if (role !== 'admin' && role !== 'manager') {
    return NextResponse.json({ error: 'ต้องการสิทธิ์ Manager ขึ้นไป' }, { status: 403 });
  }

  const body   = await request.json().catch(() => ({}));
  const parsed = ApplyPenaltiesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { invoiceIds, dailyRate = DEFAULT_DAILY_RATE, penaltyNote } = parsed.data;
  const userId = authSession.user.email ?? 'system';

  // Fetch target invoices
  const invoices = await prisma.invoice.findMany({
    where: {
      id:     { in: invoiceIds },
      status: { in: ['overdue', 'unpaid'] },
    },
    select: {
      id:           true,
      invoiceNumber: true,
      grandTotal:   true,
      latePenalty:  true,
      dueDate:      true,
    },
  });

  const penalties = calculatePenalties(
    invoices.map((inv) => ({
      id:           inv.id,
      invoiceNumber: inv.invoiceNumber,
      grandTotal:   Number(inv.grandTotal),
      latePenalty:  Number(inv.latePenalty),
      dueDate:      inv.dueDate,
    })),
    dailyRate
  );

  const applied: Array<{ invoiceId: string; invoiceNumber: string; penaltyAmount: number; newGrandTotal: number }> = [];
  let skipped = 0;

  for (const p of penalties) {
    if (p.penaltyAmount <= 0) { skipped++; continue; }

    try {
      const result = await prisma.$transaction(async (tx) =>
        applyLatePenalty(tx, {
          invoiceId:     p.invoiceId,
          penaltyAmount: p.penaltyAmount,
          penaltyReason: penaltyNote ?? `เกินกำหนด ${p.daysOverdue} วัน`,
          createdBy:     userId,
        })
      );

      applied.push({
        invoiceId:     p.invoiceId,
        invoiceNumber: p.invoiceNumber,
        penaltyAmount: p.penaltyAmount,
        newGrandTotal: result.newGrandTotal,
      });
    } catch (err) {
      console.error(`Penalty failed for invoice ${p.invoiceId}:`, err);
      skipped++;
    }
  }

  return NextResponse.json({
    success:  true,
    applied:  applied.length,
    skipped,
    details:  applied,
  });
}
