/**
 * taxInvoice.service.ts — Sprint 5 Phase 6
 *
 * Creates a Thai Revenue-Department-compliant tax invoice (ใบกำกับภาษี) by
 * bundling one or more existing Invoice rows for a single customer.
 *
 * Design decisions (see plan §6):
 *  - Tax invoices are separate from receipts per D5 — own running number series.
 *  - Customer data is a *frozen snapshot* on the TaxInvoice row; accountants
 *    may edit the customer data at issue time (e.g. add taxId) without
 *    retroactively mutating the Guest row.
 *  - An Invoice can only be covered by ONE *ISSUED* TaxInvoice. Re-issuing
 *    after voiding is allowed (gap in sequence, preserved with VOIDED status).
 *  - Amounts are aggregated from the Invoice rows — never trusted from client.
 *  - Number is allocated as the LAST step before insert, inside the same tx,
 *    via nextSequenceNumber() which uses SELECT FOR UPDATE.
 */

import { Prisma, type TaxInvoiceStatus } from '@prisma/client';
import { nextSequenceNumber } from './numberSequence.service';

type TxClient = Prisma.TransactionClient;

export interface CreateTaxInvoiceInput {
  customerName:      string;
  customerTaxId?:    string;
  customerBranch?:   string;
  customerAddress?:  string;
  coveredInvoiceIds: string[];     // ≥ 1
  coveredPaymentIds?: string[];
  issueDate?:        Date;
  issuedByUserId:    string;
}

export interface TaxInvoiceSummary {
  id: string;
  number: string;
  issueDate: Date;
  customerName: string;
  grandTotal: number;
  status: TaxInvoiceStatus;
}

export interface TaxInvoiceCoveredInvoice {
  id: string;
  invoiceNumber: string;
  issueDate: Date;
  subtotal: number;
  vatAmount: number;
  serviceCharge: number;
  grandTotal: number;
}

export interface TaxInvoiceDetail {
  id: string;
  number: string;
  issueDate: Date;
  customerName: string;
  customerTaxId: string | null;
  customerBranch: string | null;
  customerAddress: string | null;
  subtotal: number;
  vatAmount: number;
  grandTotal: number;
  coveredInvoiceIds: string[];
  coveredPaymentIds: string[];
  status: TaxInvoiceStatus;
  voidReason: string | null;
  voidedAt: Date | null;
  voidedBy: string | null;
  issuedByUserId: string;
  createdAt: Date;
  invoices: TaxInvoiceCoveredInvoice[];
}

/**
 * Create one TaxInvoice covering the given invoice IDs.
 *
 * Errors thrown (translated to HTTP codes by the caller):
 *   - 'NO_INVOICES'            → 422  (empty coveredInvoiceIds)
 *   - 'INVOICES_NOT_FOUND'     → 404  (one or more IDs missing)
 *   - 'MIXED_CUSTOMERS'        → 422  (invoices span multiple guests)
 *   - 'INVOICE_ALREADY_COVERED'→ 409  (any invoice already in an ISSUED TI)
 *   - Prisma P2002             → 409  (unique number collision — shouldn't happen, FOR UPDATE guards it)
 */
