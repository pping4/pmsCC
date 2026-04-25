'use client';

/**
 * HandoverDialog — Sprint 4B / B-T9.
 *
 * Used by the cashier on an open shift to close their shift AND immediately
 * open a successor at the same counter for an incoming cashier. The whole
 * thing runs in one atomic server transaction.
 *
 * Required fields:
 *   - incomingUserId   — picked from /api/cash-sessions/eligible-cashiers
 *   - closingBalance   — outgoing cashier's counted cash
 *   - newOpeningBalance — incoming cashier's counted starting cash
 *   - closingNote      — free-form, optional but recommended on mismatch
 */

import { useEffect, useState } from 'react';
import { fmtBaht } from '@/lib/date-format';
import { useToast } from '@/components/ui';

interface EligibleUser {
  id:    string;
  name:  string | null;
  email: string;
  role:  string;
}

export interface HandoverContext {
  sessionId:      string;
  cashBoxCode:    string | null;
  expectedCash:   number; // openingBalance + net cash from system
}

interface Props {
  open:      boolean;
  onClose:   () => void;
  onSuccess: () => void;
  ctx:       HandoverContext;
}

export function HandoverDialog({ open, onClose, onSuccess, ctx }: Props) {
  const toast = useToast();

  const [users,       setUsers]       = useState<EligibleUser[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listErr,     setListErr]     = useState<string | null>(null);

  const [incoming,      setIncoming]      = useState('');
  const [closingBal,    setClosingBal]    = useState('');
  const [closingNote,   setClosingNote]   = useState('');
  const [newOpenBal,    setNewOpenBal]    = useState('');
  const [submitting,    setSubmitting]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  // Reset + fetch when the dialog opens
  useEffect(() => {
    if (!open) return;
    setIncoming(''); setClosingBal(''); setClosingNote(''); setNewOpenBal('');
    setError(null); setListErr(null);
    setLoadingList(true);
    fetch('/api/cash-sessions/eligible-cashiers')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json() as { users: EligibleUser[] };
        setUsers(data.users ?? []);
      })
      .catch((e) => setListErr(e instanceof Error ? e.message : 'โหลดรายชื่อไม่สำเร็จ'))
      .finally(() => setLoadingList(false));
  }, [open]);

  if (!open) return null;

  const closingAmt = parseFloat(closingBal);
  const openAmt    = parseFloat(newOpenBal);
  const diff       = isNaN(closingAmt) ? 0 : closingAmt - ctx.expectedCash;
  const diffOk     = Math.abs(diff) < 1;

  const canSubmit =
    !submitting &&
    incoming !== '' &&
    !isNaN(closingAmt) && closingAmt >= 0 &&
    !isNaN(openAmt)    && openAmt    >= 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/cash-sessions/${ctx.sessionId}/handover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          closingBalance:    closingAmt,
          closingNote:       closingNote.trim() || undefined,
          newOpenedBy:       incoming,
          newOpeningBalance: openAmt,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      toast.success('ส่งกะสำเร็จ', 'เปิดกะใหม่ให้ผู้รับกะแล้ว');
      onSuccess();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('ส่งกะไม่สำเร็จ', msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">🔄 ส่งกะ (Handover)</h2>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none disabled:opacity-40"
          >×</button>
        </div>

        <p className="text-xs text-gray-600">
          ปิดกะของคุณและเปิดกะใหม่ที่เคาน์เตอร์เดียวกัน
          {ctx.cashBoxCode && <> <span className="font-semibold">({ctx.cashBoxCode})</span></>}
          ให้ผู้รับกะในคำสั่งเดียว — ใช้ transaction เดียวกัน ล้มเหลวย้อนกลับทั้งหมด
        </p>

        {/* Incoming cashier picker */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">ผู้รับกะ</label>
          {loadingList ? (
            <div className="text-xs text-gray-500">กำลังโหลดรายชื่อ...</div>
          ) : listErr ? (
            <div className="text-xs text-red-600">{listErr}</div>
          ) : users.length === 0 ? (
            <div className="text-xs text-yellow-700 bg-yellow-50 rounded-lg p-2 border border-yellow-200">
              ไม่มีผู้ใช้อื่นที่มีสิทธิ์เปิดกะ
            </div>
          ) : (
            <select
              value={incoming}
              onChange={(e) => setIncoming(e.target.value)}
              disabled={submitting}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">— เลือกผู้รับกะ —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email} — {u.role}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Outgoing close balance */}
        <div className="border-t pt-3">
          <p className="text-xs font-semibold text-gray-700 mb-2">ปิดกะของคุณ</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">ยอดที่นับได้จริง (฿)</label>
              <input
                type="number" min="0" step="0.01"
                value={closingBal}
                onChange={(e) => setClosingBal(e.target.value)}
                disabled={submitting}
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">ระบบคำนวณ</label>
              <div className="border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm font-mono text-gray-700">
                ฿{fmtBaht(ctx.expectedCash)}
              </div>
            </div>
          </div>
          {closingBal !== '' && !isNaN(closingAmt) && (
            <div className={`mt-2 text-xs rounded-lg px-3 py-2 ${
              diffOk ? 'bg-green-50 text-green-700' : diff < 0 ? 'bg-red-50 text-red-700' : 'bg-yellow-50 text-yellow-700'
            }`}>
              ส่วนต่าง: {diff >= 0 ? '+' : ''}{fmtBaht(diff)} {diffOk ? '✅' : diff < 0 ? '❌ ขาด' : '⚠️ เกิน'}
            </div>
          )}
          <div className="mt-2">
            <label className="block text-xs text-gray-500 mb-1">หมายเหตุ (ถ้ามี)</label>
            <input
              type="text"
              value={closingNote}
              onChange={(e) => setClosingNote(e.target.value)}
              disabled={submitting}
              placeholder="เช่น ธนบัตร ฿500 x 10"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* Incoming opening balance */}
        <div className="border-t pt-3">
          <p className="text-xs font-semibold text-gray-700 mb-2">เปิดกะใหม่ให้ผู้รับกะ</p>
          <label className="block text-xs text-gray-500 mb-1">ยอดเงินเปิดกล่อง (฿)</label>
          <input
            type="number" min="0" step="0.01"
            value={newOpenBal}
            onChange={(e) => setNewOpenBal(e.target.value)}
            disabled={submitting}
            placeholder="0.00"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            ปกติตั้งให้เท่ากับยอดที่นับได้จริง เพื่อให้เงินในกล่องไม่ต้องนับใหม่
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t pt-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 disabled:opacity-50"
          >ยกเลิก</button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
          >
            {submitting ? 'กำลังส่งกะ...' : '🔄 ยืนยันส่งกะ'}
          </button>
        </div>
      </div>
    </div>
  );
}
