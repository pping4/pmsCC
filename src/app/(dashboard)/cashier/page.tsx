'use client';

/**
 * /cashier — Cashier Shift Dashboard
 *
 * Features:
 *  - Show current open session (if any)
 *  - Open new session (with opening balance input)
 *  - Live transaction list for current session
 *  - Close session (with closing balance input + note)
 *  - Session history for manager/admin
 */

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { fmtDateTime, fmtBaht } from '@/lib/date-format';

function fmtDate(dateStr: string): string {
  return fmtDateTime(dateStr);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CashSession {
  id:             string;
  openedAt:       string;
  openingBalance: number;
  openedByName:   string | null;
  totalPayments:  number;
}

interface SessionSummary {
  id:                   string;
  status:               'OPEN' | 'CLOSED';
  openedBy:             string;
  closedBy:             string | null;
  openedAt:             string;
  closedAt:             string | null;
  openingBalance:       number;
  closingBalance:       number | null;
  systemCalculatedCash: number | null;
  closingNote:          string | null;
  totalTransactions:    number;
  totalCollected:       number;
  breakdown:            Record<string, number>;
}

interface SessionHistoryItem {
  id:                   string;
  openedByName:         string | null;
  openedAt:             string;
  closedAt:             string | null;
  openingBalance:       string;
  closingBalance:       string | null;
  systemCalculatedCash: string | null;
  status:               'OPEN' | 'CLOSED';
  _count:               { payments: number };
}

const PM_LABEL: Record<string, string> = {
  cash:        '💵 เงินสด',
  transfer:    '🏦 โอนเงิน',
  credit_card: '💳 บัตรเครดิต',
  promptpay:   '📱 พร้อมเพย์',
  ota_collect: '🌐 OTA',
};

function baht(n: number | null | undefined): string {
  if (n == null) return '—';
  return fmtBaht(n);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CashierPage() {
  const { data: authSession } = useSession();
  const userId   = (authSession?.user as { id?: string })?.id ?? authSession?.user?.email ?? '';
  const userName = authSession?.user?.name ?? '';

  const [currentSession, setCurrentSession]       = useState<CashSession | null>(null);
  const [sessionDetail,  setSessionDetail]        = useState<SessionSummary | null>(null);
  const [history,        setHistory]              = useState<SessionHistoryItem[]>([]);
  const [loading,        setLoading]              = useState(true);

  // Forms
  const [openBalance,  setOpenBalance]  = useState('');
  const [closeBalance, setCloseBalance] = useState('');
  const [closeNote,    setCloseNote]    = useState('');
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState('');

  // Close-shift result (shown after API call)
  const [closeResult, setCloseResult] = useState<{
    systemCalculatedCash: number;
    difference: number;
    closingBalance: number;
  } | null>(null);

  // ── Fetch current session ──────────────────────────────────────────────────
  const fetchCurrentSession = useCallback(async () => {
    try {
      const res  = await fetch('/api/cash-sessions/current');
      const data = await res.json();
      setCurrentSession(data.session ?? null);

      if (data.session) {
        const detRes  = await fetch(`/api/cash-sessions/${data.session.id}`);
        const detData = await detRes.json();
        setSessionDetail(detData.session ?? null);
      } else {
        setSessionDetail(null);
      }
    } catch {
      setError('โหลดข้อมูลกะล้มเหลว');
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res  = await fetch('/api/cash-sessions?limit=10');
      const data = await res.json();
      setHistory(data.sessions ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchCurrentSession();
      await fetchHistory();
      setLoading(false);
    })();
  }, [fetchCurrentSession, fetchHistory]);

  // ── Open session ───────────────────────────────────────────────────────────
  const handleOpen = async () => {
    setError('');
    const amount = parseFloat(openBalance);
    if (isNaN(amount) || amount < 0) {
      setError('กรุณาระบุยอดเงินเปิดกล่องที่ถูกต้อง');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/cash-sessions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openedBy:       userId,
          openedByName:   userName,
          openingBalance: amount,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'เปิดกะล้มเหลว'); return; }
      setOpenBalance('');
      await fetchCurrentSession();
      await fetchHistory();
    } catch {
      setError('เกิดข้อผิดพลาด');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Close session ──────────────────────────────────────────────────────────
  const handleClose = async () => {
    if (!currentSession) return;
    setError('');
    const amount = parseFloat(closeBalance);
    if (isNaN(amount) || amount < 0) {
      setError('กรุณาระบุยอดเงินปิดกล่องที่ถูกต้อง');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/cash-sessions/${currentSession.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          closedBy:       userId,
          closedByName:   userName,
          closingBalance: amount,
          closingNote:    closeNote || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'ปิดกะล้มเหลว'); return; }

      // Show summary result from API
      setCloseResult({
        systemCalculatedCash: data.systemCalculatedCash ?? 0,
        difference:           data.difference ?? 0,
        closingBalance:       amount,
      });

      setCloseBalance('');
      setCloseNote('');
      await fetchCurrentSession();
      await fetchHistory();
    } catch {
      setError('เกิดข้อผิดพลาด');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        กำลังโหลด...
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">🏦 กะแคชเชียร์</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* ── Close shift result banner ─────────────────────────────────────── */}
      {closeResult && (
        <div className={`rounded-xl border p-5 space-y-3 ${
          Math.abs(closeResult.difference) < 1
            ? 'bg-green-50 border-green-200'
            : closeResult.difference < 0
              ? 'bg-red-50 border-red-200'
              : 'bg-yellow-50 border-yellow-200'
        }`}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">
              {Math.abs(closeResult.difference) < 1 ? '✅ ปิดกะสำเร็จ — ยอดตรง' : '⚠️ ปิดกะสำเร็จ — ยอดไม่ตรง'}
            </h3>
            <button
              onClick={() => setCloseResult(null)}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            >×</button>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <p className="text-xs text-gray-500 mb-1">ยอดที่นับได้</p>
              <p className="text-lg font-bold text-gray-800">฿{baht(closeResult.closingBalance)}</p>
            </div>
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <p className="text-xs text-gray-500 mb-1">ระบบคำนวณ</p>
              <p className="text-lg font-bold text-blue-600">฿{baht(closeResult.systemCalculatedCash)}</p>
              <p className="text-xs text-gray-400">(เปิดกล่อง + รับสด)</p>
            </div>
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <p className="text-xs text-gray-500 mb-1">ส่วนต่าง</p>
              <p className={`text-lg font-bold ${
                Math.abs(closeResult.difference) < 1
                  ? 'text-green-600'
                  : closeResult.difference < 0
                    ? 'text-red-600'
                    : 'text-yellow-600'
              }`}>
                {closeResult.difference >= 0 ? '+' : ''}{baht(closeResult.difference)}
              </p>
              <p className="text-xs text-gray-400">
                {Math.abs(closeResult.difference) < 1
                  ? 'ตรง'
                  : closeResult.difference < 0
                    ? 'ขาด'
                    : 'เกิน'}
              </p>
            </div>
          </div>
          {Math.abs(closeResult.difference) >= 1 && (
            <p className="text-xs text-gray-600">
              💡 กรุณาตรวจสอบเงินในกล่องและรายการธุรกรรมอีกครั้ง หรือบันทึกหมายเหตุไว้ในกะถัดไป
            </p>
          )}
        </div>
      )}

      {/* ── Current session card ──────────────────────────────────────────── */}
      {currentSession ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-green-700 bg-green-100 px-3 py-1 rounded-full">
                🟢 กะเปิดอยู่
              </span>
              <p className="text-xs text-gray-500 mt-1">
                เปิดเมื่อ {fmtDate(currentSession.openedAt)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">ยอดเปิดกล่อง</p>
              <p className="text-lg font-bold text-gray-800">฿{baht(currentSession.openingBalance)}</p>
            </div>
          </div>

          {/* Session breakdown */}
          {sessionDetail && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                <p className="text-xs text-gray-500">รายการทั้งหมด</p>
                <p className="text-xl font-bold text-blue-600">{sessionDetail.totalTransactions}</p>
              </div>
              <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                <p className="text-xs text-gray-500">ยอดรวม</p>
                <p className="text-xl font-bold text-green-600">฿{baht(sessionDetail.totalCollected)}</p>
              </div>
              <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                <p className="text-xs text-gray-500">เงินสดในกล่อง (ระบบ)</p>
                <p className="text-xl font-bold text-gray-700">
                  ฿{baht((sessionDetail.openingBalance) + (sessionDetail.breakdown['cash'] ?? 0))}
                </p>
              </div>
              <div className="bg-white rounded-lg p-3 text-center shadow-sm">
                <p className="text-xs text-gray-500">โอน / การ์ด / อื่นๆ</p>
                <p className="text-xl font-bold text-purple-600">
                  ฿{baht(
                    Object.entries(sessionDetail.breakdown)
                      .filter(([k]) => k !== 'cash')
                      .reduce((s, [, v]) => s + v, 0)
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Payment method breakdown */}
          {sessionDetail && Object.keys(sessionDetail.breakdown).length > 0 && (
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <p className="text-xs font-medium text-gray-500 mb-2">แยกตามช่องทางชำระ</p>
              <div className="space-y-2">
                {Object.entries(sessionDetail.breakdown).map(([pm, amount]) => (
                  <div key={pm} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{PM_LABEL[pm] ?? pm}</span>
                    <span className="font-medium">฿{baht(amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Close session form */}
          <div className="border-t border-green-200 pt-4 space-y-3">
            <p className="text-sm font-medium text-gray-700">ปิดกะ</p>

            {/* Live difference preview */}
            {sessionDetail && closeBalance !== '' && !isNaN(parseFloat(closeBalance)) && (
              (() => {
                const expectedCash = sessionDetail.openingBalance + (sessionDetail.breakdown['cash'] ?? 0);
                const inputAmt     = parseFloat(closeBalance);
                const diff         = inputAmt - expectedCash;
                const ok           = Math.abs(diff) < 1;
                return (
                  <div className={`rounded-lg px-4 py-3 text-sm flex items-center justify-between ${ok ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                    <span>ระบบคำนวณเงินสดในกล่อง: <strong>฿{baht(expectedCash)}</strong></span>
                    <span className={`font-bold ml-4 ${ok ? 'text-green-700' : diff < 0 ? 'text-red-600' : 'text-yellow-700'}`}>
                      ส่วนต่าง: {diff >= 0 ? '+' : ''}{baht(diff)} {ok ? '✅' : diff < 0 ? '❌ ขาด' : '⚠️ เกิน'}
                    </span>
                  </div>
                );
              })()
            )}

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">ยอดเงินที่นับได้จริง (฿)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={closeBalance}
                  onChange={(e) => setCloseBalance(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="0.00"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">หมายเหตุ (ถ้ามี)</label>
                <input
                  type="text"
                  value={closeNote}
                  onChange={(e) => setCloseNote(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="เช่น ธนบัตร ฿500 x 10"
                />
              </div>
            </div>
            <button
              onClick={handleClose}
              disabled={submitting || !closeBalance}
              className="w-full bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-medium py-2 rounded-lg text-sm transition"
            >
              {submitting ? 'กำลังปิดกะ...' : '🔒 ปิดกะ'}
            </button>
          </div>
        </div>
      ) : (
        /* ── Open session form ───────────────────────────────────────────── */
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
              ⚪ ยังไม่มีกะที่เปิดอยู่
            </span>
          </div>
          <p className="text-sm text-gray-600">
            เปิดกะแคชเชียร์เพื่อเริ่มรับชำระเงิน — การรับเงินสดทุกรายการต้องมีกะที่เปิดอยู่
          </p>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">ยอดเงินเปิดกล่อง (฿)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={openBalance}
                onChange={(e) => setOpenBalance(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="0.00"
              />
            </div>
            <button
              onClick={handleOpen}
              disabled={submitting || !openBalance}
              className="bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-medium px-6 py-2 rounded-lg text-sm transition"
            >
              {submitting ? 'กำลังเปิดกะ...' : '🔓 เปิดกะ'}
            </button>
          </div>
        </div>
      )}

      {/* ── Session history ──────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">ประวัติกะ (10 รายการล่าสุด)</h2>
        </div>

        {history.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">ยังไม่มีประวัติกะ</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">เวลาเปิด</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">เวลาปิด</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">เปิดโดย</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">ยอดเปิด</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">ยอดปิด</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">ระบบคำนวณ</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">รายการ</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((s) => {
                  const diff = s.closingBalance != null && s.systemCalculatedCash != null
                    ? Number(s.closingBalance) - Number(s.systemCalculatedCash)
                    : null;

                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700">
                        {fmtDate(s.openedAt)}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {s.closedAt
                          ? fmtDate(s.closedAt)
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{s.openedByName ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        ฿{fmtBaht(Number(s.openingBalance))}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {s.closingBalance != null
                          ? `฿${fmtBaht(Number(s.closingBalance))}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {s.systemCalculatedCash != null ? (
                          <span className={diff != null && Math.abs(diff) > 1 ? 'text-red-600 font-medium' : 'text-gray-700'}>
                            ฿{fmtBaht(Number(s.systemCalculatedCash))}
                            {diff != null && Math.abs(diff) > 1 && (
                              <span className="ml-1 text-xs">
                                ({diff > 0 ? '+' : ''}{fmtBaht(diff)})
                              </span>
                            )}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-600">{s._count.payments}</td>
                      <td className="px-4 py-3 text-center">
                        {s.status === 'OPEN' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                            🟢 เปิด
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                            ⚫ ปิด
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
