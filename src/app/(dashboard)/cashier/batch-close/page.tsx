'use client';

/**
 * /cashier/batch-close — Sprint 5 Phase 5 (EDC Batch Close)
 *
 * Cashier/Night auditor enters the EDC-reported totals for a given terminal +
 * close-date. The server recomputes the PMS-side total from ACTIVE, unbatched
 * credit-card payments; the variance is displayed and persisted on CardBatchReport.
 *
 * Design:
 *  - Form: terminal → date → batchNo → EDC total + count (+ optional note)
 *  - Preview auto-fetches on terminal/date change so the user sees the PMS side
 *    before committing. Displays "already batched" count so a repeat close is clear.
 *  - 409 on duplicate (terminal, batchNo) is surfaced as a user-friendly error.
 *  - Recent batches are listed below the form (last 20) with variance badge.
 */

import { useEffect, useMemo, useState } from 'react';
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
}

export default function BatchClosePage() {
  const toast = useToast();

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
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>💳 ส่งยอดเครื่องรูดบัตร (ปิด batch)</h1>
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
