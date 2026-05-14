/**
 * POST /api/billing/drafts/[id]/edit
 *
 * Inline edit of a draft invoice's amounts before approval.
 * Only works while invoice.status = 'draft'. No ledger is touched.
 *
 * Role: admin | manager
 *
 * Body (all optional, at least one required):
 *   {
 *     rentAmount?:     number ≥ 0,
 *     waterUsage?:     number ≥ 0,   ← units consumed (NOT baht)
 *     electricUsage?:  number ≥ 0,   ← units consumed (NOT baht)
 *     notes?:          string ≤ 500,
 *   }
 *
 * Strategy:
 *   1. Load the invoice's folio line items grouped by chargeType.
 *   2. Validate that every usage/amount field has a matching FolioLineItem (422 if not).
 *   3. For waterUsage / electricUsage: look up the most recent UtilityReading for
 *      the booking's room to get the per-unit rate, then compute baht = units × rate.
 *   4. For each provided field, update the matching FolioLineItem with the computed amount.
 *   5. Recompute Invoice.grandTotal as the sum of the (updated) DRAFT line items.
 *
 * Returns: { ok: true, newGrandTotal: number }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/rbac';
import { Prisma } from '@prisma/client';

// ─── Zod schema ──────────────────────────────────────────────────────────────

const Body = z
  .object({
    rentAmount:    z.number().nonnegative().optional(),
    waterUsage:    z.number().nonnegative().optional(),
    electricUsage: z.number().nonnegative().optional(),
    notes:         z.string().max(500).optional(),
  })
  .refine(
    (d) =>
      d.rentAmount !== undefined ||
      d.waterUsage !== undefined ||
      d.electricUsage !== undefined ||
      d.notes !== undefined,
    { message: 'ต้องระบุอย่างน้อย 1 field (rentAmount, waterUsage, electricUsage, notes)' },
  );

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const forbidden = requireRole(session, ['admin', 'manager']);
  if (forbidden) return forbidden;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง', details: err.issues.map((i) => ({ path: i.path, message: i.message })) },
        { status: 400 },
      );
    }
    throw err;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Row-lock the invoice
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${params.id} FOR UPDATE`;

      const inv = await tx.invoice.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          status: true,
          notes: true,
          // We need roomId (via booking) for the utility rate lookup
          booking: {
            select: { roomId: true },
          },
          items: {
            select: {
              id: true,
              folioLineItemId: true,
              folioLineItem: {
                select: {
                  id: true,
                  chargeType: true,
                  amount: true,
                  quantity: true,
                  unitPrice: true,
                },
              },
            },
          },
        },
      });

      if (!inv) {
        throw Object.assign(new Error('Invoice not found'), { statusCode: 404 });
      }
      if (inv.status !== 'draft') {
        throw Object.assign(
          new Error(`Invoice is not in draft status (was ${inv.status})`),
          { statusCode: 409 },
        );
      }

      // Map chargeType → FolioLineItem for this invoice
      const lineItemsByType = new Map<string, { id: string; amount: Prisma.Decimal }>();
      for (const item of inv.items) {
        if (item.folioLineItem) {
          lineItemsByType.set(item.folioLineItem.chargeType, {
            id:     item.folioLineItem.id,
            amount: item.folioLineItem.amount,
          });
        }
      }

      // ── Guard: reject if a usage/amount field has no matching line item ────
      // This check runs BEFORE the rate lookup so a draft that only has a ROOM
      // line doesn't fail when only rentAmount is edited.
      const unmatched: string[] = [];
      if (body.waterUsage    !== undefined && !lineItemsByType.has('UTILITY_WATER'))   unmatched.push('waterUsage');
      if (body.electricUsage !== undefined && !lineItemsByType.has('UTILITY_ELECTRIC')) unmatched.push('electricUsage');
      if (body.rentAmount    !== undefined && !lineItemsByType.has('ROOM'))             unmatched.push('rentAmount');
      if (unmatched.length > 0) {
        throw Object.assign(
          new Error(`ไม่มี line item สำหรับ field: ${unmatched.join(', ')}`),
          { statusCode: 422, unmatched },
        );
      }

      // ── Rate lookup — only needed if a utility field is being edited ────────
      //
      // generateDraftInvoice calls addCharge() for utilities with quantity=1
      // and unitPrice defaulting to amount (= total baht charge, not the rate).
      // So we cannot recover the per-unit rate from the existing line item.
      // Instead we look up the most-recent UtilityReading for the booking's room,
      // which is what generateDraftInvoice itself used to compute the original charge.
      let waterRate    = 0;
      let electricRate = 0;

      const needsRateLookup =
        body.waterUsage !== undefined || body.electricUsage !== undefined;

      if (needsRateLookup) {
        const roomId = inv.booking?.roomId;
        if (!roomId) {
          throw Object.assign(
            new Error('Invoice ไม่มี booking link — ไม่สามารถค้นหาอัตราค่าสาธารณูปโภคได้'),
            { statusCode: 422 },
          );
        }

        const reading = await tx.utilityReading.findFirst({
          where: {
            roomId,
            readingDate: { not: null },
          },
          orderBy: { readingDate: 'desc' },
          select: { waterRate: true, electricRate: true },
        });

        if (!reading) {
          throw Object.assign(
            new Error(
              'ไม่พบข้อมูลมิเตอร์สำหรับห้องนี้ — กรุณาบันทึกการอ่านมิเตอร์ก่อนแก้ไขค่าสาธารณูปโภค',
            ),
            { statusCode: 422 },
          );
        }

        waterRate    = Number(reading.waterRate);
        electricRate = Number(reading.electricRate);
      }

      // ── Apply edits ─────────────────────────────────────────────────────────

      if (body.rentAmount !== undefined) {
        const li = lineItemsByType.get('ROOM')!;
        await tx.folioLineItem.update({
          where: { id: li.id },
          data:  { amount: new Prisma.Decimal(body.rentAmount), unitPrice: new Prisma.Decimal(body.rentAmount) },
        });
        lineItemsByType.set('ROOM', { ...li, amount: new Prisma.Decimal(body.rentAmount) });
      }

      if (body.waterUsage !== undefined) {
        const li = lineItemsByType.get('UTILITY_WATER')!;
        // Compute baht charge: units × rate (same formula as generateDraftInvoice)
        const newAmount = new Prisma.Decimal(body.waterUsage)
          .mul(waterRate)
          .toDecimalPlaces(2);
        await tx.folioLineItem.update({
          where: { id: li.id },
          data:  {
            amount:      newAmount,
            quantity:    body.waterUsage,
            unitPrice:   new Prisma.Decimal(waterRate),
            description: `ค่าน้ำ (${body.waterUsage} หน่วย × ${waterRate}) — แก้ไขโดย manager`,
          },
        });
        lineItemsByType.set('UTILITY_WATER', { ...li, amount: newAmount });
      }

      if (body.electricUsage !== undefined) {
        const li = lineItemsByType.get('UTILITY_ELECTRIC')!;
        // Compute baht charge: units × rate (same formula as generateDraftInvoice)
        const newAmount = new Prisma.Decimal(body.electricUsage)
          .mul(electricRate)
          .toDecimalPlaces(2);
        await tx.folioLineItem.update({
          where: { id: li.id },
          data:  {
            amount:      newAmount,
            quantity:    body.electricUsage,
            unitPrice:   new Prisma.Decimal(electricRate),
            description: `ค่าไฟ (${body.electricUsage} หน่วย × ${electricRate}) — แก้ไขโดย manager`,
          },
        });
        lineItemsByType.set('UTILITY_ELECTRIC', { ...li, amount: newAmount });
      }

      // Recompute grandTotal from updated line items
      let newGrandTotal = new Prisma.Decimal(0);
      for (const [, li] of lineItemsByType) {
        newGrandTotal = newGrandTotal.add(li.amount);
      }

      // Update invoice totals + notes
      await tx.invoice.update({
        where: { id: params.id },
        data: {
          subtotal:   newGrandTotal,
          grandTotal: newGrandTotal,
          ...(body.notes !== undefined && { notes: body.notes }),
        },
      });

      return Number(newGrandTotal);
    });

    return NextResponse.json({ ok: true, newGrandTotal: result });
  } catch (err) {
    if (err instanceof Error && 'statusCode' in err) {
      const code = (err as Error & { statusCode: number }).statusCode;
      const extra = 'unmatched' in err ? { unmatched: (err as Error & { unmatched: string[] }).unmatched } : {};
      return NextResponse.json({ error: err.message, ...extra }, { status: code });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    console.error('[POST /api/billing/drafts/[id]/edit]', err);
    return NextResponse.json({ error: 'ไม่สามารถแก้ไข draft ได้' }, { status: 500 });
  }
}
