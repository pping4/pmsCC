/**
 * cityLedger.ts — Zod validation schemas for City Ledger API
 *
 * Shared between client (form validation) and server (API validation).
 */

import { z } from 'zod';

// ─── Account ─────────────────────────────────────────────────────────────────

export const CreateCLAccountSchema = z.object({
  companyName:     z.string().min(1, 'ต้องระบุชื่อบริษัท').max(200),
  companyTaxId:    z.string().max(20).optional(),
  companyAddress:  z.string().max(500).optional(),
  contactName:     z.string().max(100).optional(),
  contactEmail:    z.string().email('รูปแบบอีเมลไม่ถูกต้อง').optional().or(z.literal('')),
  contactPhone:    z.string().max(20).optional(),
  creditLimit:     z.number().nonnegative('วงเงินต้องไม่ติดลบ').default(0),
  creditTermsDays: z.number().int().min(1).max(365).default(30),
  notes:           z.string().max(500).optional(),
});

export type CreateCLAccountInput = z.infer<typeof CreateCLAccountSchema>;

export const UpdateCLAccountSchema = CreateCLAccountSchema.partial().extend({
  status: z.enum(['active', 'suspended', 'closed']).optional(),
});

export type UpdateCLAccountInput = z.infer<typeof UpdateCLAccountSchema>;

// ─── Credit Limit Adjustment ─────────────────────────────────────────────────

export const UpdateCreditLimitSchema = z.object({
  creditLimit:     z.number().nonnegative('วงเงินต้องไม่ติดลบ'),
  creditTermsDays: z.number().int().min(1).max(365).optional(),
  reason:          z.string().min(1, 'ต้องระบุเหตุผล').max(500),
});

export type UpdateCreditLimitInput = z.infer<typeof UpdateCreditLimitSchema>;

// ─── Payment ─────────────────────────────────────────────────────────────────

export const ReceiveCLPaymentSchema = z.object({
  amount:        z.number().positive('ยอดชำระต้องมากกว่า 0'),
  invoiceIds:    z.array(z.string().uuid()).min(1, 'ต้องเลือกใบแจ้งหนี้อย่างน้อย 1 ใบ'),
  paymentMethod: z.enum(['cash', 'transfer', 'credit_card', 'promptpay']),
  paymentDate:   z.string().datetime({ message: 'รูปแบบวันที่ไม่ถูกต้อง' }),
  referenceNo:   z.string().max(100).optional(),
  // Sprint 4B: `cashSessionId` is resolved server-side — never from client.
  notes:         z.string().max(500).optional(),
});

export type ReceiveCLPaymentInput = z.infer<typeof ReceiveCLPaymentSchema>;

// ─── Statement Query ─────────────────────────────────────────────────────────

export const StatementQuerySchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่: YYYY-MM-DD'),
  dateTo:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่: YYYY-MM-DD'),
});

export type StatementQueryInput = z.infer<typeof StatementQuerySchema>;

// ─── Bad Debt Write-off ──────────────────────────────────────────────────────

export const WriteOffBadDebtSchema = z.object({
  invoiceId: z.string().uuid(),
  reason:    z.string().min(1, 'ต้องระบุเหตุผล').max(500),
});

export type WriteOffBadDebtInput = z.infer<typeof WriteOffBadDebtSchema>;
