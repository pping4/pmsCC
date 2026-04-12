/**
 * cityLedger.service.ts
 *
 * Core business logic for City Ledger / Accounts Receivable.
 *
 * Design:
 *  - All write operations MUST be called inside prisma.$transaction
 *  - Uses Optimistic Concurrency (version field) on CityLedgerAccount
 *    to prevent race conditions when multiple staff process payments simultaneously
 *  - LedgerEntry writes are delegated to ledger.service.ts (append-only)
 *  - Activity logs use logActivity() from activityLog.service.ts
 *
 * Flow:
 *  Guest Check-out (CL booking):
 *    createInvoiceFromFolio → postInvoiceToCityLedger
 *    → CityLedgerTransaction (CHARGE) + LedgerEntry (DR AR_CORPORATE | CR REVENUE)
 *
 *  Corporate pays later:
 *    receiveCityLedgerPayment
 *    → CityLedgerPayment + CityLedgerAllocation(s) + CityLedgerTransaction (PAYMENT)
 *    → LedgerEntry (DR CASH/BANK | CR AR_CORPORATE)
 */

import { Prisma, CityLedgerAccountStatus } from '@prisma/client';
import { logActivity } from './activityLog.service';
import {
  postCityLedgerCharge,
  postCityLedgerPaymentReceived,
  postCityLedgerBadDebt,
} from './ledger.service';
import { markLineItemsPaid } from './folio.service';
import {
  generateCLAccountCode,
  generateCLPaymentNumber,
} from './invoice-number.service';

type TxClient = Prisma.TransactionClient;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreditCheckResult {
  allowed: boolean;
  currentBalance: number;
  creditLimit: number;
  available: number;
}

export interface AgingBucket {
  label: string;
  daysMin: number;
  daysMax: number | null;
  amount: number;
  invoiceCount: number;
}

export interface AgingReport {
  accountId: string;
  companyName: string;
  totalOutstanding: number;
  buckets: AgingBucket[];
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    issueDate: Date;
    dueDate: Date;
    grandTotal: number;
    paidAmount: number;
    outstanding: number;
    daysOverdue: number;
  }>;
}

export interface StatementLine {
  id: string;
  date: Date;
  type: string;
  referenceType: string;
  referenceId: string;
  description: string | null;
  amount: number;
  runningBalance: number;
}

// ─── 1. Credit Check ──────────────────────────────────────────────────────────

/**
 * Check whether a City Ledger account has enough credit for a new charge.
 * Does NOT modify any data.
 */
export async function checkCreditLimit(
  tx: TxClient,
  accountId: string,
  chargeAmount: number | Prisma.Decimal,
): Promise<CreditCheckResult> {
  const account = await tx.cityLedgerAccount.findUniqueOrThrow({
    where: { id: accountId },
    select: {
      status:         true,
      currentBalance: true,
      creditLimit:    true,
    },
  });

  const balance   = Number(account.currentBalance);
  const limit     = Number(account.creditLimit);
  const charge    = Number(chargeAmount);
  const available = limit - balance;

  return {
    allowed:        account.status === 'active' && (limit === 0 || balance + charge <= limit),
    currentBalance: balance,
    creditLimit:    limit,
    available,
  };
}

// ─── 2. Post Invoice to City Ledger ──────────────────────────────────────────

/**
 * Assign an existing Invoice to a City Ledger account and create the
 * corresponding AR charge.
 *
 * Called from the checkout API when booking.cityLedgerAccountId is set.
 */
