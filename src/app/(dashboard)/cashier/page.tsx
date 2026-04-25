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

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { fmtDateTime, fmtBaht, toDateStr } from '@/lib/date-format';
import { useToast } from '@/components/ui';
import { DataTable, type ColDef } from '@/components/data-table';
import { useEffectivePermissions, can } from '@/lib/rbac/client';
import { HandoverDialog } from './components/HandoverDialog';
import { CloseShiftDialog } from './components/CloseShiftDialog';
import { BatchCloseTab } from './components/BatchCloseTab';

type TabKey = 'shift' | 'batch';

// Build the /finance deep-link for a single cash session.
// `to` is clamped to now when the session is still OPEN.
function ledgerLinkFor(session: { id: string; openedAt: string; closedAt: string | null }): string {
  const from = toDateStr(new Date(session.openedAt));
  const to   = toDateStr(new Date(session.closedAt ?? Date.now()));
  return `/finance?period=custom&from=${from}&to=${to}&sessionId=${session.id}`;
}

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
  cashBoxId?:     string | null;
  cashBoxCode?:   string | null;
  cashBoxName?:   string | null;
}

interface AvailableBox {
  id:           string;
  code:         string;
  name:         string;
  location:     string | null;
  displayOrder: number;
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
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: authSession } = useSession();
  // Session user identity is used by the server — we don't send it from the
  // client anymore (Sprint 4B: server-resolved). Kept here only for display.
  void authSession;

  // ── Tab state — synced to ?tab=batch in the URL so the legacy
  //    /cashier/batch-close route can redirect here without losing intent.
  const initialTab: TabKey = searchParams.get('tab') === 'batch' ? 'batch' : 'shift';
  const [tab, setTab] = useState<TabKey>(initialTab);
  const switchTab = useCallback((next: TabKey) => {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'shift') params.delete('tab');
    else                  params.set('tab', next);
    const qs = params.toString();
    router.replace(`/cashier${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [router, searchParams]);

  // Permission gate for the batch-close tab. The /cashier route itself is
  // gated by `cashier.open_shift | record_payment | view_other_shifts`, so
  // a user who arrived here may not have batch-close rights — hide the tab.
  const { data: tabPerms } = useEffectivePermissions();
  const canBatchClose = can(tabPerms, 'cashier.close_shift');

  const [currentSession, setCurrentSession]       = useState<CashSession | null>(null);
  const [sessionDetail,  setSessionDetail]        = useState<SessionSummary | null>(null);
  const [history,        setHistory]              = useState<SessionHistoryItem[]>([]);
  const [loading,        setLoading]              = useState(true);

  // State-1: counter picker
  const [availableBoxes, setAvailableBoxes] = useState<AvailableBox[]>([]);
  const [selectedBoxId,  setSelectedBoxId]  = useState<string>('');

  // Forms
  const [openBalance,  setOpenBalance]  = useState('');
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState('');

  // Dialogs
  const [showHandover, setShowHandover] = useState(false);
  const [showClose,    setShowClose]    = useState(false);

  // Permissions (client-side affordance only; server re-checks)
  const { data: perms } = useEffectivePermissions();
  const canHandover = can(perms, 'cashier.handover');
  const canClose    = can(perms, 'cashier.close_shift');

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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCurrentSession(data.session ?? null);

      if (data.session) {
        const detRes  = await fetch(`/api/cash-sessions/${data.session.id}`);
        const detData = await detRes.json();
        setSessionDetail(detData.session ?? null);
      } else {
        setSessionDetail(null);
      }
    } catch (e) {
      setError('โหลดข้อมูลกะล้มเหลว');
      toast.error('โหลดข้อมูลกะไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    }
  }, [toast]);

  // ── Fetch available counters (state-1 picker) ─────────────────────────────
  const fetchAvailableBoxes = useCallback(async () => {
    try {
      const res = await fetch('/api/cash-boxes/available');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const boxes: AvailableBox[] = data.boxes ?? [];
      setAvailableBoxes(boxes);
      // Auto-select the first counter so the form is always usable.
      setSelectedBoxId((prev) => (prev && boxes.some((b) => b.id === prev) ? prev : boxes[0]?.id ?? ''));
    } catch (e) {
      toast.error('โหลดรายการเคาน์เตอร์ไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    }
  }, [toast]);

  const fetchHistory = useCallback(async () => {
    try {
      const res  = await fetch('/api/cash-sessions?limit=10');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHistory(data.sessions ?? []);
    } catch (e) {
      toast.error('โหลดประวัติกะไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    }
  }, [toast]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchCurrentSession();
      await Promise.all([fetchHistory(), fetchAvailableBoxes()]);
      setLoading(false);
    })();
  }, [fetchCurrentSession, fetchHistory, fetchAvailableBoxes]);

  // ── Open session (counter-centric) ─────────────────────────────────────────
  const handleOpen = async () => {
    if (submitting) return;
    setError('');
    if (!selectedBoxId) {
      setError('กรุณาเลือกเคาน์เตอร์ก่อน');
      toast.warning('กรุณาเลือกเคาน์เตอร์ก่อน');
      return;
    }
    const amount = parseFloat(openBalance);
    if (isNaN(amount) || amount < 0) {
      setError('กรุณาระบุยอดเงินเปิดกล่องที่ถูกต้อง');
      toast.warning('กรุณาระบุยอดเงินเปิดกล่องที่ถูกต้อง');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/cash-sessions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        // Sprint 4B: server resolves user identity from the session cookie.
        body: JSON.stringify({
          cashBoxId:      selectedBoxId,
          openingBalance: amount,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setOpenBalance('');
      await fetchCurrentSession();
      await Promise.all([fetchHistory(), fetchAvailableBoxes()]);
      toast.success('เปิดกะสำเร็จ');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('เปิดกะไม่สำเร็จ', msg);
      // If another cashier grabbed this counter first, refresh the list.
      await fetchAvailableBoxes();
    } finally {
      setSubmitting(false);
    }
  };

  // ── After close dialog success ─────────────────────────────────────────────
  const handleCloseSuccess = async (result: { systemCalculatedCash: number; difference: number; closingBalance: number }) => {
    setCloseResult(result);
    setShowClose(false);
    await fetchCurrentSession();
    await Promise.all([fetchHistory(), fetchAvailableBoxes()]);
  };

  // ── After handover success — incoming user now owns the shift, so the
  //    caller's "current session" is gone. Refresh everything. ──────────────
  const handleHandoverSuccess = async () => {
    setShowHandover(false);
    await fetchCurrentSession();
    await Promise.all([fetchHistory(), fetchAvailableBoxes()]);
  };

  // ─── DataTable columns (session history) — declared BEFORE any conditional
  //      early return so hook order stays stable across renders. ──────────────
  type HistColKey = 'openedAt' | 'closedAt' | 'openedBy' | 'opening' | 'closing' | 'systemCalc' | 'count' | 'status' | 'actions';
  const histColumns: ColDef<SessionHistoryItem, HistColKey>[] = useMemo(() => [
    {
      key: 'openedAt', label: 'เวลาเปิด', minW: 150,
      getValue: s => s.openedAt,
      getLabel: s => fmtDate(s.openedAt),
      render:   s => <span style={{ color: '#374151' }}>{fmtDate(s.openedAt)}</span>,
    },
    {
      key: 'closedAt', label: 'เวลาปิด', minW: 150,
      getValue: s => s.closedAt ?? '',
      getLabel: s => s.closedAt ? fmtDate(s.closedAt) : '—',
      render:   s => <span style={{ color: '#6b7280' }}>{s.closedAt ? fmtDate(s.closedAt) : '—'}</span>,
    },
    {
      key: 'openedBy', label: 'เปิดโดย', minW: 120,
      getValue: s => s.openedByName ?? '—',
      render:   s => <span style={{ color: '#374151' }}>{s.openedByName ?? '—'}</span>,
    },
    {
      key: 'opening', label: 'ยอดเปิด', align: 'right', minW: 110,
      getValue: s => String(Math.round(Number(s.openingBalance) * 100)).padStart(12, '0'),
      getLabel: s => `฿${fmtBaht(Number(s.openingBalance))}`,
      aggregate: 'sum',
      aggValue:  s => Number(s.openingBalance),
      render:    s => <span style={{ color: '#374151', fontFamily: 'monospace' }}>฿{fmtBaht(Number(s.openingBalance))}</span>,
    },
    {
      key: 'closing', label: 'ยอดปิด', align: 'right', minW: 110,
      getValue: s => s.closingBalance != null ? String(Math.round(Number(s.closingBalance) * 100)).padStart(12, '0') : '',
      getLabel: s => s.closingBalance != null ? `฿${fmtBaht(Number(s.closingBalance))}` : '—',
      aggregate: 'sum',
      aggValue:  s => Number(s.closingBalance ?? 0),
      render:    s => s.closingBalance != null
        ? <span style={{ color: '#374151', fontFamily: 'monospace' }}>฿{fmtBaht(Number(s.closingBalance))}</span>
        : <span style={{ color: '#9ca3af' }}>—</span>,
    },
    {
      key: 'systemCalc', label: 'ระบบคำนวณ', align: 'right', minW: 150,
      getValue: s => s.systemCalculatedCash != null ? String(Math.round(Number(s.systemCalculatedCash) * 100)).padStart(12, '0') : '',
      getLabel: s => s.systemCalculatedCash != null ? `฿${fmtBaht(Number(s.systemCalculatedCash))}` : '—',
      render:   s => {
        if (s.systemCalculatedCash == null) return <span style={{ color: '#9ca3af' }}>—</span>;
        const diff = s.closingBalance != null ? Number(s.closingBalance) - Number(s.systemCalculatedCash) : null;
        const mismatch = diff != null && Math.abs(diff) > 1;
        return (
          <span style={{ color: mismatch ? '#dc2626' : '#374151', fontWeight: mismatch ? 600 : 400, fontFamily: 'monospace' }}>
            ฿{fmtBaht(Number(s.systemCalculatedCash))}
            {mismatch && (
              <span style={{ marginLeft: 4, fontSize: 11 }}>
                ({diff! > 0 ? '+' : ''}{fmtBaht(diff!)})
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'count', label: 'รายการ', align: 'center', minW: 80,
      getValue: s => String(s._count.payments).padStart(6, '0'),
      getLabel: s => String(s._count.payments),
      aggregate: 'sum',
      aggValue:  s => s._count.payments,
      render:    s => <span style={{ color: '#6b7280' }}>{s._count.payments}</span>,
    },
    {
      key: 'status', label: 'สถานะ', align: 'center', minW: 90,
      getValue: s => s.status,
      render:   s => s.status === 'OPEN'
        ? <span style={{ display: 'inline-flex', gap: 4, fontSize: 11, fontWeight: 500, color: '#15803d', background: '#dcfce7', padding: '2px 10px', borderRadius: 999 }}>🟢 เปิด</span>
        : <span style={{ display: 'inline-flex', gap: 4, fontSize: 11, fontWeight: 500, color: '#6b7280', background: '#f3f4f6', padding: '2px 10px', borderRadius: 999 }}>⚫ ปิด</span>,
    },
    {
      key: 'actions', label: '', align: 'center', minW: 120,
      getValue: () => '',
      render: s => (
        <Link
          href={ledgerLinkFor(s)}
          style={{
            display: 'inline-block', padding: '2px 10px', borderRadius: 4,
            fontSize: 11, color: '#2563eb', textDecoration: 'underline',
          }}
        >
          ดู ledger
        </Link>
      ),
    },
  ], []);

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

      {/* ── Tabs: เปิด/ปิดกะ vs ส่งยอด EDC ────────────────────────────────── */}
      <nav role="tablist" className="flex gap-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
        <button
          role="tab"
          aria-selected={tab === 'shift'}
          onClick={() => switchTab('shift')}
          className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 transition ${
            tab === 'shift'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          🏧 กะแคชเชียร์
        </button>
        {canBatchClose && (
          <button
            role="tab"
            aria-selected={tab === 'batch'}
            onClick={() => switchTab('batch')}
            className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 transition ${
              tab === 'batch'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            💳 ส่งยอด EDC / ปิด batch
          </button>
        )}
      </nav>

      {tab === 'batch' ? (
        <BatchCloseTab />
      ) : (
      <>

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
                {currentSession.cashBoxCode && (
                  <span className="ml-2 text-xs font-semibold text-green-800">
                    🏪 {currentSession.cashBoxCode}
                    {currentSession.cashBoxName ? ` — ${currentSession.cashBoxName}` : ''}
                  </span>
                )}
              </span>
              <p className="text-xs text-gray-500 mt-1">
                เปิดเมื่อ {fmtDate(currentSession.openedAt)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">ยอดเปิดกล่อง</p>
              <p className="text-lg font-bold text-gray-800">฿{baht(currentSession.openingBalance)}</p>
              <Link
                href={ledgerLinkFor({
                  id:       currentSession.id,
                  openedAt: currentSession.openedAt,
                  closedAt: null,
                })}
                style={{
                  display: 'inline-block', marginTop: 6,
                  fontSize: 11, color: '#2563eb', textDecoration: 'underline',
                }}
              >
                ดูรายการเดินบัญชีกะนี้ →
              </Link>
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

          {/* Action bar — Handover / Close */}
          <div className="border-t border-green-200 pt-4 flex flex-wrap gap-2">
            {canHandover && (
              <button
                onClick={() => setShowHandover(true)}
                className="flex-1 min-w-[180px] bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 rounded-lg text-sm transition"
              >
                🔄 ส่งกะให้คนถัดไป
              </button>
            )}
            <button
              onClick={() => setShowClose(true)}
              disabled={!canClose}
              title={!canClose ? 'ไม่มีสิทธิ์ปิดกะ' : undefined}
              className="flex-1 min-w-[180px] bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 rounded-lg text-sm transition"
            >
              🔒 ปิดกะ
            </button>
          </div>
        </div>
      ) : (
        /* ── State 1: Counter picker ─────────────────────────────────────── */
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
              ⚪ ยังไม่มีกะที่เปิดอยู่
            </span>
          </div>
          <p className="text-sm text-gray-600">
            เลือกเคาน์เตอร์ที่ต้องการเปิดกะ — หนึ่งเคาน์เตอร์ต่อหนึ่งผู้ใช้ต่อหนึ่งกะที่เปิดอยู่ในเวลาเดียวกัน
          </p>

          {availableBoxes.length === 0 ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
              🚫 ไม่มีเคาน์เตอร์ว่าง — เคาน์เตอร์ทุกตัวมีกะเปิดอยู่แล้ว
              <br />
              <span className="text-xs">
                หากต้องการรับช่วงต่อจากคนก่อนหน้า กรุณาประสานงานให้ใช้ฟังก์ชัน &quot;ส่งกะ (handover)&quot;
              </span>
            </div>
          ) : (
            <>
              <div>
                <label className="text-xs text-gray-500 mb-2 block">เลือกเคาน์เตอร์ ({availableBoxes.length} ตัวว่าง)</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {availableBoxes.map((box) => {
                    const selected = selectedBoxId === box.id;
                    return (
                      <button
                        key={box.id}
                        type="button"
                        onClick={() => setSelectedBoxId(box.id)}
                        className={`text-left border rounded-lg p-3 transition ${
                          selected
                            ? 'border-green-500 bg-green-50 ring-2 ring-green-200'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-lg">🏪</span>
                          <span className="font-semibold text-gray-800">{box.code}</span>
                          {selected && <span className="ml-auto text-green-600 text-xs">✓ เลือก</span>}
                        </div>
                        <p className="text-sm text-gray-700 mt-1">{box.name}</p>
                        {box.location && (
                          <p className="text-xs text-gray-500 mt-0.5">📍 {box.location}</p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

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
                  disabled={submitting || !openBalance || !selectedBoxId}
                  className="bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-medium px-6 py-2 rounded-lg text-sm transition"
                >
                  {submitting ? 'กำลังเปิดกะ...' : '🔓 เปิดกะ'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Session history ──────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">ประวัติกะ (10 รายการล่าสุด)</h2>
        </div>

        <DataTable<SessionHistoryItem, HistColKey>
          tableKey="cashier.history"
          syncUrl
          exportFilename="pms_cashier_history"
          exportSheetName="ประวัติกะ"
          rows={history}
          columns={histColumns}
          rowKey={s => s.id}
          defaultSort={{ col: 'openedAt', dir: 'desc' }}
          dateRange={{
            col: 'openedAt',
            getDate: s => s.openedAt ? new Date(s.openedAt) : null,
            label: 'วันที่เปิดกะ',
          }}
          groupByCols={['status', 'openedBy']}
          emptyText="ยังไม่มีประวัติกะ"
          summaryLabel={(f, t) => <>🏦 {f}{f !== t ? `/${t}` : ''} กะ</>}
        />
      </div>

      </>
      )}

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}
      {currentSession && sessionDetail && tab === 'shift' && (
        <>
          <CloseShiftDialog
            open={showClose}
            onClose={() => setShowClose(false)}
            onSuccess={handleCloseSuccess}
            ctx={{
              sessionId:    currentSession.id,
              cashBoxCode:  currentSession.cashBoxCode ?? null,
              expectedCash: sessionDetail.openingBalance + (sessionDetail.breakdown['cash'] ?? 0),
            }}
          />
          <HandoverDialog
            open={showHandover}
            onClose={() => setShowHandover(false)}
            onSuccess={handleHandoverSuccess}
            ctx={{
              sessionId:    currentSession.id,
              cashBoxCode:  currentSession.cashBoxCode ?? null,
              expectedCash: sessionDetail.openingBalance + (sessionDetail.breakdown['cash'] ?? 0),
            }}
          />
        </>
      )}
    </div>
  );
}
