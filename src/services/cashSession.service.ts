/**
 * cashSession.service.ts — Sprint 4B counter-centric rewrite.
 *
 * Model (read top-to-bottom):
 *   - Every OPEN session is tied to exactly one CashBox (a physical drawer
 *     at a counter). The schema-level partial unique indexes
 *     `cash_session_one_open_per_box` and `cash_session_one_open_per_user`
 *     enforce: at most one OPEN session per counter, and at most one OPEN
 *     session per user. P2002 from Prisma → translated to friendly error.
 *   - `CashBox.currentSessionId` is a denormalized pointer to the active
 *     session, updated in the SAME transaction as the open/close. It makes
 *     "which session is active at COUNTER-1?" an O(1) lookup.
 *   - Handover closes one session and opens a successor in a single
 *     transaction. The new session's `handoverFromId` points to the closed
 *     one — this builds an audit trail of the shift lineage at one counter.
 *
 * Trust boundary: every caller must have already been permission-gated.
 * Services never do RBAC themselves — they trust the caller and operate on
 * validated inputs. Callers pass `tx` from a $transaction when they need
 * to compose these operations with other writes (e.g. ledger postings).
 */

import { Prisma, SessionStatus, LedgerAccount, RefundStatus } from '@prisma/client';
import { postLedgerPair } from './ledger.service';
import { resolveAccount } from './financialAccount.service';

type TxClient = Prisma.TransactionClient;

// ─── Typed service errors (API layer maps these to HTTP codes) ───────────────
export class CashSessionError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'CashSessionError';
  }
}
export class BoxInUseError extends CashSessionError {
  constructor(msg = 'ลิ้นชักนี้ถูกใช้งานอยู่') { super(msg, 'BOX_IN_USE'); }
}
export class UserHasOpenSessionError extends CashSessionError {
  constructor(msg = 'คุณมีกะที่เปิดอยู่แล้ว — กรุณาปิดกะเก่าก่อน') {
    super(msg, 'USER_HAS_OPEN_SESSION');
  }
}
export class SessionNotOpenError extends CashSessionError {
  constructor(msg = 'Session นี้ถูกปิดไปแล้ว') { super(msg, 'SESSION_NOT_OPEN'); }
}
export class SessionNotFoundError extends CashSessionError {
  constructor(msg = 'ไม่พบ cash session') { super(msg, 'SESSION_NOT_FOUND'); }
}
export class BoxUnavailableError extends CashSessionError {
  constructor(msg = 'ลิ้นชักที่เลือกไม่พร้อมใช้งาน') { super(msg, 'BOX_UNAVAILABLE'); }
}

// ─── Open shift ──────────────────────────────────────────────────────────────
export interface OpenShiftInput {
  cashBoxId:      string;
  openedBy:       string;
  openedByName:   string;
  openingBalance: number;
  /** Set when opening as the handover successor — links the new session back. */
  handoverFromId?: string;
}

/**
 * Opens a new shift at a specific counter.
 * Uses the partial unique indexes for race-proof single-open enforcement
 * (pre-checks are still present for friendly error messages in the common case).
 */
