'use client';

/**
 * CloseShiftDialog — Sprint 5 Phase 4.3 redesign.
 *
 * Shows a 3-section layout:
 *   1) Cash — opening float, expected, counted input, live variance
 *   2) Non-cash breakdown — per receiving account (transfer/promptpay),
 *      per terminal+brand (credit_card), OTA collect. Each row shows
 *      a ⏳ pendingClear badge so the cashier sees what will flow to
 *      the reconciliation queue.
 *   3) Summary — grand total + count of rows awaiting recon + note
 *
 * Close still POSTs to `/api/cash-sessions/[id]/close` unchanged;
 * non-cash remains `RECEIVED` after close (not forced to CLEARED).
 */

import { useEffect, useMemo, useState } from 'react';
import { fmtBaht } from '@/lib/date-format';
import { useToast } from '@/components/ui';

export interface CloseShiftContext {
  sessionId:    string;
  cashBoxCode:  string | null;
  /** Kept for back-compat; the dialog now fetches its own authoritative summary. */
  expectedCash?: number;
}

interface Props {
  open:      boolean;
  onClose:   () => void;
  onSuccess: (result: { systemCalculatedCash: number; difference: number; closingBalance: number }) => void;
  ctx:       CloseShiftContext;
}

interface ShiftSummary {
  session: {
    id: string;
    openedAt: string;
    cashBoxId: string;
    cashBoxCode: string;
    cashBoxName: string;
    openedByName: string | null;
    openingFloat: number;
    status: string;
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

export function CloseShiftDialog({ open, onClose, onSuccess, ctx }: Props) {
  const toast = useToast();

  const [summary,    setSummary]    = useState<ShiftSummary | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [closingBal, setClosingBal] = useState('');
  const [closingNote, setClosingNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // Load authoritative summary each time the dialog opens
  useEffect(() => {
    if (!open) return;
    setClosingBal(''); setClosingNote(''); setError(null); setSummary(null);
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/cash-sessions/${ctx.sessionId}/summary`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ShiftSummary;
        setSummary(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'โหลดสรุปกะไม่สำเร็จ');
      } finally {
        setLoading(false);
      }
    })();
  }, [open, ctx.sessionId]);

  const expectedCash = summary?.cash.expectedTotal ?? ctx.expectedCash ?? 0;
  const openingFloat = summary?.session.openingFloat ?? 0;
  const cashToCount  = openingFloat + expectedCash;

  const closingAmt = parseFloat(closingBal);
  const valid      = !isNaN(closingAmt) && closingAmt >= 0;
  const diff       = valid ? closingAmt - cashToCount : 0;
  const diffOk     = Math.abs(diff) < 1;
  const bigVariance = valid && Math.abs(diff) > 100;

  // Large variance requires a non-empty note (existing business rule)
  const mustHaveNote = bigVariance && !closingNote.trim();

  const nonCashTotal = useMemo(() => {
    if (!summary) return 0;
    const { transfer, promptpay, creditCard, otaCollect } = summary.nonCash;
    return [
      ...transfer, ...promptpay, ...creditCard,
      { total: otaCollect.total },
    ].reduce((s, r) => s + r.total, 0);
  }, [summary]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (submitting || !valid || mustHaveNote) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/cash-sessions/${ctx.sessionId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          closingBalance: closingAmt,
          closingNote:    closingNote.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      toast.success('ปิดกะสำเร็จ');
      onSuccess({
        systemCalculatedCash: data.systemCalculatedCash ?? cashToCount,
        difference:           data.difference ?? diff,
        closingBalance:       closingAmt,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('ปิดกะไม่สำเร็จ', msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div
        className="rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--surface-card)' }}
      >
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>🔒 ปิดกะ</h2>
            {summary && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {summary.session.cashBoxCode} · {summary.session.openedByName ?? '—'}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none disabled:opacity-40"
          >×</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {loading && (
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>กำลังโหลดสรุปกะ…</div>
          )}

          {/* ─── Section 1: Cash ───────────────────────────────────────── */}
          {summary && (
            <section
              className="rounded-lg p-3"
              style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-light)' }}
            >
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>1. เงินสด</h3>
              <div className="grid grid-cols-2 gap-y-1 text-sm font-mono">
                <div style={{ color: 'var(--text-secondary)' }}>เงินทอนต้น</div>
                <div className="text-right">{fmtBaht(openingFloat)}</div>
                <div style={{ color: 'var(--text-secondary)' }}>ระบบคาดว่า (+{summary.cash.paymentCount} รายการ)</div>
                <div className="text-right">+{fmtBaht(expectedCash)}</div>
                <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>รวมที่ควรนับได้</div>
                <div className="text-right font-semibold">{fmtBaht(cashToCount)}</div>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>นับจริง (฿)</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={closingBal}
                    onChange={(e) => setClosingBal(e.target.value)}
                    disabled={submitting}
                    autoFocus
                    placeholder="0.00"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--border-default)' }}
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>ส่วนต่าง</label>
                  <div
                    className={`rounded-lg px-3 py-2 text-sm font-mono ${
                      !valid ? '' : diffOk ? 'bg-green-50 text-green-700' : diff < 0 ? 'bg-red-50 text-red-700' : 'bg-yellow-50 text-yellow-700'
                    }`}
                    style={!valid ? { background: 'var(--surface-muted)', color: 'var(--text-muted)' } : {}}
                  >
                    {valid
                      ? `${diff >= 0 ? '+' : ''}${fmtBaht(diff)} ${diffOk ? '🟢' : diff < 0 ? '❌ ขาด' : '⚠️ เกิน'}`
                      : '—'}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ─── Section 2: Non-cash breakdown ─────────────────────────── */}
          {summary && (
            <section
              className="rounded-lg p-3"
              style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-light)' }}
            >
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                2. ยอดไม่ใช่เงินสด <span className="font-normal" style={{ color: 'var(--text-muted)' }}>(ส่งต่อบัญชีตรวจสอบ)</span>
              </h3>

              {nonCashTotal === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>— ไม่มีรายการ —</p>
              ) : (
                <div className="space-y-1 text-sm font-mono">
                  {summary.nonCash.transfer.map((r) => (
                    <BreakdownRow
                      key={`t-${r.receivingAccountId ?? 'none'}`}
                      label={`โอนเข้า ${r.accountName ?? '—'}`}
                      total={r.total} count={r.count} pendingClear={r.pendingClear}
                    />
                  ))}
                  {summary.nonCash.promptpay.map((r) => (
                    <BreakdownRow
                      key={`p-${r.receivingAccountId ?? 'none'}`}
                      label={`PromptPay → ${r.accountName ?? '—'}`}
                      total={r.total} count={r.count} pendingClear={r.pendingClear}
                    />
                  ))}
                  {summary.nonCash.creditCard.map((r) => (
                    <BreakdownRow
                      key={`c-${r.terminalId ?? 'none'}-${r.brand ?? 'none'}`}
                      label={`บัตร ${r.terminalCode ?? '—'} · ${r.brand ?? '—'}`}
                      total={r.total} count={r.count}
                    />
                  ))}
                  {summary.nonCash.otaCollect.count > 0 && (
                    <BreakdownRow
                      label="OTA Collect"
                      total={summary.nonCash.otaCollect.total}
                      count={summary.nonCash.otaCollect.count}
                    />
                  )}
                  <div className="flex justify-between border-t pt-1 mt-1 font-semibold" style={{ borderColor: 'var(--border-light)' }}>
                    <span>รวมไม่ใช่เงินสด</span>
                    <span>{fmtBaht(nonCashTotal)}</span>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ─── Section 3: Summary ────────────────────────────────────── */}
          {summary && (
            <section
              className="rounded-lg p-3"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border-light)' }}
            >
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>3. สรุป</h3>
              <div className="grid grid-cols-2 gap-y-1 text-sm font-mono">
                <div style={{ color: 'var(--text-secondary)' }}>ยอดรวมกะ</div>
                <div className="text-right font-semibold">{fmtBaht(summary.grandTotal)}</div>
                <div style={{ color: 'var(--text-secondary)' }}>รายการรอตรวจสอบ</div>
                <div className="text-right">
                  {summary.pendingRecon} รายการ {summary.pendingRecon > 0 ? '⏳' : '✓'}
                </div>
              </div>
            </section>
          )}

          {summary && (
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                บันทึก {bigVariance && <span className="text-red-600">* (ส่วนต่าง &gt; ฿100 — กรุณาระบุเหตุผล)</span>}
              </label>
              <input
                type="text"
                value={closingNote}
                onChange={(e) => setClosingNote(e.target.value)}
                disabled={submitting}
                placeholder="เช่น ธนบัตร ฿500 x 10 / ขาดไป ให้เจ้าหน้าที่ยืมไปทอนลูกค้า"
                className="w-full border rounded-lg px-3 py-2 text-sm"
                style={{ borderColor: mustHaveNote ? 'var(--danger)' : 'var(--border-default)' }}
              />
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-3 flex justify-end gap-2" style={{ borderTop: '1px solid var(--border-light)' }}>
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg border text-sm hover:bg-gray-50 disabled:opacity-50"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          >ยกเลิก</button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !valid || mustHaveNote || !summary}
            className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium disabled:opacity-50"
          >
            {submitting ? 'กำลังปิดกะ...' : '🔒 ยืนยันปิดกะ'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BreakdownRow({
  label, total, count, pendingClear,
}: { label: string; total: number; count: number; pendingClear?: number }) {
  return (
    <div className="flex justify-between items-center">
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span>
        {fmtBaht(total)} <span style={{ color: 'var(--text-muted)' }}>({count} รายการ)</span>
        {pendingClear != null && pendingClear > 0 && (
          <span className="ml-1 text-amber-600">⏳{pendingClear}</span>
        )}
      </span>
    </div>
  );
}
