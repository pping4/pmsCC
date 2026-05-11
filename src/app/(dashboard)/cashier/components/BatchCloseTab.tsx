'use client';

/**
 * BatchCloseTab — EDC Batch Close (extracted from /cashier/batch-close as part
 * of Sprint 5 consolidation Sub-step 1.1).
 *
 * Behaviour identical to the standalone page; embedded as a tab inside
 * /cashier so cashiers don't switch routes mid-flow.
 *
 * Cashier/Night auditor enters the EDC-reported totals for a given terminal +
 * close-date. The server recomputes the PMS-side total from ACTIVE, unbatched
 * credit-card payments; the variance is displayed and persisted on
 * CardBatchReport.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { fmtBaht, fmtDate, toDateStr } from '@/lib/date-format';
import { useToast } from '@/components/ui';

interface Terminal {
  id: string;
  code: string;
  name: string;
  acquirerBank: string | null;
  isActive: boolean;
}

interface Preview {
  terminalCode: string;
  pmsTotal: number;
  pmsTxCount: number;
  alreadyBatchedTotal: number;
  alreadyBatchedCount: number;
}

interface BatchRow {
  id: string;
  batchNo: string;
  closeDate: string;
  totalAmount: number;
  txCount: number;
  varianceAmount: number;
  closedAt: string;
  terminalCode: string;
  terminalName: string;
  // Phase 5 settlement state
  status: 'CLOSED' | 'SETTLED' | 'VOIDED';
  bankDepositAmount: number | null;
  feeAmount: number | null;
  bankReferenceNo: string | null;
  depositedAt: string | null;
}

export function BatchCloseTab() {
  const toast = useToast();
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';

  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [terminalId, setTerminalId] = useState('');
  const [closeDate, setCloseDate] = useState(toDateStr(new Date()));
  const [batchNo, setBatchNo] = useState('');
  const [edcTotal, setEdcTotal] = useState('');
  const [edcCount, setEdcCount] = useState('');
  const [note, setNote] = useState('');

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [historyRefresh, setHistoryRefresh] = useState(0);

  // Phase 5 — settle modal state
  const [settleTarget, setSettleTarget]       = useState<BatchRow | null>(null);
  const [settleDeposit, setSettleDeposit]     = useState('');
  const [settleDate, setSettleDate]           = useState(toDateStr(new Date()));
  const [settleRefNo, setSettleRefNo]         = useState('');
  const [settleNote, setSettleNote]           = useState('');
  const [settleSubmitting, setSettleSubmitting] = useState(false);
  const [settleError, setSettleError]         = useState<string | null>(null);
  const settleFee = settleTarget && settleDeposit !== ''
    ? Math.max(0, Number((settleTarget.totalAmount - Number(settleDeposit)).toFixed(2)))
    : null;

  const openSettle = (b: BatchRow) => {
    setSettleTarget(b);
    setSettleDeposit(String(b.totalAmount));  // default to gross — cashier subtracts fee
    setSettleDate(toDateStr(new Date()));
    setSettleRefNo('');
    setSettleNote('');
    setSettleError(null);
  };

  // Phase 6.6 — Void batch (admin only)
  const [voidTarget, setVoidTarget] = useState<BatchRow | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidSubmitting, setVoidSubmitting] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const openVoid = (b: BatchRow) => {
    setVoidTarget(b);
    setVoidReason('');
    setVoidError(null);
  };

  const handleVoid = async () => {
    if (!voidTarget || voidSubmitting) return;
    if (voidReason.trim().length < 5) {
      setVoidError('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');
      return;
    }
    setVoidSubmitting(true);
    setVoidError(null);
    try {
      const res = await fetch(`/api/card-batches/${voidTarget.id}/void`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: voidReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      toast.success(
        'VOID batch สำเร็จ',
        data.reversedLedger
          ? `กลับรายการ ledger · ปลดล็อค ${data.unstampedCount} payment(s)`
          : `ปลดล็อค ${data.unstampedCount} payment(s)`,
      );
      setVoidTarget(null);
      setHistoryRefresh((n) => n + 1);
    } catch (e) {
      setVoidError(e instanceof Error ? e.message : 'VOID ไม่สำเร็จ');
    } finally {
      setVoidSubmitting(false);
    }
  };

  const handleSettle = async () => {
    if (!settleTarget || settleSubmitting) return;
    const net = Number(settleDeposit);
    if (!Number.isFinite(net) || net < 0) {
      setSettleError('ยอดเงินที่ธนาคารโอนต้องเป็นจำนวนบวก'); return;
    }
    if (net > settleTarget.totalAmount + 0.5) {
      setSettleError('ยอดเงินที่ธนาคารโอนเกินยอด batch — ตรวจสอบอีกครั้ง'); return;
    }
    setSettleSubmitting(true);
    setSettleError(null);
    try {
      const res = await fetch(`/api/card-batches/${settleTarget.id}/settle`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankDepositAmount: net,
          depositedAt:       settleDate,
          bankReferenceNo:   settleRefNo.trim() || undefined,
          note:              settleNote.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      toast.success(
        'บันทึก settle สำเร็จ',
        `ยอดสุทธิ ฿${fmtBaht(data.netDeposit)} · ค่าธรรมเนียม ฿${fmtBaht(data.fee)}`,
      );
      setSettleTarget(null);
      setHistoryRefresh((n) => n + 1);
    } catch (e) {
      setSettleError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSettleSubmitting(false);
    }
  };

  // Load terminals
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/edc-terminals?active=1');
        const data = await res.json();
        setTerminals(data.terminals ?? []);
        if (data.terminals?.[0]) setTerminalId(data.terminals[0].id);
      } catch { /* ignore */ }
    })();
  }, []);

  // Load preview when terminal/date change
  useEffect(() => {
    if (!terminalId || !closeDate) { setPreview(null); return; }
    let cancelled = false;
    setPreviewLoading(true);
    (async () => {
      try {
        const qs = new URLSearchParams({ preview: '1', terminalId, closeDate });
        const res = await fetch(`/api/card-batches?${qs}`);
        const data = await res.json();
        if (!cancelled) setPreview(res.ok ? data : null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [terminalId, closeDate]);

  // Load recent batches
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/card-batches');
        const data = await res.json();
        setBatches(data.batches ?? []);
      } catch { /* ignore */ }
    })();
  }, [historyRefresh]);

  const edcTotalNum = parseFloat(edcTotal);
  const edcCountNum = parseInt(edcCount, 10);

  const variance = useMemo(() => {
    if (!preview || isNaN(edcTotalNum)) return null;
    return Number((edcTotalNum - preview.pmsTotal).toFixed(2));
  }, [preview, edcTotalNum]);

  const formValid = terminalId && batchNo.trim() && !isNaN(edcTotalNum) && edcTotalNum >= 0 && !isNaN(edcCountNum) && edcCountNum >= 0;

  const handleSubmit = async () => {
    if (!formValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/card-batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          terminalId,
          batchNo: batchNo.trim(),
          closeDate,
          edcTotalAmount: edcTotalNum,
          edcTxCount: edcCountNum,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      toast.success('ปิด batch สำเร็จ', `จับคู่ ${data.matchedPayments} รายการ · ต่าง ${fmtBaht(data.variance.amount)}`);
      setBatchNo(''); setEdcTotal(''); setEdcCount(''); setNote('');
      setHistoryRefresh((x) => x + 1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('ปิด batch ไม่สำเร็จ', msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>💳 ส่งยอดเครื่องรูดบัตร (ปิด batch)</h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          หลังกดส่งยอดที่เครื่อง EDC แล้ว บันทึกยอดรวม + จำนวนรายการที่ขึ้นบนสลิป ระบบจะเทียบกับยอดใน PMS ให้อัตโนมัติ
        </p>
      </header>

      {/* Form card */}
      <section className="pms-card pms-transition p-4 space-y-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-light)' }}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>เครื่อง EDC</label>
            <select
              value={terminalId}
              onChange={(e) => setTerminalId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-primary)' }}
            >
              {terminals.length === 0 && <option>— ไม่มีเครื่อง EDC —</option>}
              {terminals.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} — {t.name}{t.acquirerBank ? ` (${t.acquirerBank})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>วันที่ปิด batch</label>
            <input
              type="date"
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Batch #</label>
            <input
              type="text"
              value={batchNo}
              onChange={(e) => setBatchNo(e.target.value)}
              placeholder="00123"
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
              style={{ borderColor: 'var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>ยอดรวม EDC (฿)</label>
            <input
              type="number" min="0" step="0.01"
              value={edcTotal}
              onChange={(e) => setEdcTotal(e.target.value)}
              placeholder="0.00"
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono text-right"
              style={{ borderColor: 'var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-primary)' }}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>จำนวนรายการ EDC</label>
            <input
              type="number" min="0" step="1"
              value={edcCount}
              onChange={(e) => setEdcCount(e.target.value)}
              placeholder="0"
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono text-right"
              style={{ borderColor: 'var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        {/* Comparison panel */}
        <section className="rounded-lg p-3" style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-light)' }}>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>▸ ระบบเทียบกับรายการบัตรของวันนั้น</h3>
          {previewLoading && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>กำลังคำนวณ…</p>}
          {!previewLoading && preview && (
            <div className="grid grid-cols-2 gap-y-1 text-sm font-mono">
              <div style={{ color: 'var(--text-secondary)' }}>PMS (ยังไม่เข้า batch)</div>
              <div className="text-right">{fmtBaht(preview.pmsTotal)} · {preview.pmsTxCount} รายการ</div>
              <div style={{ color: 'var(--text-secondary)' }}>EDC (ที่ท่านกรอก)</div>
              <div className="text-right">
                {isNaN(edcTotalNum) ? '—' : fmtBaht(edcTotalNum)}
                {' · '}
                {isNaN(edcCountNum) ? '—' : `${edcCountNum} รายการ`}
              </div>
              <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>ส่วนต่าง</div>
              <div className="text-right font-semibold">
                {variance == null
                  ? '—'
                  : (
                    <span className={Math.abs(variance) < 0.01 ? 'text-green-600' : variance < 0 ? 'text-red-600' : 'text-yellow-700'}>
                      {variance >= 0 ? '+' : ''}{fmtBaht(variance)} {Math.abs(variance) < 0.01 ? '✓' : variance < 0 ? '❌' : '⚠️'}
                    </span>
                  )}
              </div>
              {preview.alreadyBatchedCount > 0 && (
                <>
                  <div className="col-span-2 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    ℹ️ วันนี้มี {preview.alreadyBatchedCount} รายการ ({fmtBaht(preview.alreadyBatchedTotal)}) เข้า batch ก่อนหน้าแล้ว — ถูกตัดออกจากยอด PMS ด้านบน
                  </div>
                </>
              )}
            </div>
          )}
          {!previewLoading && !preview && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>— เลือกเครื่องและวันที่เพื่อดูการเทียบยอด —</p>
          )}
        </section>

        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>บันทึก (ถ้ามี)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เช่น เครื่องค้าง ต้อง reconcile พรุ่งนี้"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-primary)' }}
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs">{error}</div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={() => { setBatchNo(''); setEdcTotal(''); setEdcCount(''); setNote(''); setError(null); }}
            disabled={submitting}
            className="px-4 py-2 rounded-lg border text-sm disabled:opacity-50"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          >ล้างฟอร์ม</button>
          <button
            onClick={handleSubmit}
            disabled={!formValid || submitting}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {submitting ? 'กำลังปิด...' : '🔒 ยืนยันปิด batch'}
          </button>
        </div>
      </section>

      {/* Recent batches */}
      <section className="pms-card pms-transition p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-light)' }}>
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>ประวัติการปิด batch (20 รายการล่าสุด)</h2>
        {batches.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>— ยังไม่มี batch —</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface-subtle)', color: 'var(--text-secondary)' }}>
                  <th className="text-left px-3 py-2">วันที่</th>
                  <th className="text-left px-3 py-2">เครื่อง</th>
                  <th className="text-left px-3 py-2">Batch #</th>
                  <th className="text-right px-3 py-2">ยอด EDC</th>
                  <th className="text-right px-3 py-2">รายการ</th>
                  <th className="text-right px-3 py-2">ส่วนต่าง</th>
                  <th className="text-center px-3 py-2">สถานะ</th>
                  <th className="text-right px-3 py-2">ฝากเข้าธนาคาร</th>
                  <th className="text-right px-3 py-2">ค่าธรรมเนียม</th>
                  <th className="text-center px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {batches.slice(0, 20).map((b, i) => {
                  const bg = i % 2 === 0 ? 'var(--surface-card)' : 'var(--surface-subtle)';
                  const varOk = Math.abs(b.varianceAmount) < 0.01;
                  return (
                    <tr key={b.id} style={{ background: bg }}>
                      <td className="px-3 py-2 font-mono">{fmtDate(new Date(b.closeDate))}</td>
                      <td className="px-3 py-2">{b.terminalCode} — {b.terminalName}</td>
                      <td className="px-3 py-2 font-mono">{b.batchNo}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtBaht(b.totalAmount)}</td>
                      <td className="px-3 py-2 text-right">{b.txCount}</td>
                      <td className={`px-3 py-2 text-right font-mono ${varOk ? 'text-green-600' : 'text-yellow-700'}`}>
                        {b.varianceAmount >= 0 ? '+' : ''}{fmtBaht(b.varianceAmount)} {varOk ? '✓' : '⚠️'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {b.status === 'SETTLED' ? (
                          <span className="text-xs font-semibold" style={{ color: '#15803d', background: '#dcfce7', padding: '2px 10px', borderRadius: 999 }}>
                            ✓ ฝากแล้ว
                          </span>
                        ) : b.status === 'VOIDED' ? (
                          <span className="text-xs font-semibold" style={{ color: '#6b7280', background: '#f3f4f6', padding: '2px 10px', borderRadius: 999 }}>
                            ยกเลิก
                          </span>
                        ) : (
                          <span className="text-xs font-semibold" style={{ color: '#92400e', background: '#fef3c7', padding: '2px 10px', borderRadius: 999 }}>
                            ⏳ รอ settle
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {b.bankDepositAmount != null ? `฿${fmtBaht(b.bankDepositAmount)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono" style={{ color: '#b45309' }}>
                        {b.feeAmount != null ? `฿${fmtBaht(b.feeAmount)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex gap-1 justify-center">
                          {b.status === 'CLOSED' && (
                            <button
                              onClick={() => openSettle(b)}
                              className="px-3 py-1 rounded text-xs font-semibold"
                              style={{ background: '#2563eb', color: '#fff' }}
                            >
                              🏦 บันทึกเงินเข้า
                            </button>
                          )}
                          {isAdmin && b.status !== 'VOIDED' && (
                            <button
                              onClick={() => openVoid(b)}
                              className="px-2 py-1 rounded text-xs font-semibold border"
                              style={{ borderColor: '#fca5a5', color: '#991b1b' }}
                              title={b.status === 'SETTLED'
                                ? 'VOID — กลับรายการฝากเงินและปลดล็อค payment'
                                : 'VOID — ปลดล็อค payment ให้ batch ใหม่ได้'}
                            >
                              🚫 VOID
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Phase 5 — Bank Settlement Modal ────────────────────────────── */}
      {settleTarget && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, zIndex: 1100,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={() => !settleSubmitting && setSettleTarget(null)}
          />
          <div
            className="pms-card"
            style={{
              position: 'relative', zIndex: 1, width: '100%', maxWidth: 500,
              background: 'var(--surface-card)', borderRadius: 12, padding: 20,
              boxShadow: '0 20px 25px rgba(0,0,0,0.15)',
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              🏦 บันทึกเงินเข้าธนาคาร — Settle Batch
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>
              บันทึกยอดเงินที่ธนาคารโอนเข้าบัญชี ระบบจะคำนวณค่าธรรมเนียมและลง ledger อัตโนมัติ
            </p>

            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 12 }}>
              <div><strong>Batch:</strong> <span className="font-mono">{settleTarget.batchNo}</span> · {settleTarget.terminalCode}</div>
              <div><strong>วันที่ปิด:</strong> {fmtDate(new Date(settleTarget.closeDate))}</div>
              <div><strong>ยอดรวมจาก EDC:</strong> <span className="font-mono">฿{fmtBaht(settleTarget.totalAmount)}</span> ({settleTarget.txCount} รายการ)</div>
            </div>

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              ยอดเงินที่ธนาคารโอนเข้า (net) <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              type="number"
              value={settleDeposit}
              onChange={(e) => setSettleDeposit(e.target.value)}
              disabled={settleSubmitting}
              step="0.01"
              min={0}
              max={settleTarget.totalAmount}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: '1px solid var(--border-default)',
                fontFamily: 'monospace', fontSize: 14,
              }}
            />
            {settleFee != null && (
              <p style={{ fontSize: 11, color: settleFee > 0 ? '#b45309' : '#16a34a', marginTop: 4 }}>
                {settleFee > 0
                  ? `→ ค่าธรรมเนียมที่ระบบจะลงเป็นค่าใช้จ่าย: ฿${fmtBaht(settleFee)}`
                  : '→ ไม่มีค่าธรรมเนียม (ยอดเต็มเข้าบัญชี)'}
              </p>
            )}

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginTop: 12, marginBottom: 4 }}>
              วันที่ฝาก
            </label>
            <input
              type="date"
              value={settleDate}
              onChange={(e) => setSettleDate(e.target.value)}
              disabled={settleSubmitting}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: '1px solid var(--border-default)', fontSize: 13,
              }}
            />

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginTop: 12, marginBottom: 4 }}>
              เลขอ้างอิงสลิป (ถ้ามี)
            </label>
            <input
              type="text"
              value={settleRefNo}
              onChange={(e) => setSettleRefNo(e.target.value)}
              disabled={settleSubmitting}
              placeholder="เช่น 20260429-001"
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: '1px solid var(--border-default)', fontSize: 13, fontFamily: 'monospace',
              }}
            />

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginTop: 12, marginBottom: 4 }}>
              หมายเหตุ
            </label>
            <textarea
              value={settleNote}
              onChange={(e) => setSettleNote(e.target.value)}
              disabled={settleSubmitting}
              rows={2}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: '1px solid var(--border-default)', fontSize: 13,
              }}
            />

            {settleError && (
              <div style={{ marginTop: 10, padding: '8px 10px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fca5a5', fontSize: 12, color: '#b91c1c' }}>
                {settleError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setSettleTarget(null)}
                disabled={settleSubmitting}
                className="flex-1 px-4 py-2 rounded-lg border text-sm disabled:opacity-50"
                style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              >
                ปิด
              </button>
              <button
                type="button"
                onClick={handleSettle}
                disabled={settleSubmitting || !settleDeposit}
                className="flex-[2] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold"
              >
                {settleSubmitting ? '⏳ กำลังบันทึก…' : '✓ ยืนยันการ Settle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Phase 6.6 — VOID Batch Modal ───────────────────────────────── */}
      {voidTarget && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, zIndex: 1100,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={() => !voidSubmitting && setVoidTarget(null)}
          />
          <div
            className="pms-card"
            style={{
              position: 'relative', zIndex: 1, width: '100%', maxWidth: 500,
              background: 'var(--surface-card)', borderRadius: 12, padding: 20,
              boxShadow: '0 20px 25px rgba(0,0,0,0.15)',
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>
              🚫 VOID Card Batch
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>
              {voidTarget.status === 'SETTLED'
                ? 'ระบบจะกลับรายการ ledger (DR Clearing / CR Bank + CR CardFee) และปลดล็อค payment เพื่อสร้าง batch ใหม่ได้'
                : 'ระบบจะปลดล็อค payment ทั้งหมดใน batch นี้ เพื่อให้ batch ใหม่ดึงไปจับคู่ได้'}
            </p>

            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
              padding: 10, marginBottom: 14, fontSize: 12, color: '#991b1b',
            }}>
              <div><strong>Batch:</strong> <span className="font-mono">{voidTarget.batchNo}</span> · {voidTarget.terminalCode}</div>
              <div><strong>ยอด:</strong> <span className="font-mono">฿{fmtBaht(voidTarget.totalAmount)}</span> ({voidTarget.txCount} รายการ)</div>
              {voidTarget.status === 'SETTLED' && voidTarget.bankDepositAmount != null && (
                <div><strong>ฝากเข้า:</strong> <span className="font-mono">฿{fmtBaht(voidTarget.bankDepositAmount)}</span></div>
              )}
              <div style={{ marginTop: 4 }}>⚠️ การกระทำนี้ไม่สามารถเลิกได้</div>
            </div>

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              เหตุผล * (อย่างน้อย 5 ตัวอักษร)
            </label>
            <textarea
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              disabled={voidSubmitting}
              rows={3}
              placeholder="เช่น ป้อนยอดผิด / batch ซ้ำ / ธนาคารแก้ไขยอดฝาก"
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: '1px solid var(--border-default)', fontSize: 13,
                resize: 'vertical', boxSizing: 'border-box',
              }}
            />

            {voidError && (
              <div style={{
                marginTop: 10, padding: '8px 10px', background: '#fef2f2', borderRadius: 6,
                border: '1px solid #fca5a5', fontSize: 12, color: '#b91c1c',
              }}>
                {voidError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                disabled={voidSubmitting}
                className="flex-1 px-4 py-2 rounded-lg border text-sm disabled:opacity-50"
                style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              >
                ปิด
              </button>
              <button
                type="button"
                onClick={handleVoid}
                disabled={voidSubmitting || voidReason.trim().length < 5}
                className="flex-[2] px-4 py-2 rounded-lg disabled:opacity-50 text-white text-sm font-semibold"
                style={{ background: '#dc2626' }}
              >
                {voidSubmitting ? '⏳ กำลังบันทึก…' : '✓ ยืนยัน VOID'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
