/**
 * POST /api/billing/drafts/[id]/edit
 *
 * Inline edit of a draft invoice's amounts (and optionally the cycle period)
 * before approval. Only works while invoice.status = 'draft'. No ledger touched.
 *
 * Role: admin | manager
 *
 * Body (all optional, at least one required):
 *   {
 *     rentAmount?:     number ≥ 0,
 *     waterUsage?:     number ≥ 0,   ← units consumed (NOT baht)
 *     electricUsage?:  number ≥ 0,   ← units consumed (NOT baht)
 *     periodStart?:    "YYYY-MM-DD"  ← new cycle start
 *     periodEnd?:      "YYYY-MM-DD"  ← new cycle end (must be >= periodStart)
 *     notes?:          string ≤ 500,
 *   }
 *
 * Period change logic (inside tx):
 *   1. Update Invoice.billingPeriodStart / billingPeriodEnd.
 *   2. Update the ROOM FolioLineItem's serviceDate / periodEnd.
 *   3. Re-pro-rate rent UNLESS rentAmount was explicitly provided in this request.
 *      newRent = bookingRate × newDays / fullCycleDays (UTC month length).
 *
 * Returns: { ok: true, newGrandTotal: number, newPeriodStart?: string, newPeriodEnd?: string }
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
    periodStart:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    periodEnd:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes:         z.string().max(500).optional(),
  })
  .refine(
    (d) =>
      d.rentAmount    !== undefined ||
      d.waterUsage    !== undefined ||
      d.electricUsage !== undefined ||
      d.periodStart   !== undefined ||
      d.periodEnd     !== undefined ||
      d.notes         !== undefined,
    { message: 'ต้องระบุอย่างน้อย 1 field (rentAmount, waterUsage, electricUsage, periodStart, periodEnd, notes)' },
  )
  .refine(
    (d) => {
      if (!d.periodEnd || !d.periodStart) return true;
      return d.periodEnd >= d.periodStart;
    },
    { message: 'periodEnd must be >= periodStart', path: ['periodEnd'] },
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
          billingPeriodStart: true,
          billingPeriodEnd: true,
          booking: {
            select: { roomId: true, rate: true, id: true },
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
                  serviceDate: true,
                  periodEnd: true,
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
      const lineItemsByType = new Map<string, {
        id: string;
        amount: Prisma.Decimal;
        serviceDate: Date | null;
        periodEnd: Date | null;
      }>();
      for (const item of inv.items) {
        if (item.folioLineItem) {
          lineItemsByType.set(item.folioLineItem.chargeType, {
            id:          item.folioLineItem.id,
            amount:      item.folioLineItem.amount,
            serviceDate: item.folioLineItem.serviceDate,
            periodEnd:   item.folioLineItem.periodEnd,
          });
        }
      }

      // ── Guard: reject if a usage/amount field has no matching line item ────
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

      // ── Period change ────────────────────────────────────────────────────────
      let newPeriodStart: Date | undefined;
      let newPeriodEnd: Date | undefined;
      let periodStartStr: string | undefined;
      let periodEndStr: string | undefined;

      if (body.periodStart || body.periodEnd) {
        // Parse as UTC midnight (consistent with rest of codebase)
        const resolvedStart = body.periodStart
          ? new Date(body.periodStart + 'T00:00:00.000Z')
          : inv.billingPeriodStart ?? undefined;
        const resolvedEnd = body.periodEnd
          ? new Date(body.periodEnd + 'T00:00:00.000Z')
          : inv.billingPeriodEnd ?? undefined;

        if (!resolvedStart || !resolvedEnd) {
          throw Object.assign(
            new Error('ไม่สามารถกำหนดช่วงเวลาได้ — invoice ไม่มี billingPeriodStart/End เดิม'),
            { statusCode: 422 },
          );
        }

        newPeriodStart = resolvedStart;
        newPeriodEnd   = resolvedEnd;
        periodStartStr = body.periodStart ?? inv.billingPeriodStart?.toISOString().slice(0, 10);
        periodEndStr   = body.periodEnd   ?? inv.billingPeriodEnd?.toISOString().slice(0, 10);

        // 1. Update Invoice billing period columns
        await tx.invoice.update({
          where: { id: params.id },
          data:  { billingPeriodStart: newPeriodStart, billingPeriodEnd: newPeriodEnd },
        });

        // 2. Update ROOM line's serviceDate + periodEnd
        const roomLi = lineItemsByType.get('ROOM');
        if (roomLi) {
          await tx.folioLineItem.update({
            where: { id: roomLi.id },
            data:  { serviceDate: newPeriodStart, periodEnd: newPeriodEnd },
          });

          // 3. Re-pro-rate rent UNLESS rentAmount was explicitly provided
          if (body.rentAmount === undefined) {
            const bookingRate = inv.booking?.rate;
            if (!bookingRate) {
              throw Object.assign(
                new Error('ไม่พบ booking rate — ไม่สามารถคำนวณค่าเช่าใหม่ได้'),
                { statusCode: 422 },
              );
            }

            const newDays = Math.round(
              (newPeriodEnd.getTime() - newPeriodStart.getTime()) / 86_400_000,
            ) + 1;

            // Full cycle days = days in newPeriodStart's month (UTC)
            const year  = newPeriodStart.getUTCFullYear();
            const month = newPeriodStart.getUTCMonth();
            const fullCycleDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

            const newRent = new Prisma.Decimal(bookingRate)
              .mul(newDays)
              .div(fullCycleDays)
              .toDecimalPlaces(2);

            await tx.folioLineItem.update({
              where: { id: roomLi.id },
              data:  { amount: newRent, unitPrice: newRent },
            });
            lineItemsByType.set('ROOM', { ...roomLi, amount: newRent });
          }
        }
      }

      // ── Rate lookup — only needed if a utility field is being edited ────────
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

      // ── Apply explicit amount edits ──────────────────────────────────────────

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

      return {
        newGrandTotal: Number(newGrandTotal),
        newPeriodStart: periodStartStr,
        newPeriodEnd:   periodEndStr,
      };
    });

    return NextResponse.json({ ok: true, ...result });
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