export async function postInvoiceToCityLedger(
  tx: TxClient,
  opts: {
    invoiceId:  string;
    accountId:  string;
    createdBy:  string;
    userName?:  string;
  },
): Promise<void> {
  // 1. Load invoice
  const invoice = await tx.invoice.findUniqueOrThrow({
    where:  { id: opts.invoiceId },
    select: { id: true, grandTotal: true, invoiceNumber: true },
  });

  // 2. Load account with Optimistic Concurrency guard
  const account = await tx.cityLedgerAccount.findUniqueOrThrow({
    where:  { id: opts.accountId },
    select: { id: true, version: true, currentBalance: true, companyName: true },
  });

  const newBalance = new Prisma.Decimal(String(account.currentBalance))
    .plus(new Prisma.Decimal(String(invoice.grandTotal)));

  // 3. Update Invoice — link to CL + set status
  await tx.invoice.update({
    where: { id: opts.invoiceId },
    data: {
      cityLedgerAccountId: opts.accountId,
      cityLedgerStatus:    'pending',
    },
  });

  // 4. Update Account balance with version bump (Optimistic Concurrency)
  const updated = await tx.cityLedgerAccount.updateMany({
    where: { id: opts.accountId, version: account.version },
    data:  {
      currentBalance: newBalance,
      version:        { increment: 1 },
    },
  });

  if (updated.count === 0) {
    throw new Error('City Ledger account was modified concurrently. Please retry.');
  }

  // 5. Auto-suspend if over credit limit
  const refreshed = await tx.cityLedgerAccount.findUnique({
    where:  { id: opts.accountId },
    select: { creditLimit: true, currentBalance: true },
  });
  if (refreshed && Number(refreshed.creditLimit) > 0 &&
      Number(refreshed.currentBalance) >= Number(refreshed.creditLimit)) {
    await tx.cityLedgerAccount.update({
      where: { id: opts.accountId },
      data:  { status: CityLedgerAccountStatus.suspended },
    });
  }

  // 6. Create CityLedgerTransaction (CHARGE)
  await tx.cityLedgerTransaction.create({
    data: {
      accountId:     opts.accountId,
      date:          new Date(),
      type:          'CHARGE',
      referenceType: 'Invoice',
      referenceId:   opts.invoiceId,
      amount:        invoice.grandTotal,
      runningBalance: newBalance,
      description:   `ใบแจ้งหนี้ ${invoice.invoiceNumber}`,
      createdBy:     opts.createdBy,
    },
  });

  // 7. Post double-entry ledger
  await postCityLedgerCharge(tx, {
    amount:      Number(invoice.grandTotal),
    invoiceId:   opts.invoiceId,
    description: `City Ledger charge: ${invoice.invoiceNumber} → ${account.companyName}`,
    createdBy:   opts.createdBy,
  });

  // 8. Activity log
  await logActivity(tx, {
    userId:             opts.createdBy,
    userName:           opts.userName,
    action:             'city_ledger.charge_posted',
    category:           'city_ledger',
    description:        `ตั้งหนี้ ${account.companyName}: ${invoice.invoiceNumber} ฿${Number(invoice.grandTotal).toLocaleString()}`,
    invoiceId:          opts.invoiceId,
    cityLedgerAccountId: opts.accountId,
    severity:           'info',
  });
}

// ─── 3. Receive City Ledger Payment ──────────────────────────────────────────

export interface ReceiveCLPaymentInput {
  accountId:     string;
  amount:        number;
  invoiceIds:    string[];   // ordered: allocate to these invoices first
  paymentMethod: string;
  paymentDate:   Date;
  referenceNo?:  string;
  notes?:        string;
  createdBy:     string;
  userName?:     string;
}

export interface ReceiveCLPaymentResult {
  clPaymentId:      string;
  paymentNumber:    string;
  totalAllocated:   number;
  unallocatedAmount: number;
  invoicesSettled:  string[];
}

/**
 * Record receipt of payment from a corporate City Ledger account.
 * Allocates payment to specified invoices, handles overpayment as
 * unallocated balance, and posts ledger entries.
 */