export async function createTaxInvoice(
  tx: TxClient,
  input: CreateTaxInvoiceInput,
): Promise<TaxInvoiceDetail> {
  if (!input.coveredInvoiceIds || input.coveredInvoiceIds.length === 0) {
    throw new Error('NO_INVOICES');
  }

  // 1) Fetch invoices — must exist, share a single customer
  const invoices = await tx.invoice.findMany({
    where: { id: { in: input.coveredInvoiceIds } },
    select: {
      id: true, invoiceNumber: true, issueDate: true, guestId: true, status: true,
      subtotal: true, vatAmount: true, serviceCharge: true, grandTotal: true,
    },
  });

  if (invoices.length !== input.coveredInvoiceIds.length) {
    throw new Error('INVOICES_NOT_FOUND');
  }
  const guestIds = new Set(invoices.map((i) => i.guestId));
  if (guestIds.size !== 1) throw new Error('MIXED_CUSTOMERS');

  // 2) Ensure none are already covered by an ISSUED TI
  //    We scan tax_invoices for an overlapping ID in coveredInvoiceIds.
  //    Uses the GIN ability of Postgres array overlap operator via queryRawUnsafe.
  const existing = await tx.$queryRaw<Array<{ id: string; number: string; overlap: string[] }>>`
    SELECT id, number, covered_invoice_ids AS overlap
    FROM tax_invoices
    WHERE status = 'ISSUED'
      AND covered_invoice_ids && ${input.coveredInvoiceIds}::text[]
    LIMIT 1
  `;
  if (existing.length > 0) {
    const clash = existing[0];
    const conflict = clash.overlap.find((id) => input.coveredInvoiceIds.includes(id));
    throw Object.assign(new Error('INVOICE_ALREADY_COVERED'), { conflictingInvoiceId: conflict, taxInvoiceNumber: clash.number });
  }

  // 3) Aggregate amounts from the authoritative Invoice rows (VAT is already
  //    computed at invoice time; we sum the per-invoice totals)
  const agg = invoices.reduce(
    (acc, inv) => ({
      subtotal:      acc.subtotal      + Number(inv.subtotal),
      vatAmount:     acc.vatAmount     + Number(inv.vatAmount),
      serviceCharge: acc.serviceCharge + Number(inv.serviceCharge),
      grandTotal:    acc.grandTotal    + Number(inv.grandTotal),
    }),
    { subtotal: 0, vatAmount: 0, serviceCharge: 0, grandTotal: 0 },
  );

  // 4) Allocate number LAST — inside the tx so rollback reclaims it
  const issueDate = input.issueDate ?? new Date();
  const number = await nextSequenceNumber(tx, 'TAX_INVOICE', issueDate);

  // 5) Create row
  const created = await tx.taxInvoice.create({
    data: {
      number,
      issueDate,
      customerName:    input.customerName.trim(),
      customerTaxId:   input.customerTaxId?.trim() || null,
      customerBranch:  input.customerBranch?.trim() || null,
      customerAddress: input.customerAddress?.trim() || null,
      subtotal:        agg.subtotal,
      vatAmount:       agg.vatAmount,
      grandTotal:      agg.grandTotal,
      coveredInvoiceIds: input.coveredInvoiceIds,
      coveredPaymentIds: input.coveredPaymentIds ?? [],
      issuedByUserId:  input.issuedByUserId,
    },
    select: {
      id: true, number: true, issueDate: true,
      customerName: true, customerTaxId: true, customerBranch: true, customerAddress: true,
      subtotal: true, vatAmount: true, grandTotal: true,
      coveredInvoiceIds: true, coveredPaymentIds: true,
      status: true, voidReason: true, voidedAt: true, voidedBy: true,
      issuedByUserId: true, createdAt: true,
    },
  });

  // 6) Audit log
  await tx.activityLog.create({
    data: {
      userId:   input.issuedByUserId,
      action:   'TAX_INVOICE_ISSUED',
      category: 'finance',
      description: `ออกใบกำกับภาษี ${created.number} · ${input.customerName} · ${agg.grandTotal.toFixed(2)}`,
      icon: '🧾',
      severity: 'info',
      metadata: {
        taxInvoiceId: created.id,
        number: created.number,
        customerName: input.customerName,
        customerTaxId: input.customerTaxId ?? null,
        coveredInvoiceIds: input.coveredInvoiceIds,
        grandTotal: agg.grandTotal,
      },
    },
  });

  return {
    ...created,
    subtotal:  Number(created.subtotal),
    vatAmount: Number(created.vatAmount),
    grandTotal: Number(created.grandTotal),
    invoices: invoices.map((i) => ({
      id: i.id, invoiceNumber: i.invoiceNumber, issueDate: i.issueDate,
      subtotal:      Number(i.subtotal),
      vatAmount:     Number(i.vatAmount),
      serviceCharge: Number(i.serviceCharge),
      grandTotal:    Number(i.grandTotal),
    })),
  };
}

export async function voidTaxInvoice(
  tx: TxClient,
  id: string,
  reason: string,
  actorUserId: string,
): Promise<{ id: string; number: string; status: TaxInvoiceStatus }> {
  const ti = await tx.taxInvoice.findUnique({
    where: { id },
    select: { id: true, number: true, status: true },
  });
  if (!ti) throw new Error('NOT_FOUND');
  if (ti.status !== 'ISSUED') throw new Error('ALREADY_VOIDED');
  if (!reason || reason.trim().length < 3) throw new Error('REASON_REQUIRED');

  const updated = await tx.taxInvoice.update({
    where: { id },
    data: {
      status:     'VOIDED',
      voidReason: reason.trim(),
      voidedAt:   new Date(),
      voidedBy:   actorUserId,
    },
    select: { id: true, number: true, status: true },
  });

  await tx.activityLog.create({
    data: {
      userId:   actorUserId,
      action:   'TAX_INVOICE_VOIDED',
      category: 'finance',
      description: `ยกเลิกใบกำกับภาษี ${ti.number} · เหตุผล: ${reason.trim()}`,
      icon: '🧾',
      severity: 'warning',
      metadata: { taxInvoiceId: id, number: ti.number, reason: reason.trim() },
    },
  });

  return updated;
}