export async function openShift(
  tx: TxClient,
  input: OpenShiftInput,
): Promise<{ sessionId: string }> {
  // Validate box exists + active
  const box = await tx.cashBox.findUnique({
    where:  { id: input.cashBoxId },
    select: { id: true, isActive: true, currentSessionId: true },
  });
  if (!box || !box.isActive) throw new BoxUnavailableError();
  if (box.currentSessionId && box.currentSessionId !== input.handoverFromId) {
    throw new BoxInUseError();
  }

  // Friendly pre-check for user's other open sessions (the partial unique
  // index is still the source of truth — this is only for better UX).
  const userOpen = await tx.cashSession.findFirst({
    where:  { openedBy: input.openedBy, status: SessionStatus.OPEN },
    select: { id: true },
  });
  if (userOpen && userOpen.id !== input.handoverFromId) {
    throw new UserHasOpenSessionError();
  }

  try {
    const session = await tx.cashSession.create({
      data: {
        openedBy:       input.openedBy,
        openedByName:   input.openedByName,
        openingBalance: input.openingBalance,
        status:         SessionStatus.OPEN,
        cashBoxId:      input.cashBoxId,
        handoverFromId: input.handoverFromId,
      },
      select: { id: true },
    });

    // Flip the denormalized pointer on the box so /cashier and reporting
    // can find the active session in O(1).
    await tx.cashBox.update({
      where: { id: input.cashBoxId },
      data:  { currentSessionId: session.id },
    });

    return { sessionId: session.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Partial unique index fired — another request won the race.
      const target = (err.meta?.target as string | undefined) ?? '';
      if (target.includes('box')) throw new BoxInUseError();
      if (target.includes('user')) throw new UserHasOpenSessionError();
      throw new CashSessionError('ไม่สามารถเปิดกะได้ — มีกะเปิดซ้อนกันอยู่', 'CONFLICT');
    }
    throw err;
  }
}

// ─── Close shift ─────────────────────────────────────────────────────────────
export interface CloseShiftInput {
  sessionId:      string;
  closedBy:       string;
  closedByName:   string;
  closingBalance: number;
  closingNote?:   string;
}

export interface CloseShiftResult {
  sessionId:            string;
  systemCalculatedCash: number;
  cashIn:               number;
  cashRefunds:          number;
  difference:           number;
  overShortPosted:      boolean;
}

/**
 * Closes a shift, posts over/short to ledger if needed, and clears the
 * counter's current-session pointer.
 *
 * The internal `_closeShiftCore` is reused by handoverShift so the math and
 * ledger posting stay in one place.
 */
export async function closeShift(
  tx: TxClient,
  input: CloseShiftInput,
): Promise<CloseShiftResult> {
  const result = await _closeShiftCore(tx, input);

  // Clear the counter pointer so the counter becomes free again.
  await tx.cashBox.updateMany({
    where: { currentSessionId: input.sessionId },
    data:  { currentSessionId: null },
  });

  return result;
}

async function _closeShiftCore(
  tx: TxClient,
  input: CloseShiftInput,
): Promise<CloseShiftResult> {
  const session = await tx.cashSession.findUnique({
    where: { id: input.sessionId },
    select: {
      id:             true,
      status:         true,
      openingBalance: true,
      cashBoxId:      true,
      payments: {
        where:  { paymentMethod: 'cash', status: 'ACTIVE' },
        select: { amount: true },
      },
      refunds: {
        where:  { status: RefundStatus.processed, method: 'cash' },
        select: { amount: true },
      },
    },
  });

  if (!session) throw new SessionNotFoundError();
  if (session.status !== SessionStatus.OPEN) throw new SessionNotOpenError();

  const cashIn      = session.payments.reduce((s, p) => s + Number(p.amount), 0);
  const cashRefunds = session.refunds.reduce((s, r) => s + Number(r.amount), 0);
  const systemCalculatedCash = Number(session.openingBalance) + cashIn - cashRefunds;
  const difference = input.closingBalance - systemCalculatedCash;

  let overShortPosted = false;
  if (Math.abs(difference) > 0.001) {
    try {
      const overShortAcc = await resolveAccount(tx, { subKind: 'CASH_OVER_SHORT' });
      const cashAcc      = await resolveAccount(tx, { subKind: 'CASH' });

      if (difference < 0) {
        await postLedgerPair(tx, {
          debitAccount:    LedgerAccount.EXPENSE,
          debitAccountId:  overShortAcc.id,
          creditAccount:   LedgerAccount.CASH,
          creditAccountId: cashAcc.id,
          amount:          Math.abs(difference),
          referenceType:   'CashSession',
          referenceId:     input.sessionId,
          description:     `Cash shortage at shift close`,
          createdBy:       input.closedBy,
        });
      } else {
        await postLedgerPair(tx, {
          debitAccount:    LedgerAccount.CASH,
          debitAccountId:  cashAcc.id,
          creditAccount:   LedgerAccount.EXPENSE,
          creditAccountId: overShortAcc.id,
          amount:          difference,
          referenceType:   'CashSession',
          referenceId:     input.sessionId,
          description:     `Cash overage at shift close`,
          createdBy:       input.closedBy,
        });
      }
      overShortPosted = true;
    } catch (err) {
      console.warn('[closeShift] over/short ledger posting skipped:', err);
    }
  }

  await tx.cashSession.update({
    where: { id: input.sessionId },
    data: {
      closedBy:             input.closedBy,
      closedByName:         input.closedByName,
      closedAt:             new Date(),
      closingBalance:       input.closingBalance,
      systemCalculatedCash: systemCalculatedCash,
      totalCashIn:          cashIn,
      totalCashRefunds:     cashRefunds,
      overShortAmount:      difference,
      status:               SessionStatus.CLOSED,
      closingNote:          input.closingNote ?? null,
    },
  });

  return {
    sessionId:            input.sessionId,
    systemCalculatedCash,
    cashIn,
    cashRefunds,
    difference,
    overShortPosted,
  };
}

