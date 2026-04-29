/**
 * Financial Account service — Phase A foundation.
 *
 * Responsibilities:
 *   1. Seed default Thai GAAP accounts (idempotent, safe to run repeatedly).
 *   2. Resolve the correct FinancialAccount for a given posting context.
 *
 * Phase A goal: additive — existing ledger behavior unchanged. The resolver
 * falls back to the single system-default per (kind, subKind) so every
 * posting site records an accountId without asking the user any new question.
 */

import { Prisma, PrismaClient, AccountKind, AccountSubKind, PaymentMethod } from '@prisma/client';

type Tx = PrismaClient | Prisma.TransactionClient;

// ─── Default Chart of Accounts (seed) ────────────────────────────────────────
// codes follow Thai GAAP-ish 4-digit grouping:
//   1xxx Assets, 2xxx Liabilities, 3xxx Equity, 4xxx Revenue, 5xxx Expense
interface SeedAccount {
  code: string;
  name: string;
  nameEN: string;
  kind: AccountKind;
  subKind: AccountSubKind;
  isDefault?: boolean;
}

const DEFAULT_ACCOUNTS: SeedAccount[] = [
  // Assets
  { code: '1110-01', name: 'เงินสด-ลิ้นชักหลัก',      nameEN: 'Cash - Main Drawer',         kind: 'ASSET',     subKind: 'CASH',              isDefault: true },
  { code: '1120-01', name: 'ธนาคาร-บัญชีหลัก',         nameEN: 'Bank - Default',             kind: 'ASSET',     subKind: 'BANK',              isDefault: true },
  { code: '1130-01', name: 'เงินฝากระหว่างทาง',        nameEN: 'Undeposited Funds',          kind: 'ASSET',     subKind: 'UNDEPOSITED_FUNDS', isDefault: true },
  { code: '1131-01', name: 'พักบัตรเครดิต',            nameEN: 'Card Clearing',              kind: 'ASSET',     subKind: 'CARD_CLEARING',     isDefault: true },
  { code: '1140-01', name: 'ลูกหนี้-แขกผู้เข้าพัก',      nameEN: 'Accounts Receivable - Guest', kind: 'ASSET',    subKind: 'AR',                isDefault: true },
  { code: '1141-01', name: 'ลูกหนี้-บริษัท',            nameEN: 'Accounts Receivable - Corporate', kind: 'ASSET', subKind: 'AR_CORPORATE',     isDefault: true },

  // Liabilities
  { code: '2110-01', name: 'เงินมัดจำลูกค้า',           nameEN: 'Guest Deposits Payable',     kind: 'LIABILITY', subKind: 'DEPOSIT_LIABILITY', isDefault: true },
  { code: '2115-01', name: 'เครดิตคงเหลือลูกค้า',       nameEN: 'Guest Credit Liability',     kind: 'LIABILITY', subKind: 'GUEST_CREDIT',      isDefault: true },
  { code: '2120-01', name: 'ค่าคอมมิชชั่น OTA ค้างจ่าย', nameEN: 'OTA Commission Payable',    kind: 'LIABILITY', subKind: 'AGENT_PAYABLE',     isDefault: true },
  { code: '2130-01', name: 'ภาษีขาย (VAT output)',      nameEN: 'VAT Output Payable',         kind: 'LIABILITY', subKind: 'VAT_OUTPUT',        isDefault: true },
  { code: '2131-01', name: 'ค่าบริการ 10% ค้างจ่าย',    nameEN: 'Service Charge Payable',     kind: 'LIABILITY', subKind: 'SERVICE_CHARGE_PAYABLE', isDefault: true },

  // Revenue
  { code: '4110-01', name: 'รายได้ค่าห้องพัก',          nameEN: 'Room Revenue',               kind: 'REVENUE',   subKind: 'ROOM_REVENUE',      isDefault: true },
  { code: '4120-01', name: 'รายได้อาหารและเครื่องดื่ม',   nameEN: 'Food & Beverage Revenue',    kind: 'REVENUE',   subKind: 'FB_REVENUE',        isDefault: true },
  { code: '4130-01', name: 'รายได้ค่าปรับ',             nameEN: 'Penalty Revenue',            kind: 'REVENUE',   subKind: 'PENALTY_REVENUE',   isDefault: true },
  { code: '4140-01', name: 'รายได้จากเครดิตหมดอายุ',     nameEN: 'Forfeited Guest Credit',     kind: 'REVENUE',   subKind: 'FORFEITED_REVENUE', isDefault: true },
  { code: '4900-01', name: 'รายได้อื่น',                nameEN: 'Other Revenue',              kind: 'REVENUE',   subKind: 'OTHER_REVENUE',     isDefault: true },

  // Expense / Contra-revenue
  { code: '5110-01', name: 'ส่วนลดให้ลูกค้า',           nameEN: 'Discount Given',             kind: 'EXPENSE',   subKind: 'DISCOUNT_GIVEN',    isDefault: true },
  { code: '5210-01', name: 'ค่าธรรมเนียมบัตรเครดิต',     nameEN: 'Card Processing Fee',        kind: 'EXPENSE',   subKind: 'CARD_FEE',          isDefault: true },
  { code: '5220-01', name: 'ค่าธรรมเนียมธนาคาร',         nameEN: 'Bank Fee',                   kind: 'EXPENSE',   subKind: 'BANK_FEE',          isDefault: true },
  { code: '5310-01', name: 'เงินสดเกิน/ขาดบัญชี',        nameEN: 'Cash Over/Short',            kind: 'EXPENSE',   subKind: 'CASH_OVER_SHORT',   isDefault: true },
  { code: '5900-01', name: 'ค่าใช้จ่ายอื่น',            nameEN: 'Other Expense',              kind: 'EXPENSE',   subKind: 'OTHER_EXPENSE',     isDefault: true },
];

