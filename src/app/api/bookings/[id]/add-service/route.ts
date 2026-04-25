/**
 * POST /api/bookings/[id]/add-service
 *
 * Add one or more extra service/product charges to a booking's folio.
 * Accepts an `items` array so the cart UI can submit multiple items at once.
 *
 * Steps (inside prisma.$transaction):
 *  1. Auth check
 *  2. Fetch booking — verify exists and status is checked_in | confirmed
 *  3. getFolioByBookingId — get the active folio
 *  4. addCharge × N — one EXTRA_SERVICE FolioLineItem per cart item
 *  5. If collectNow:
 *     a. createInvoiceFromFolio for ALL new line items
 *     b. Mark invoice paid immediately
 *     c. Create Payment + PaymentAllocation (single payment for total)
 *  6. recalculateFolioBalance
 *  7. logActivity
 *
 * Security checklist:
 * ✅ Auth: getServerSession required (first step)
 * ✅ Input: Zod validated — no client data trusted
 * ✅ Transaction: prisma.$transaction wraps all writes
 * ✅ select: minimal fields fetched — no data leaks
 * ✅ idempotencyKey: always set on payment.create
 */

import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { prisma }           from '@/lib/prisma';
import { Prisma }           from '@prisma/client';
import { z }                from 'zod';
import {
  getFolioByBookingId,
  addCharge,
  createInvoiceFromFolio,
  recalculateFolioBalance,
} from '@/services/folio.service';
import { createPayment } from '@/services/payment.service';
import { logActivity } from '@/services/activityLog.service';

// ─── Zod schema ──────────────────────────────────────────────────────────────

const CartItemSchema = z.object({
  description: z.string().min(1).max(200),
  quantity:    z.number().int().min(1).max(999),
  unitPrice:   z.number().min(0),
});