// ─── Handover (close old + open new in one transaction) ──────────────────────
export interface HandoverShiftInput {
  /** Outgoing session (currently OPEN) being handed over. */
  sessionId: string;
  /** Outgoing cashier. */
  closedBy:       string;
  closedByName:   string;
  closingBalance: number;
  closingNote?:   string;

  /** Incoming cashier (takes over the same counter). */
  newOpenedBy:       string;
  newOpenedByName:   string;
  /** Usually equals the closingBalance, but captured separately for clarity. */
  newOpeningBalance: number;
}

export interface HandoverShiftResult {
  closed: CloseShiftResult;
  newSessionId: string;
}

export async function handoverShift(
  tx: TxClient,
  input: HandoverShiftInput,
): Promise<HandoverShiftResult> {
  const session = await tx.cashSession.findUnique({
    where:  { id: input.sessionId },
    select: { cashBoxId: true, status: true, openedBy: true },
  });
  if (!session) throw new SessionNotFoundError();
  if (session.status !== SessionStatus.OPEN) throw new SessionNotOpenError();
  if (session.openedBy === input.newOpenedBy) {
    throw new CashSessionError('ไม่สามารถส่งกะให้ตนเองได้', 'HANDOVER_TO_SELF');
  }

  // Close outgoing session (does NOT clear the counter pointer yet — we'll
  // re-point it to the new session below, atomic within this transaction).
  const closed = await _closeShiftCore(tx, {
    sessionId:      input.sessionId,
    closedBy:       input.closedBy,
    closedByName:   input.closedByName,
    closingBalance: input.closingBalance,
    closingNote:    input.closingNote,
  });

  // Free the counter pointer so openShift's pre-check passes.
  await tx.cashBox.update({
    where: { id: session.cashBoxId },
    data:  { currentSessionId: null },
  });

  const { sessionId: newSessionId } = await openShift(tx, {
    cashBoxId:      session.cashBoxId,
    openedBy:       input.newOpenedBy,
    openedByName:   input.newOpenedByName,
    openingBalance: input.newOpeningBalance,
    handoverFromId: input.sessionId,
  });

  return { closed, newSessionId };
}

// ─── Force close (admin) ─────────────────────────────────────────────────────
export interface ForceCloseInput {
  sessionId:      string;
  closedBy:       string;
  closedByName:   string;
  closingBalance: number;
  reason:         string;
}

/**
 * Admin override — same as closeShift but records the reason in closingNote
 * and is expected to be gated by `admin.force_close_shift` at the API layer.
 */
export async function forceCloseShift(
  tx: TxClient,
  input: ForceCloseInput,
): Promise<CloseShiftResult> {
  return closeShift(tx, {
    sessionId:      input.sessionId,
    closedBy:       input.closedBy,
    closedByName:   input.closedByName,
    closingBalance: input.closingBalance,
    closingNote:    `[FORCE CLOSE] ${input.reason}`,
  });
}

