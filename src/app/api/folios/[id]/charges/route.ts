/**
 * POST /api/folios/[id]/charges
 *
 * Add a charge to an existing folio.
 * Used for extra services, utilities, penalties, etc.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { addCharge } from '@/services/folio.service';
import { z } from 'zod';

const AddChargeSchema = z.object({
  chargeType: z.enum([
    'ROOM', 'UTILITY_WATER', 'UTILITY_ELECTRIC', 'EXTRA_SERVICE',
    'PENALTY', 'DISCOUNT', 'ADJUSTMENT', 'DEPOSIT_BOOKING', 'OTHER',
  ]),
  description: z.string().min(1).max(500),
  amount: z.number().positive(),
  quantity: z.number().int().positive().optional(),
  unitPrice: z.number().optional(),
  taxType: z.enum(['included', 'excluded', 'no_tax']).optional(),
  serviceDate: z.string().optional(), // ISO date string
  productId: z.string().uuid().optional(),
  referenceType: z.string().max(50).optional(),
  referenceId: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = AddChargeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const data = parsed.data;
  const userId = session.user?.email ?? 'system';

  // Verify folio exists and is not closed
  const folio = await prisma.folio.findUnique({
    where: { id: params.id },
    select: { id: true, closedAt: true },
  });

  if (!folio) return NextResponse.json({ error: 'Folio not found' }, { status: 404 });
  if (folio.closedAt) {
    return NextResponse.json({ error: 'Folio ปิดแล้ว ไม่สามารถเพิ่มรายการได้' }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      return addCharge(tx, {
        folioId: params.id,
        chargeType: data.chargeType,
        description: data.description,
        amount: data.amount,
        quantity: data.quantity,
        unitPrice: data.unitPrice,
        taxType: data.taxType,
        serviceDate: data.serviceDate ? new Date(data.serviceDate) : undefined,
        productId: data.productId,
        referenceType: data.referenceType,
        referenceId: data.referenceId,
        notes: data.notes,
        createdBy: userId,
      });
    });

    return NextResponse.json({ success: true, lineItemId: result.lineItemId }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add charge';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