export async function receiveCityLedgerPayment(
  tx: TxClient,
  input: ReceiveCLPaymentInput,
): Promise<ReceiveCLPaymentResult> {
  // 1. Load account (Optimistic Concurrency)
  const account = await tx.cityLedgerAccount.findUniqueOrThrow({
    where:  { id: input.accountId },
    select: { id: true, version: true, currentBalance: true, companyName: true },
  });

  // 2. Generate payment number
  const paymentNumber = await generateCLPaymentNumber(tx);

  // 3. Create CityLedgerPayment
  const clPayment = await tx.cityLedgerPayment.create({
    data: {
      paymentNumber,
      accountId:        input.accountId,
      amount:           input.amount,
      unallocatedAmount: input.amount,  // will be reduced as we allocate
      paymentDate:      input.paymentDate,
      paymentMethod:    input.paymentMethod as never,
      referenceNo:      input.referenceNo,
      notes:            input.notes,
      status:           'ACTIVE',
      createdBy:        input.createdBy,
    },
  });

  // 4. Allocate to invoices
  let remaining      = new Prisma.Decimal(String(input.amount));
  const invoicesSettled: string[] = [];

  for (const invoiceId of input.invoiceIds) {
    if (remaining.lte(0)) break;

    const invoice = await tx.invoice.findUnique({
      where:  { id: invoiceId },
      select: { id: true, grandTotal: true, paidAmount: true, status: true },
    });
    if (!invoice || invoice.status === 'paid' || invoice.status === 'voided') continue;

    const outstanding = new Prisma.Decimal(String(invoice.grandTotal))
      .minus(new Prisma.Decimal(String(invoice.paidAmount)));
    if (outstanding.lte(0)) continue;

    const allocate = Prisma.Decimal.min(remaining, outstanding);

    // Create allocation
    await tx.cityLedgerAllocation.upsert({
      where: {
        clPaymentId_invoiceId: { clPaymentId: clPayment.id, invoiceId },
      },
      create: {
        clPaymentId: clPayment.id,
        invoiceId,
        amount:      allocate,
        allocatedAt: new Date(),
      },
      update: { amount: allocate },
    });

    // Update invoice paid amount + status
    const newPaidAmount = new Prisma.Decimal(String(invoice.paidAmount)).plus(allocate);
    const newGrandTotal = new Prisma.Decimal(String(invoice.grandTotal));
    const newStatus     = newPaidAmount.gte(newGrandTotal) ? 'paid'
                        : newPaidAmount.gt(0)              ? 'partial'
                        : invoice.status;

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        paidAmount:          newPaidAmount,
        status:              newStatus as never,
        cityLedgerStatus:    newPaidAmount.gte(newGrandTotal) ? 'settled' : 'pending',
      },
    });

    if (newPaidAmount.gte(newGrandTotal)) {
      invoicesSettled.push(invoiceId);
      await markLineItemsPaid(tx, invoiceId);
    }

    remaining = remaining.minus(allocate);
  }

  const totalAllocated = new Prisma.Decimal(String(input.amount)).minus(remaining);

  // 5. Update unallocatedAmount on payment
  await tx.cityLedgerPayment.update({
    where: { id: clPayment.id },
    data:  { unallocatedAmount: remaining },
  });

  // 6. Update account balance (Optimistic Concurrency)
  const newBalance = new Prisma.Decimal(String(account.currentBalance))
    .minus(totalAllocated);

  const updated = await tx.cityLedgerAccount.updateMany({
    where: { id: input.accountId, version: account.version },
    data: {
      currentBalance: newBalance.lt(0) ? new Prisma.Decimal(0) : newBalance,
      version:        { increment: 1 },
      // Re-activate if balance fell below limit
      status:         CityLedgerAccountStatus.active,
    },
  });

  if (updated.count === 0) {
    throw new Error('City Ledger account was modified concurrently. Please retry.');
  }

  // 7. Create CityLedgerTransaction (PAYMENT)
  const balanceAfter = newBalance.lt(0) ? new Prisma.Decimal(0) : newBalance;
  await tx.cityLedgerTransaction.create({
    data: {
      accountId:     input.accountId,
      date:          input.paymentDate,
      type:          'PAYMENT',
      referenceType: 'Payment',
      referenceId:   clPayment.id,
      amount:        totalAllocated,
      runningBalance: balanceAfter,
      description:   `รับชำระ ${paymentNumber} via ${input.paymentMethod}${input.referenceNo ? ` ref:${input.referenceNo}` : ''}`,
      createdBy:     input.createdBy,
    },
  });

  // 8. Post double-entry ledger
  await postCityLedgerPaymentReceived(tx, {
    paymentMethod: input.paymentMethod,
    amount:        Number(totalAllocated),
    clPaymentId:   clPayment.id,
    description:   `City Ledger payment: ${paymentNumber} — ${account.companyName}`,
    createdBy:     input.createdBy,
  });

  // 9. Activity log
  await logActivity(tx, {
    userId:              input.createdBy,
    userName:            input.userName,
    action:              'city_ledger.payment_received',
    category:            'city_ledger',
    description:         `รับชำระ ${account.companyName}: ฿${Number(totalAllocated).toLocaleString()} (${input.invoiceIds.length} ใบ)`,
    cityLedgerAccountId: input.accountId,
    metadata: {
      paymentNumber,
      totalAllocated: Number(totalAllocated),
      unallocated:    Number(remaining),
      invoicesSettled,
    },
    severity: 'success',
  });

  return {
    clPaymentId:       clPayment.id,
    paymentNumber,
    totalAllocated:    Number(totalAllocated),
    unallocatedAmount: Number(remaining),
    invoicesSettled,
  };
}