// ─── Queries ─────────────────────────────────────────────────────────────────
export interface ActiveSessionLite {
  id:             string;
  openedAt:       Date;
  openingBalance: number;
  cashBoxId:      string;
  cashBoxCode:    string;
  cashBoxName:    string;
}

/** Returns the user's single active session (or null). */
export async function getActiveSessionForUser(
  tx: TxClient,
  userId: string,
): Promise<ActiveSessionLite | null> {
  const s = await tx.cashSession.findFirst({
    where:  { openedBy: userId, status: SessionStatus.OPEN },
    select: {
      id: true, openedAt: true, openingBalance: true, cashBoxId: true,
      cashBox: { select: { code: true, name: true } },
    },
  });
  if (!s) return null;
  return {
    id:             s.id,
    openedAt:       s.openedAt,
    openingBalance: Number(s.openingBalance),
    cashBoxId:      s.cashBoxId,
    cashBoxCode:    s.cashBox.code,
    cashBoxName:    s.cashBox.name,
  };
}

/** Returns the active session currently at a counter (or null). */
export async function getActiveSessionForBox(
  tx: TxClient,
  cashBoxId: string,
): Promise<ActiveSessionLite | null> {
  const box = await tx.cashBox.findUnique({
    where: { id: cashBoxId },
    select: {
      currentSession: {
        select: {
          id: true, openedAt: true, openingBalance: true,
          cashBox: { select: { id: true, code: true, name: true } },
        },
      },
    },
  });
  const s = box?.currentSession;
  if (!s) return null;
  return {
    id:             s.id,
    openedAt:       s.openedAt,
    openingBalance: Number(s.openingBalance),
    cashBoxId:      s.cashBox.id,
    cashBoxCode:    s.cashBox.code,
    cashBoxName:    s.cashBox.name,
  };
}

// ─── Legacy compatibility (kept for existing callers) ────────────────────────
/** @deprecated Use openShift — kept for existing payment flows. */
export async function openCashSession(
  tx: TxClient,
  input: {
    openedBy: string;
    openedByName: string;
    openingBalance: number;
    cashBoxId: string;
  },
): Promise<{ sessionId: string }> {
  return openShift(tx, input);
}

/** @deprecated Use closeShift. */
export async function closeCashSession(
  tx: TxClient,
  input: CloseShiftInput,
): Promise<CloseShiftResult> {
  return closeShift(tx, input);
}

/** @deprecated Use getActiveSessionForUser. */
export async function getCurrentSession(
  tx: TxClient,
  userId: string,
): Promise<{ id: string; openedAt: Date; openingBalance: number } | null> {
  const s = await getActiveSessionForUser(tx, userId);
  return s ? { id: s.id, openedAt: s.openedAt, openingBalance: s.openingBalance } : null;
}

// ─── Shift summary (Sprint 5 Phase 4 — rich per-method breakdown) ────────────
/**
 * getShiftSummary — structured view of a cash session's payments for the
 * Close Shift dialog. Groups non-cash by receiving account (transfer/promptpay)
 * or terminal+brand (credit_card) and counts `pendingClear` for recon visibility.
 *
 * Cash variance logic preserved upstream — this service returns the *expected*
 * cash total only; the caller still compares against counted-cash at close time.
 *
 * Returns null if session does not exist (caller may 404).
 */
export interface ShiftSummary {
  session: {
    id: string;
    openedAt: Date;
    closedAt: Date | null;
    cashBoxId: string;
    cashBoxCode: string;
    cashBoxName: string;
    openedBy: string | null;
    openedByName: string | null;
    openingFloat: number;
    status: SessionStatus;
  };
  cash: { expectedTotal: number; paymentCount: number };
  nonCash: {
    transfer:   Array<{ receivingAccountId: string | null; accountName: string | null; total: number; count: number; pendingClear: number }>;
    promptpay:  Array<{ receivingAccountId: string | null; accountName: string | null; total: number; count: number; pendingClear: number }>;
    creditCard: Array<{ terminalId: string | null; terminalCode: string | null; brand: string | null; total: number; count: number }>;
    otaCollect: { total: number; count: number };
  };
  pendingRecon: number;
  grandTotal: number;
}