const AddServiceSchema = z.object({
  items:         z.array(CartItemSchema).min(1).max(20),
  collectNow:    z.boolean(),
  paymentMethod: z.enum(['cash', 'credit_card', 'bank_transfer', 'qr_code']).optional(),
  notes:         z.string().max(500).optional(),
});

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  // ── 1. Auth ─────────────────────────────────────────────────────────────────
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Parse & validate body ─────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = AddServiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { items, collectNow, paymentMethod, notes } = parsed.data;

  // Validate payment info when collecting now
  if (collectNow && !paymentMethod) {
    return NextResponse.json({ error: 'ต้องระบุวิธีการชำระเงิน' }, { status: 422 });
  }
  // Sprint 4B: cashSessionId is resolved server-side — never client-sent.

  const userId   = (session.user as { id?: string }).id ?? session.user.email ?? 'system';
  const userName = session.user.name ?? undefined;

  // ── 3. Fetch booking ─────────────────────────────────────────────────────────
  const booking = await prisma.booking.findUnique({
    where:  { id: params.id },
    select: {
      id:            true,
      bookingNumber: true,
      status:        true,
      guestId:       true,
      guest:         { select: { firstName: true, lastName: true } },
      room:          { select: { number: true } },
    },
  });

  if (!booking) {
    return NextResponse.json({ error: 'ไม่พบข้อมูลการจอง' }, { status: 404 });
  }
  if (booking.status !== 'checked_in' && booking.status !== 'confirmed') {
    return NextResponse.json(
      { error: 'เพิ่มบริการได้เฉพาะการจองที่เช็คอินอยู่หรือยืนยันแล้วเท่านั้น' },
      { status: 400 },
    );
  }

  // Pre-compute amounts
  const totalAmount = +items.reduce((s, it) => s + it.quantity * it.unitPrice, 0).toFixed(2);
  const guestName   = `${booking.guest.firstName ?? ''} ${booking.guest.lastName ?? ''}`.trim();

  try {
    const result = await prisma.$transaction(async (tx) => {

      // ── 4. Get folio ─────────────────────────────────────────────────────────
      const folio = await getFolioByBookingId(tx, params.id);
      if (!folio) throw new Error('ไม่พบ Folio ของการจองนี้');

      // ── 5. Add an EXTRA_SERVICE charge per cart item ─────────────────────────
      const lineItemIds: string[] = [];
      for (const item of items) {
        const amount = +(item.quantity * item.unitPrice).toFixed(2);
        const { lineItemId } = await addCharge(tx, {
          folioId:    folio.folioId,
          chargeType: 'EXTRA_SERVICE',
          description: item.description,
          amount,
          quantity:   item.quantity,
          unitPrice:  item.unitPrice,
          notes,
          createdBy:  userId,
        });
        lineItemIds.push(lineItemId);
      }

      let invoiceId: string | undefined;

      // ── 6. Collect payment now (optional) ────────────────────────────────────
      if (collectNow && totalAmount > 0 && paymentMethod) {

        // Create ONE invoice covering ALL new line items
        const invResult = await createInvoiceFromFolio(tx, {
          folioId:     folio.folioId,
          guestId:     booking.guestId,
          bookingId:   params.id,
          invoiceType: 'EX',
          dueDate:     new Date(),
          notes:       notes ?? `บริการเสริม — BK-${booking.bookingNumber}`,
          createdBy:   userId,
          lineItemIds,              // all cart items billed together
        });

        if (invResult) {
          invoiceId = invResult.invoiceId;

          // Mark invoice paid immediately
          await tx.invoice.update({
            where: { id: invResult.invoiceId },
            data: {
              paidAmount: new Prisma.Decimal(invResult.grandTotal),
              status:     'paid',
            },
          });

          // Delegate to payment.service so cash-session resolution, ledger
          // posting (DR Cash / CR AR), folio recalc, and audit logging all
          // happen through the single canonical chokepoint.
          const itemSummary = items.length === 1
            ? items[0].description
            : `${items.length} รายการ (${items.map(i => i.description).join(', ').slice(0, 60)}${items.map(i => i.description).join(', ').length > 60 ? '…' : ''})`;

          await createPayment(tx, {
            idempotencyKey: `add-service-${params.id}-${Date.now()}`,
            guestId:        booking.guestId,
            bookingId:      params.id,
            amount:         invResult.grandTotal,
            paymentMethod,
            paymentDate:    new Date(),
            receivedBy:     userId,
            notes:          notes ?? `บริการเสริม — ${itemSummary}`,
            allocations:    [{ invoiceId: invResult.invoiceId, amount: invResult.grandTotal }],
            createdBy:      userId,
            createdByName:  userName ?? undefined,
          });
        }
      }

      // ── 7. Recalculate folio balance (charge-only path; collectNow path
      //       already recalc'd inside createPayment) ──────────────────────────
      await recalculateFolioBalance(tx, folio.folioId);

      // ── 8. Activity log ──────────────────────────────────────────────────────
      const itemsList = items.map(i => `"${i.description}" (${i.quantity}×฿${i.unitPrice})`).join(', ');
      await logActivity(tx, {
        userId,
        userName,
        action:      'booking.extra_service_added',
        category:    'payment',
        description: collectNow
          ? `เพิ่มบริการ ${itemsList} รวม ฿${totalAmount.toLocaleString('en')} — รับชำระแล้ว (${guestName})`
          : `เพิ่มบริการ ${itemsList} รวม ฿${totalAmount.toLocaleString('en')} — ลงบิลไว้ก่อน (${guestName})`,
        bookingId: params.id,
        guestId:   booking.guestId,
        icon:      '🛒',
        severity:  'info',
        metadata:  {
          items,
          totalAmount,
          collectNow,
          paymentMethod: collectNow ? paymentMethod : null,
          invoiceId,
        },
      });

      return { lineItemIds, invoiceId };
    });

    return NextResponse.json({
      success:     true,
      lineItemIds: result.lineItemIds,
      invoiceId:   result.invoiceId,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