// ─── 4. Aging Report ─────────────────────────────────────────────────────────

const AGING_BUCKETS: Array<{ label: string; daysMin: number; daysMax: number | null }> = [
  { label: 'ปัจจุบัน (0-30 วัน)',   daysMin: 0,   daysMax: 30   },
  { label: '31-60 วัน',            daysMin: 31,  daysMax: 60   },
  { label: '61-90 วัน',            daysMin: 61,  daysMax: 90   },
  { label: '91-120 วัน',           daysMin: 91,  daysMax: 120  },
  { label: 'เกิน 120 วัน',          daysMin: 121, daysMax: null },
];

export async function getAgingReport(
  tx: TxClient,
  accountId: string,
): Promise<AgingReport> {
  const account = await tx.cityLedgerAccount.findUniqueOrThrow({
    where:  { id: accountId },
    select: { id: true, companyName: true },
  });

  const unpaidInvoices = await tx.invoice.findMany({
    where: {
      cityLedgerAccountId: accountId,
      status: { in: ['unpaid', 'partial', 'overdue'] },
    },
    select: {
      id: true, invoiceNumber: true, issueDate: true,
      dueDate: true, grandTotal: true, paidAmount: true,
    },
    orderBy: { dueDate: 'asc' },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const invoices = unpaidInvoices.map(inv => {
    const due      = new Date(inv.dueDate);
    due.setHours(0, 0, 0, 0);
    const diff     = today.getTime() - due.getTime();
    const daysOverdue = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
    const outstanding = Number(inv.grandTotal) - Number(inv.paidAmount);
    return { ...inv, outstanding, daysOverdue,
      grandTotal: Number(inv.grandTotal), paidAmount: Number(inv.paidAmount) };
  });

  const buckets: AgingBucket[] = AGING_BUCKETS.map(b => {
    const matching = invoices.filter(inv =>
      inv.daysOverdue >= b.daysMin &&
      (b.daysMax === null || inv.daysOverdue <= b.daysMax)
    );
    return {
      label:        b.label,
      daysMin:      b.daysMin,
      daysMax:      b.daysMax,
      amount:       matching.reduce((s, i) => s + i.outstanding, 0),
      invoiceCount: matching.length,
    };
  });

  return {
    accountId,
    companyName:      account.companyName,
    totalOutstanding: invoices.reduce((s, i) => s + i.outstanding, 0),
    buckets,
    invoices,
  };
}

// ─── 5. Statement (Running Balance) ──────────────────────────────────────────

export async function getStatement(
  tx: TxClient,
  accountId: string,
  opts: { dateFrom: Date; dateTo: Date },
): Promise<StatementLine[]> {
  const rows = await tx.cityLedgerTransaction.findMany({
    where: {
      accountId,
      date: { gte: opts.dateFrom, lte: opts.dateTo },
    },
    orderBy: { date: 'asc' },
    select: {
      id: true, date: true, type: true, referenceType: true,
      referenceId: true, description: true, amount: true, runningBalance: true,
    },
  });

  return rows.map(r => ({
    id:            r.id,
    date:          r.date,
    type:          r.type,
    referenceType: r.referenceType,
    referenceId:   r.referenceId,
    description:   r.description,
    amount:        Number(r.amount),
    runningBalance: Number(r.runningBalance),
  }));
}

// ─── 6. Bad Debt Write-off ────────────────────────────────────────────────────

export async function writeOffBadDebt(
  tx: TxClient,
  opts: {
    invoiceId:  string;
    accountId:  string;
    reason:     string;
    createdBy:  string;
    userName?:  string;
  },
): Promise<void> {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where:  { id: opts.invoiceId },
    select: { id: true, grandTotal: true, paidAmount: true, invoiceNumber: true },
  });

  const outstanding = new Prisma.Decimal(String(invoice.grandTotal))
    .minus(new Prisma.Decimal(String(invoice.paidAmount)));

  if (outstanding.lte(0)) return; // already paid — nothing to write off

  // 1. Mark invoice as bad debt
  await tx.invoice.update({
    where: { id: opts.invoiceId },
    data: {
      badDebt:          true,
      badDebtNote:      opts.reason,
      status:           'voided' as never,
      cityLedgerStatus: 'disputed',
    },
  });

  // 2. Load account for concurrency guard
  const account = await tx.cityLedgerAccount.findUniqueOrThrow({
    where:  { id: opts.accountId },
    select: { version: true, currentBalance: true, companyName: true },
  });

  const newBalance = new Prisma.Decimal(String(account.currentBalance))
    .minus(outstanding);

  // 3. Update account balance
  const updated = await tx.cityLedgerAccount.updateMany({
    where: { id: opts.accountId, version: account.version },
    data: {
      currentBalance: newBalance.lt(0) ? new Prisma.Decimal(0) : newBalance,
      version:        { increment: 1 },
    },
  });

  if (updated.count === 0) {
    throw new Error('City Ledger account was modified concurrently. Please retry.');
  }

  // 4. CityLedgerTransaction (BAD_DEBT)
  const balanceAfter = newBalance.lt(0) ? new Prisma.Decimal(0) : newBalance;
  await tx.cityLedgerTransaction.create({
    data: {
      accountId:     opts.accountId,
      date:          new Date(),
      type:          'BAD_DEBT',
      referenceType: 'Invoice',
      referenceId:   opts.invoiceId,
      amount:        outstanding,
      runningBalance: balanceAfter,
      description:   `ตัดหนี้สูญ: ${invoice.invoiceNumber} — ${opts.reason}`,
      createdBy:     opts.createdBy,
    },
  });

  // 5. Post ledger
  await postCityLedgerBadDebt(tx, {
    amount:    Number(outstanding),
    invoiceId: opts.invoiceId,
    reason:    opts.reason,
    createdBy: opts.createdBy,
  });

  // 6. Activity log
  await logActivity(tx, {
    userId:              opts.createdBy,
    userName:            opts.userName,
    action:              'city_ledger.bad_debt_writeoff',
    category:            'city_ledger',
    description:         `ตัดหนี้สูญ ${account.companyName}: ${invoice.invoiceNumber} ฿${Number(outstanding).toLocaleString()} — ${opts.reason}`,
    invoiceId:           opts.invoiceId,
    cityLedgerAccountId: opts.accountId,
    severity:            'warning',
  });
}