export async function getShiftSummary(
  tx: TxClient,
  sessionId: string,
): Promise<ShiftSummary | null> {
  const session = await tx.cashSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true, openedAt: true, closedAt: true, status: true,
      cashBoxId: true, cashBox: { select: { code: true, name: true } },
      openedBy: true, openedByName: true,
      openingBalance: true,
    },
  });
  if (!session) return null;

  // Pull all ACTIVE payments linked to this shift. Decimal conversion at the edge.
  const payments = await tx.payment.findMany({
    where: { cashSessionId: sessionId, status: 'ACTIVE' },
    select: {
      amount:             true,
      paymentMethod:      true,
      reconStatus:        true,
      receivingAccountId: true,
      receivingAccount:   { select: { name: true, code: true } },
      terminalId:         true,
      terminal:           { select: { code: true } },
      cardBrand:          true,
    },
  });

  // Aggregate in JS — payment volume per shift is small (≤ hundreds).
  const cashAgg = { total: 0, count: 0 };
  const otaAgg  = { total: 0, count: 0 };
  const transferMap   = new Map<string, { receivingAccountId: string | null; accountName: string | null; total: number; count: number; pendingClear: number }>();
  const promptpayMap  = new Map<string, { receivingAccountId: string | null; accountName: string | null; total: number; count: number; pendingClear: number }>();
  const cardMap       = new Map<string, { terminalId: string | null; terminalCode: string | null; brand: string | null; total: number; count: number }>();
  let pendingRecon = 0;

  for (const p of payments) {
    const amt = Number(p.amount);
    if (p.reconStatus !== 'CLEARED' && p.reconStatus !== 'VOIDED') pendingRecon++;

    switch (p.paymentMethod) {
      case 'cash':
        cashAgg.total += amt; cashAgg.count += 1; break;

      case 'transfer':
      case 'promptpay': {
        const key = p.receivingAccountId ?? '(none)';
        const accountName = p.receivingAccount
          ? `${p.receivingAccount.code} — ${p.receivingAccount.name}`
          : null;
        const map = p.paymentMethod === 'transfer' ? transferMap : promptpayMap;
        const row = map.get(key) ?? {
          receivingAccountId: p.receivingAccountId,
          accountName,
          total: 0, count: 0, pendingClear: 0,
        };
        row.total += amt; row.count += 1;
        if (p.reconStatus !== 'CLEARED' && p.reconStatus !== 'VOIDED') row.pendingClear += 1;
        map.set(key, row);
        break;
      }

      case 'credit_card': {
        const key = `${p.terminalId ?? '(none)'}::${p.cardBrand ?? '(none)'}`;
        const row = cardMap.get(key) ?? {
          terminalId: p.terminalId,
          terminalCode: p.terminal?.code ?? null,
          brand: p.cardBrand as string | null,
          total: 0, count: 0,
        };
        row.total += amt; row.count += 1;
        cardMap.set(key, row);
        break;
      }

      case 'ota_collect':
        otaAgg.total += amt; otaAgg.count += 1; break;

      default: /* unknown method — skip */ break;
    }
  }

  const transfers = Array.from(transferMap.values()).sort((a, b) => b.total - a.total);
  const promptpay = Array.from(promptpayMap.values()).sort((a, b) => b.total - a.total);
  const cards     = Array.from(cardMap.values())
    .sort((a, b) => (a.terminalCode ?? '').localeCompare(b.terminalCode ?? '') || (a.brand ?? '').localeCompare(b.brand ?? ''));

  const grandTotal =
    cashAgg.total + otaAgg.total +
    transfers.reduce((s, r) => s + r.total, 0) +
    promptpay.reduce((s, r) => s + r.total, 0) +
    cards.reduce((s, r) => s + r.total, 0);

  return {
    session: {
      id: session.id,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      cashBoxId: session.cashBoxId,
      cashBoxCode: session.cashBox.code,
      cashBoxName: session.cashBox.name,
      openedBy: session.openedBy,
      openedByName: session.openedByName,
      openingFloat: Number(session.openingBalance),
      status: session.status,
    },
    cash: { expectedTotal: cashAgg.total, paymentCount: cashAgg.count },
    nonCash: {
      transfer: transfers,
      promptpay,
      creditCard: cards,
      otaCollect: otaAgg,
    },
    pendingRecon,
    grandTotal,
  };
}

