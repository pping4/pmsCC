/**
 * GET /api/reports/vat-sales?from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|csv
 *
 * Thai VAT sales (output tax) report — รายงานภาษีขาย.
 *
 * Auth:
 *   ✅ session required; admin OR accountant role
 *
 * Semantics:
 *   - Invoices issued within [from, to] inclusive, status != voided/cancelled
 *   - vatAmount may be 0 (non-VAT invoice) — still returned so Σ matches books
 *   - Taxable base = subtotal + serviceCharge (service charge is taxable in TH)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fmtDate, fmtBaht } from '@/lib/date-format';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session as { user?: { role?: string } }).user?.role ?? '';
  if (!['admin', 'accountant', 'manager'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const fromStr = sp.get('from');
  const toStr   = sp.get('to');
  const format  = (sp.get('format') ?? 'json').toLowerCase();

  if (!fromStr || !toStr) {
    return NextResponse.json(
      { error: 'Missing ?from=YYYY-MM-DD&to=YYYY-MM-DD' },
      { status: 400 },
    );
  }
  const from = new Date(fromStr);
  const to   = new Date(toStr);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
  }

  const rows = await prisma.invoice.findMany({
    where: {
      issueDate: { gte: from, lte: to },
      status: { notIn: ['voided', 'cancelled'] },
    },
    select: {
      id:             true,
      invoiceNumber:  true,
      issueDate:      true,
      subtotal:       true,
      serviceCharge:  true,
      vatAmount:      true,
      grandTotal:     true,
      isVatInclusive: true,
      guest:          { select: { firstName: true, lastName: true, companyTaxId: true, companyName: true } },
    },
    orderBy: { issueDate: 'asc' },
  });

  const items = rows.map(r => ({
    invoiceId:      r.id,
    invoiceNumber:  r.invoiceNumber,
    issueDate:      fmtDate(r.issueDate),
    customerName:   r.guest.companyName ?? `${r.guest.firstName} ${r.guest.lastName}`.trim(),
    customerTaxId:  r.guest.companyTaxId ?? '',
    subtotal:       Number(r.subtotal),
    serviceCharge:  Number(r.serviceCharge ?? 0),
    taxableBase:    Number(r.subtotal) + Number(r.serviceCharge ?? 0),
    vatAmount:      Number(r.vatAmount),
    grandTotal:     Number(r.grandTotal),
    vatInclusive:   r.isVatInclusive,
  }));

  const totals = items.reduce(
    (t, i) => ({
      subtotal:      t.subtotal      + i.subtotal,
      serviceCharge: t.serviceCharge + i.serviceCharge,
      taxableBase:   t.taxableBase   + i.taxableBase,
      vatAmount:     t.vatAmount     + i.vatAmount,
      grandTotal:    t.grandTotal    + i.grandTotal,
    }),
    { subtotal: 0, serviceCharge: 0, taxableBase: 0, vatAmount: 0, grandTotal: 0 },
  );

  if (format === 'csv') {
    const header = [
      'วันที่', 'เลขที่ใบกำกับ', 'ชื่อลูกค้า', 'เลขผู้เสียภาษี',
      'มูลค่าสินค้า/บริการ', 'ค่าบริการ', 'ฐานภาษี', 'VAT', 'รวมทั้งสิ้น', 'รวม VAT',
    ];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      header.map(esc).join(','),
      ...items.map(i => [
        i.issueDate, i.invoiceNumber, i.customerName, i.customerTaxId,
        fmtBaht(i.subtotal), fmtBaht(i.serviceCharge), fmtBaht(i.taxableBase),
        fmtBaht(i.vatAmount), fmtBaht(i.grandTotal), i.vatInclusive ? 'Y' : 'N',
      ].map(v => esc(String(v))).join(',')),
      // totals row
      [
        '', 'รวม', '', '',
        fmtBaht(totals.subtotal), fmtBaht(totals.serviceCharge),
        fmtBaht(totals.taxableBase), fmtBaht(totals.vatAmount),
        fmtBaht(totals.grandTotal), '',
      ].map(v => esc(String(v))).join(','),
    ];
    const csv = '\uFEFF' + lines.join('\r\n'); // BOM for Excel Thai
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition':
          `attachment; filename="vat-sales-${fromStr}-to-${toStr}.csv"`,
      },
    });
  }

  return NextResponse.json({
    period: { from: fromStr, to: toStr },
    items,
    totals,
  });
}