/**
 * Seed default accounts. Idempotent — uses upsert on code.
 * isSystem=true so admins cannot delete these from the UI.
 */
export async function seedDefaultFinancialAccounts(tx: Tx = prismaFallback()): Promise<void> {
  for (const a of DEFAULT_ACCOUNTS) {
    await tx.financialAccount.upsert({
      where: { code: a.code },
      update: {}, // keep existing name/isDefault untouched — operator may have renamed
      create: {
        code:      a.code,
        name:      a.name,
        nameEN:    a.nameEN,
        kind:      a.kind,
        subKind:   a.subKind,
        isActive:  true,
        isSystem:  true,
        isDefault: a.isDefault ?? false,
      },
    });
  }
}

// ─── Resolver ────────────────────────────────────────────────────────────────

/**
 * Context for choosing a posting account. Callers pass intent, resolver
 * picks a concrete FinancialAccount.id.
 *
 * Resolution precedence:
 *   1. explicitAccountId (user-selected from dropdown)   — Phase C
 *   2. subKind lookup: active default for the subKind    — Phase A fallback
 *   3. subKind lookup: any active account with subKind   — last resort
 *
 * Returns the account OR throws if no viable account exists — indicates
 * seed was not run or admin deactivated the last account of a kind.
 */
export interface ResolveInput {
  subKind: AccountSubKind;
  explicitAccountId?: string | null;
}

export async function resolveAccount(tx: Tx, input: ResolveInput) {
  if (input.explicitAccountId) {
    const acc = await tx.financialAccount.findUnique({ where: { id: input.explicitAccountId } });
    if (acc && acc.isActive) return acc;
    // fall through if explicit id is invalid/inactive — prefer a sane default
    // over failing a posting
  }

  const def = await tx.financialAccount.findFirst({
    where: { subKind: input.subKind, isActive: true, isDefault: true },
  });
  if (def) return def;

  const any = await tx.financialAccount.findFirst({
    where: { subKind: input.subKind, isActive: true },
    orderBy: { code: 'asc' },
  });
  if (any) return any;

  throw new Error(
    `ไม่พบบัญชีการเงินสำหรับ ${input.subKind} — ต้องรัน seed หรือเปิดใช้งานบัญชีใน Settings`,
  );
}

/**
 * Convenience: pick between CASH and BANK bucket based on payment method.
 * Mirrors the legacy hardcoded logic in ledger.service.ts / refund.service.ts.
 * Call this when the account isn't user-selected (cash register, default flow).
 */
export function subKindForPaymentMethod(method: PaymentMethod | string): AccountSubKind {
  const m = String(method).toLowerCase();
  if (m === 'cash') return 'CASH';
  if (m === 'credit_card') return 'CARD_CLEARING';
  // transfer / promptpay / ota_collect → bank bucket
  return 'BANK';
}

// ─── Prisma fallback (for seed script only) ──────────────────────────────────
function prismaFallback(): PrismaClient {
  // Avoid importing '@/lib/prisma' here to keep the service tree-shake-friendly
  // in seed contexts. Callers should pass their tx in app code.
  const { prisma } = require('@/lib/prisma') as { prisma: PrismaClient };
  return prisma;
}