// ─── Session summary (for dashboard) ─────────────────────────────────────────
export async function getSessionSummary(tx: TxClient, sessionId: string) {
  const session = await tx.cashSession.findUnique({
    where: { id: sessionId },
    select: {
      id:                   true,
      openedBy:             true,
      openedByName:         true,
      closedBy:             true,
      closedByName:         true,
      openedAt:             true,
      closedAt:             true,
      openingBalance:       true,
      closingBalance:       true,
      systemCalculatedCash: true,
      status:               true,
      closingNote:          true,
      cashBoxId:            true,
      cashBox:              { select: { code: true, name: true } },
      handoverFromId:       true,
      payments: {
        where:  { status: 'ACTIVE' },
        select: { amount: true, paymentMethod: true, createdAt: true },
      },
    },
  });

  if (!session) throw new SessionNotFoundError();

  const breakdown: Record<string, number> = {};
  for (const p of session.payments) {
    const pm = p.paymentMethod as string;
    breakdown[pm] = (breakdown[pm] ?? 0) + Number(p.amount);
  }

  const totalCollected = session.payments.reduce((sum, p) => sum + Number(p.amount), 0);

  // Phase 3 — refund activity attributed to this shift.
  // - cashOut:       cash refunds processed against this session
  // - creditIssued:  amount kept as guest credit (mode credit + split's credit leg)
  //                  (matched by created_at within shift window since GuestCredits
  //                   themselves don't carry a session id)
  // The `created_at` window vs paymentDate is fine here: refunds are issued
  // synchronously from the cashier's UI within the shift.
  const refunds = await tx.refundRecord.findMany({
    where:  { cashSessionId: sessionId },
    select: { amount: true, mode: true, cashAmount: true, creditAmount: true, processedAt: true },
  });
  let refundCashOut    = 0;
  let refundCreditIssued = 0;
  for (const r of refunds) {
    refundCashOut      += Number(r.cashAmount   ?? r.amount);
    refundCreditIssued += Number(r.creditAmount ?? 0);
  }
  // Credit-only refunds aren't attached to a cashSession (no money out),
  // so include them by created-at window matching this shift's open period.
  if (session.status === 'OPEN' || session.status === 'CLOSED') {
    const fromAt = session.openedAt;
    const toAt   = session.closedAt ?? new Date();
    const creditOnly = await tx.refundRecord.aggregate({
      where: {
        cashSessionId: null,
        mode:          'credit',
        status:        'processed',
        processedAt:   { gte: fromAt, lte: toAt },
      },
      _sum: { creditAmount: true, amount: true },
    });
    refundCreditIssued += Number(creditOnly._sum.creditAmount ?? creditOnly._sum.amount ?? 0);
  }

  return {
    id:                   session.id,
    status:               session.status,
    openedBy:             session.openedByName,
    openedById:           session.openedBy,
    closedBy:             session.closedByName ?? session.closedBy,
    openedAt:             session.openedAt,
    closedAt:             session.closedAt,
    openingBalance:       Number(session.openingBalance),
    closingBalance:       session.closingBalance ? Number(session.closingBalance) : null,
    systemCalculatedCash: session.systemCalculatedCash
      ? Number(session.systemCalculatedCash)
      : null,
    closingNote:          session.closingNote,
    cashBoxId:            session.cashBoxId,
    cashBoxCode:          session.cashBox.code,
    cashBoxName:          session.cashBox.name,
    handoverFromId:       session.handoverFromId,
    totalTransactions:    session.payments.length,
    totalCollected,
    breakdown,
    // Phase 3 — refund activity for this shift
    refundCashOut,
    refundCreditIssued,
    refundCount: refunds.length,
  };
}
