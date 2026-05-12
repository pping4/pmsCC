/**
 * One-off backfill — cut INV-EX for orphan UNBILLED FolioLineItem rows.
 *
 * Why: before Phase 6.7/6.9/6.11 landed, these flows would skip creating an
 * invoice when the cashier picked "ลงบิลไว้ก่อน" / "เก็บเงินภายหลัง":
 *   - /api/bookings/[id]/extend     (Phase 6.7)
 *   - /api/checkin                  (Phase 6.9)
 *   - /api/bookings/[id]/add-service (Phase 6.11)
 * Result: FolioLineItem rows were added with billingStatus=UNBILLED and no
 * Invoice attached → Bill tab couldn't surface them, cashier had no row to
 * collect against until checkout.
 *
 * This script scans every Folio for UNBILLED rows, groups by folio, and
 * cuts ONE INV-EX per folio covering all that folio's UNBILLED items via
 * createInvoiceFromFolio (which also flips the line items to BILLED).
 *
 * Safety:
 *   - Dry-run by default (pass --apply to commit).
 *   - Idempotent — re-running after fix is a no-op because no rows are
 *     UNBILLED anymore.
 *   - Skips folios attached to bookings with status in (cancelled,
 *     checked_out) since those are closed.
 *   - Per-folio $transaction.
 *
 *   node scripts/_backfill-unbilled-invoices.mjs               # dry-run
 *   node scripts/_backfill-unbilled-invoices.mjs --apply        # commit
 */

import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const APPLY = process.argv.includes('--apply');

const log = (...a) => console.log(...a);

async function main() {
  log(APPLY ? '🟢 APPLY mode' : '🔍 DRY-RUN (pass --apply to commit)');
  log('');

  // Find every folio that has at least one UNBILLED row
  const folios = await p.folio.findMany({
    where: {
      lineItems: { some: { billingStatus: 'UNBILLED' } },
      booking:   { status: { in: ['confirmed', 'checked_in'] } },
    },
    select: {
      id: true, folioNumber: true,
      booking: { select: { id: true, bookingNumber: true, status: true, guestId: true } },
      lineItems: {
        where: { billingStatus: 'UNBILLED' },
        select: { id: true, description: true, chargeType: true, amount: true },
      },
    },
  });

  if (folios.length === 0) {
    log('✅  No UNBILLED orphans found — already clean.');
    await p.$disconnect();
    return;
  }

  log(`Found ${folios.length} folio(s) with UNBILLED orphans:\n`);

  let totalRows = 0;
  let totalAmount = 0;
  const invoicesPlanned = [];

  for (const f of folios) {
    const sum = f.lineItems.reduce((s, l) => s + Number(l.amount), 0);
    totalRows += f.lineItems.length;
    totalAmount += sum;
    log(`  📒 ${f.folioNumber} · BK-${f.booking?.bookingNumber} (${f.booking?.status})`);
    f.lineItems.forEach(l => log(
      `      - ${l.chargeType.padEnd(15)} ฿${String(l.amount).padStart(8)} · ${l.description}`
    ));
    log(`      → would cut 1 INV-EX for ฿${sum.toFixed(2)} (${f.lineItems.length} rows)\n`);
    invoicesPlanned.push({ folio: f, sum });
  }

  log(`Total: ${folios.length} invoices to cut, ${totalRows} line items, ฿${totalAmount.toFixed(2)}`);

  if (!APPLY) {
    log('\n(re-run with --apply to commit)');
    await p.$disconnect();
    return;
  }

  // Apply — import the service dynamically (route uses 'EX' type)
  const { createInvoiceFromFolio } = await import('../src/services/folio.service.ts');

  log('\n--- applying ---');
  let createdCount = 0;
  for (const { folio: f } of invoicesPlanned) {
    try {
      const lineItemIds = f.lineItems.map(l => l.id);
      const result = await p.$transaction(async (tx) => {
        return createInvoiceFromFolio(tx, {
          folioId:     f.id,
          guestId:     f.booking.guestId,
          bookingId:   f.booking.id,
          invoiceType: 'EX',
          dueDate:     new Date(),
          notes:       `Backfill — ลงบิลรายการค้างที่เคยเป็น UNBILLED (orphan ก่อน Phase 6.7/6.9/6.11)`,
          createdBy:   'system-backfill',
          lineItemIds,
        });
      });
      if (result) {
        log(`  ✓ ${f.folioNumber}: ${result.invoiceNumber} · ฿${result.grandTotal}`);
        createdCount++;
      } else {
        log(`  ⚠ ${f.folioNumber}: no invoice created (returned null)`);
      }
    } catch (err) {
      log(`  ✗ ${f.folioNumber}: ${err instanceof Error ? err.message : err}`);
    }
  }
  log(`\n✅  Created ${createdCount} invoice(s)`);

  await p.$disconnect();
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1); });