// ─── 7. Create CL Account ────────────────────────────────────────────────────

export interface CreateCLAccountInput {
  companyName:     string;
  companyTaxId?:   string;
  companyAddress?: string;
  contactName?:    string;
  contactEmail?:   string;
  contactPhone?:   string;
  creditLimit?:    number;
  creditTermsDays?: number;
  notes?:          string;
  createdBy:       string;
  userName?:       string;
}

export async function createCLAccount(
  tx: TxClient,
  input: CreateCLAccountInput,
) {
  const accountCode = await generateCLAccountCode(tx);

  const account = await tx.cityLedgerAccount.create({
    data: {
      accountCode,
      companyName:     input.companyName,
      companyTaxId:    input.companyTaxId,
      companyAddress:  input.companyAddress,
      contactName:     input.contactName,
      contactEmail:    input.contactEmail,
      contactPhone:    input.contactPhone,
      creditLimit:     input.creditLimit    ?? 0,
      creditTermsDays: input.creditTermsDays ?? 30,
      notes:           input.notes,
      status:          'active',
    },
    select: {
      id: true, accountCode: true, companyName: true,
      creditLimit: true, creditTermsDays: true, status: true, createdAt: true,
    },
  });

  await logActivity(tx, {
    userId:              input.createdBy,
    userName:            input.userName,
    action:              'city_ledger.account_created',
    category:            'city_ledger',
    description:         `สร้างบัญชี City Ledger: ${accountCode} — ${input.companyName}`,
    cityLedgerAccountId: account.id,
    severity:            'success',
  });

  return account;
}