export async function listTaxInvoices(
  tx: TxClient,
  filters: { status?: TaxInvoiceStatus; from?: Date; to?: Date; customerTaxId?: string } = {},
  take = 200,
): Promise<TaxInvoiceSummary[]> {
  const where: Prisma.TaxInvoiceWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.customerTaxId) where.customerTaxId = filters.customerTaxId;
  if (filters.from || filters.to) {
    where.issueDate = {};
    if (filters.from) where.issueDate.gte = filters.from;
    if (filters.to)   where.issueDate.lt  = filters.to;
  }

  const rows = await tx.taxInvoice.findMany({
    where,
    orderBy: [{ issueDate: 'desc' }, { number: 'desc' }],
    take,
    select: {
      id: true, number: true, issueDate: true,
      customerName: true, grandTotal: true, status: true,
    },
  });

  return rows.map((r) => ({ ...r, grandTotal: Number(r.grandTotal) }));
}

export async function getTaxInvoiceDetail(
  tx: TxClient,
  id: string,
): Promise<TaxInvoiceDetail | null> {
  const ti = await tx.taxInvoice.findUnique({
    where: { id },
    select: {
      id: true, number: true, issueDate: true,
      customerName: true, customerTaxId: true, customerBranch: true, customerAddress: true,
      subtotal: true, vatAmount: true, grandTotal: true,
      coveredInvoiceIds: true, coveredPaymentIds: true,
      status: true, voidReason: true, voidedAt: true, voidedBy: true,
      issuedByUserId: true, createdAt: true,
    },
  });
  if (!ti) return null;

  const invoices = await tx.invoice.findMany({
    where: { id: { in: ti.coveredInvoiceIds } },
    select: {
      id: true, invoiceNumber: true, issueDate: true,
      subtotal: true, vatAmount: true, serviceCharge: true, grandTotal: true,
    },
    orderBy: { issueDate: 'asc' },
  });

  return {
    ...ti,
    subtotal:   Number(ti.subtotal),
    vatAmount:  Number(ti.vatAmount),
    grandTotal: Number(ti.grandTotal),
    invoices: invoices.map((i) => ({
      id: i.id, invoiceNumber: i.invoiceNumber, issueDate: i.issueDate,
      subtotal:      Number(i.subtotal),
      vatAmount:     Number(i.vatAmount),
      serviceCharge: Number(i.serviceCharge),
      grandTotal:    Number(i.grandTotal),
    })),
  };
}

/**
 * For the builder UI — list Invoices for a given guest that are NOT currently
 * covered by an ISSUED tax invoice.
 */
export async function listUnissuedInvoicesForGuest(
  tx: TxClient,
  guestId: string,
): Promise<Array<{
  id: string; invoiceNumber: string; issueDate: Date;
  subtotal: number; vatAmount: number; serviceCharge: number; grandTotal: number;
  status: string;
}>> {
  const all = await tx.invoice.findMany({
    where: { guestId, status: { not: 'voided' } },
    select: {
      id: true, invoiceNumber: true, issueDate: true, status: true,
      subtotal: true, vatAmount: true, serviceCharge: true, grandTotal: true,
    },
    orderBy: { issueDate: 'desc' },
  });
  if (all.length === 0) return [];

  const coveredRows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT unnest(covered_invoice_ids) AS id
    FROM tax_invoices
    WHERE status = 'ISSUED'
      AND covered_invoice_ids && ${all.map((i) => i.id)}::text[]
  `;
  const coveredSet = new Set(coveredRows.map((r) => r.id));

  return all
    .filter((i) => !coveredSet.has(i.id))
    .map((i) => ({
      ...i,
      subtotal:      Number(i.subtotal),
      vatAmount:     Number(i.vatAmount),
      serviceCharge: Number(i.serviceCharge),
      grandTotal:    Number(i.grandTotal),
    }));
}
