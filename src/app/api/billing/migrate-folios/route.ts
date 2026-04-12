/**
 * POST /api/billing/migrate-folios
 *
 * One-time migration: create Folios for existing bookings that don't have one.
 * Also reconstructs FolioLineItems from existing Invoice items for historical bookings.
 *
 * Safe to run multiple times (idempotent) — skips bookings that already have a Folio.
 *
 * Security: Admin only.
 *
 * Usage:
 *   POST /api/billing/migrate-folios
 *   Body: { dryRun: true }  → preview only, no writes
 *   Body: { dryRun: false } → apply migration
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateFolioNumber } from '@/services/invoice-number.service';

export async function POST(request: NextRequest) {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Admin only — this is a destructive migration operation
  const role = (authSession.user as { role?: string }).role;
  if (role !== 'admin') {
    return NextResponse.json({ error: 'ต้องการสิทธิ์ Admin' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const dryRun = body.dryRun !== false; // default to dry run for safety
  const userId = authSession.user.email ?? 'system';

  // ── Find all bookings without a Folio ─────────────────────────────────────
  const bookingsWithoutFolio = await prisma.booking.findMany({
    where: {
      folio: null, // no folio linked
      status: { in: ['confirmed', 'checked_in', 'checked_out'] },
    },
    select: {
      id: true,
      bookingNumber: true,
      guestId: true,
      status: true,
      checkIn: true,
      checkOut: true,
      room: { select: { number: true } },
      invoices: {
        where: { status: { not: 'voided' } },
        select: {
          id: true,
          invoiceNumber: true,
          invoiceType: true,
          grandTotal: true,
          paidAmount: true,
          status: true,
          items: {
            select: {
              id: true,
              description: true,
              amount: true,
              taxType: true,
              productId: true,
              sortOrder: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const results: Array<{
    bookingId: string;
    bookingNumber: string;
    status: 'migrated' | 'skipped' | 'error';
    folioNumber?: string;
    lineItemsCreated?: number;
    reason?: string;
  }> = [];

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  if (dryRun) {
    // Preview mode — just count and list
    for (const booking of bookingsWithoutFolio) {
      const totalItems = booking.invoices.reduce(
        (sum, inv) => sum + inv.items.length,
        0,
      );
      results.push({
        bookingId: booking.id,
        bookingNumber: booking.bookingNumber,
        status: 'migrated',
        folioNumber: `FLO-[DRY_RUN]-XXXX`,
        lineItemsCreated: totalItems,
      });
      migrated++;
    }
  } else {
    // Apply migration
    for (const booking of bookingsWithoutFolio) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          // Generate folio number
          const folioNumber = await generateFolioNumber(tx);

          // Calculate totals from existing invoices
          const totalCharges = booking.invoices.reduce(
            (sum, inv) => sum + Number(inv.grandTotal),
            0,
          );
          const totalPayments = booking.invoices.reduce(
            (sum, inv) => sum + Number(inv.paidAmount ?? 0),
            0,
          );
          const balance = totalCharges - totalPayments;

          // Create Folio
          const folio = await tx.folio.create({
            data: {
              folioNumber,
              bookingId: booking.id,
              guestId: booking.guestId,
              totalCharges,
              totalPayments,
              balance,
              // If booking is checked_out, close the folio
              closedAt:
                booking.status === 'checked_out' ? new Date() : null,
              notes: `Migrated from legacy booking ${booking.bookingNumber}`,
            },
            select: { id: true, folioNumber: true },
          });

          // Create FolioLineItems from existing invoice items
          let lineItemsCreated = 0;

          for (const invoice of booking.invoices) {
            // Determine billing status based on invoice status
            const billingStatus =
              invoice.status === 'paid'
                ? 'PAID'
                : invoice.status === 'cancelled' || invoice.status === 'voided'
                ? 'VOIDED'
                : 'BILLED'; // unpaid/partial/overdue = BILLED (already invoiced)

            for (const item of invoice.items) {
              // Create FolioLineItem
              const lineItem = await tx.folioLineItem.create({
                data: {
                  folioId: folio.id,
                  chargeType: guessChargeType(invoice.invoiceType),
                  description: item.description,
                  amount: item.amount,
                  quantity: 1,
                  unitPrice: item.amount,
                  taxType: item.taxType as never,
                  billingStatus: billingStatus as never,
                  createdBy: userId,
                  notes: `Migrated from ${invoice.invoiceNumber}`,
                },
                select: { id: true },
              });

              // Link InvoiceItem → FolioLineItem (update invoice_items record)
              // Only link if the invoice_item doesn't already have a folioLineItemId
              await tx.invoiceItem.update({
                where: { id: item.id },
                data: { folioLineItemId: lineItem.id },
              });

              lineItemsCreated++;
            }

            // Link invoice → folio
            await tx.invoice.update({
              where: { id: invoice.id },
              data: { folioId: folio.id },
            });
          }

          return { folioNumber: folio.folioNumber, lineItemsCreated };
        });

        migrated++;
        results.push({
          bookingId: booking.id,
          bookingNumber: booking.bookingNumber,
          status: 'migrated',
          folioNumber: result.folioNumber,
          lineItemsCreated: result.lineItemsCreated,
        });
      } catch (err) {
        errors++;
        results.push({
          bookingId: booking.id,
          bookingNumber: booking.bookingNumber,
          status: 'error',
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  }

  return NextResponse.json({
    dryRun,
    summary: {
      total: bookingsWithoutFolio.length,
      migrated,
      skipped,
      errors,
    },
    results,
  });
}

// ─── GET — preview how many bookings need migration ──────────────────────────

export async function GET(request: NextRequest) {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = (authSession.user as { role?: string }).role;
  if (role !== 'admin') {
    return NextResponse.json({ error: 'ต้องการสิทธิ์ Admin' }, { status: 403 });
  }

  const [totalBookings, bookingsWithFolio, bookingsWithoutFolio] =
    await Promise.all([
      prisma.booking.count({
        where: { status: { in: ['confirmed', 'checked_in', 'checked_out'] } },
      }),
      prisma.folio.count(),
      prisma.booking.count({
        where: {
          folio: null,
          status: { in: ['confirmed', 'checked_in', 'checked_out'] },
        },
      }),
    ]);

  return NextResponse.json({
    totalBookings,
    bookingsWithFolio,
    bookingsWithoutFolio,
    migrationNeeded: bookingsWithoutFolio > 0,
    message:
      bookingsWithoutFolio > 0
        ? `พบ ${bookingsWithoutFolio} bookings ที่ยังไม่มี Folio — POST { "dryRun": false } เพื่อ migrate`
        : 'ทุก booking มี Folio แล้ว ✅',
  });
}

// ─── Helper: map InvoiceType → FolioChargeType ───────────────────────────────

function guessChargeType(invoiceType: string): string {
  const map: Record<string, string> = {
    daily_stay: 'ROOM',
    monthly_rent: 'ROOM',
    utility: 'UTILITY_ELECTRIC',
    extra_service: 'EXTRA_SERVICE',
    deposit_receipt: 'DEPOSIT_BOOKING',
    checkout_balance: 'ROOM',
    general: 'OTHER',
  };
  return map[invoiceType] ?? 'OTHER';
}
