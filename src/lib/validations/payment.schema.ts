/**
 * payment.schema.ts
 * Zod validation schemas shared between client and server.
 * Import on client for form validation, server for API input validation.
 */
import { z } from 'zod';

export const PAYMENT_METHODS = ['cash', 'transfer', 'credit_card', 'promptpay', 'ota_collect'] as const;

// Sprint 5 — mirror Prisma enums (kept in-sync; string literals avoid an
// `import { CardBrand } from '@prisma/client'` dependency on the client).
export const CARD_BRANDS = ['VISA', 'MASTER', 'JCB', 'UNIONPAY', 'AMEX', 'OTHER'] as const;
export const CARD_TYPES = ['NORMAL', 'PREMIUM', 'CORPORATE', 'UNKNOWN'] as const;

// ─── Core allocation unit ─────────────────────────────────────────────────────

export const AllocationSchema = z.object({
  invoiceId: z.string().uuid('Invalid invoice ID'),
  amount: z.number().positive('Allocation amount must be positive'),
});

// ─── Create Payment ───────────────────────────────────────────────────────────

export const CreatePaymentSchema = z.object({
  idempotencyKey: z.string().uuid('Idempotency key must be a UUID'),
  guestId: z.string().uuid('Invalid guest ID'),
  bookingId: z.string().uuid().optional(),
  amount: z.number().positive('Amount must be positive'),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentDate: z.coerce.date().optional(),
  referenceNo: z.string().max(100).optional(),
  // Sprint 4B: `cashSessionId` is resolved server-side from the caller's
  // active shift — never accepted from the client (trust boundary).
  receivedBy: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  // Phase D: optional processor fee split. `amount` is GROSS (what the customer paid);
  // feeAmount is what the acquirer keeps (recognised as CARD_FEE expense).
  feeAmount: z.number().nonnegative().optional(),
  feeAccountId: z.string().uuid().optional(),
  allocations: z
    .array(AllocationSchema)
    .min(1, 'At least one invoice allocation is required'),

  // ── Sprint 5 — Bank transfer / QR ───────────────────────────────────────
  /** Which company/personal account received the transfer (D4). */
  receivingAccountId: z.string().uuid().optional(),
  /** Uploaded evidence URL (returned by POST /api/uploads). */
  slipImageUrl: z.string().url().max(500).optional(),
  /** Slip reference no. — enforced unique at DB to block slip reuse (D1). */
  slipRefNo: z.string().trim().min(3).max(50).optional(),

  // ── Sprint 5 — Credit card ──────────────────────────────────────────────
  cardBrand: z.enum(CARD_BRANDS).optional(),
  cardType: z.enum(CARD_TYPES).optional(),
  /** Last 4 digits only — never accept full PAN. */
  cardLast4: z.string().regex(/^\d{4}$/, 'cardLast4 must be exactly 4 digits').optional(),
  /** EDC authorization code. */
  authCode: z.string().trim().max(12).optional(),
  /** Which EDC terminal (BBL-01, KBANK-01, …). */
  terminalId: z.string().uuid().optional(),
}).refine(
  (data) => {
    const allocTotal = data.allocations.reduce((s, a) => s + a.amount, 0);
    // Allow 1 THB tolerance for floating point
    return Math.abs(allocTotal - data.amount) < 1;
  },
  { message: 'Sum of allocations must equal total payment amount', path: ['allocations'] }
).refine(
  (data) => {
    // Fees only make sense for card-like methods; and must be strictly less than gross
    if (!data.feeAmount || data.feeAmount === 0) return true;
    if (data.paymentMethod !== 'credit_card') return false;
    return data.feeAmount < data.amount;
  },
  { message: 'feeAmount is only valid for credit_card and must be less than amount', path: ['feeAmount'] }
)
// ── Sprint 5 per-method required fields ─────────────────────────────────
.refine(d => d.paymentMethod !== 'transfer'    || !!d.receivingAccountId,
        { message: 'กรุณาเลือกบัญชีที่รับเงิน', path: ['receivingAccountId'] })
.refine(d => d.paymentMethod !== 'promptpay'   || !!d.receivingAccountId,
        { message: 'กรุณาเลือกบัญชีที่รับเงิน', path: ['receivingAccountId'] })
.refine(d => d.paymentMethod !== 'credit_card' || !!d.terminalId,
        { message: 'กรุณาเลือกเครื่อง EDC', path: ['terminalId'] })
.refine(d => d.paymentMethod !== 'credit_card' || !!d.cardBrand,
        { message: 'กรุณาเลือกแบรนด์บัตร', path: ['cardBrand'] });

export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;

// ─── Void Payment ─────────────────────────────────────────────────────────────

export const VoidPaymentSchema = z.object({
  voidReason: z.string().min(5, 'Void reason is required (min 5 chars)').max(500),
});

export type VoidPaymentInput = z.infer<typeof VoidPaymentSchema>;

// ─── Create Security Deposit ──────────────────────────────────────────────────

export const CreateSecurityDepositSchema = z.object({
  bookingId: z.string().uuid('Invalid booking ID'),
  guestId: z.string().uuid('Invalid guest ID'),
  amount: z.number().positive('Deposit amount must be positive'),
  paymentMethod: z.enum(PAYMENT_METHODS),
  referenceNo: z.string().max(100).optional(),
  bankName: z.string().max(100).optional(),
  bankAccount: z.string().max(50).optional(),
  bankAccountName: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});

export type CreateSecurityDepositInput = z.infer<typeof CreateSecurityDepositSchema>;

// ─── Refund Security Deposit ──────────────────────────────────────────────────

export const DeductionSchema = z.object({
  reason: z.string().min(1).max(200),
  amount: z.number().positive(),
});

export const RefundDepositSchema = z.object({
  refundAmount: z.number().min(0, 'Refund amount cannot be negative'),
  refundMethod: z.enum(PAYMENT_METHODS),
  refundRef: z.string().max(100).optional(),
  deductions: z.array(DeductionSchema).optional(),
  forfeitReason: z.string().max(500).optional(),
});

export type RefundDepositInput = z.infer<typeof RefundDepositSchema>;
