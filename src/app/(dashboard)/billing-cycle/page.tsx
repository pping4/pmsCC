'use client';

/**
 * /billing-cycle — Monthly Billing Cycle Dashboard
 *
 * Tabs:
 *  1. Generate Invoices — trigger monthly billing, see results
 *  2. Late Penalties    — preview + apply penalties for overdue invoices
 *  3. Contract Renewal  — extend a booking's contract
 */

import { useState, useEffect, useCallback } from 'react';
import { fmtDate, fmtBaht } from '@/lib/date-format';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GenerateResult {
  status:        'created' | 'skipped' | 'error';
  bookingId:     string;
  roomNumber:    string;
  invoiceNumber?: string;
  amount?:       number;
  reason?:       string;
}

interface GenerateSummary {
  created: number;
  skipped: number;
  errors:  number;
  results: GenerateResult[];
}

interface PenaltyPreview {
  invoiceId:       string;
  invoiceNumber:   string;
  guestName:       string;
  roomNumber:      string;
  daysOverdue:     number;
  originalAmount:  number;
  penaltyAmount:   number;
  alreadyPenalised: boolean;
}

interface PenaltyData {
  dailyRate:     number;
  totalInvoices: number;
  totalPenalty:  number;
  penalties:     PenaltyPreview[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function baht(n: number): string {
  return fmtBaht(n);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BillingCyclePage() {
  const [tab, setTab] = useState<'generate' | 'penalties' | 'renewal'>('generate');

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold text-gray-800">📋 รอบบิลรายเดือน</h1>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {([
          { key: 'generate',  label: '🗓️ ออกบิล' },
          { key: 'penalties', label: '⚠️ ค่าปรับ' },
          { key: 'renewal',   label: '📝 ต่อสัญญา' },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.key
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'generate'  && <GenerateTab />}
      {tab === 'penalties' && <PenaltiesTab />}
      {tab === 'renewal'   && <RenewalTab />}
    </div>
  );
}

// ─── Tab 1: Generate Monthly Invoices ─────────────────────────────────────────

function GenerateTab() {
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState<GenerateSummary | null>(null);
  const [error,    setError]    = useState('');
  const [date,     setDate]     = useState(new Date().toISOString().split('T')[0]);

  const handleGenerate = async () => {
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const res  = await fetch('/api/billing/generate-monthly', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ billingDate: date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'เกิดข้อผิดพลาด');
      setResult(data as GenerateSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Control panel */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">ออกบิลรายเดือนสำหรับผู้เช่าทุกห้อง</h2>
        <p className="text-xs text-gray-500">
          ระบบจะออกบิลให้ผู้เช่ารายเดือนทุกรายที่ check-in อยู่ โดยใช้วันที่ออกบิลเป็นฐาน
          การรันซ้ำจะไม่สร้างบิลซ้ำ (idempotent)
        </p>

        <div className="flex gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">วันที่ออกบิล</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium px-6 py-2 rounded-lg text-sm transition"
          >
            {loading ? 'กำลังออกบิล...' : '🗓️ ออกบิลรายเดือน'}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <p className="text-xs text-green-600">สร้างบิลใหม่</p>
              <p className="text-3xl font-bold text-green-700">{result.created}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
              <p className="text-xs text-gray-500">ข้ามแล้ว</p>
              <p className="text-3xl font-bold text-gray-600">{result.skipped}</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
              <p className="text-xs text-red-500">ข้อผิดพลาด</p>
              <p className="text-3xl font-bold text-red-600">{result.errors}</p>
            </div>
          </div>

          {/* Detail table */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">ห้อง</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">เลขที่บิล</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">จำนวนเงิน</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">สถานะ</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.results.map((r) => (
                  <tr key={r.bookingId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-700">{r.roomNumber}</td>
                    <td className="px-4 py-3 text-gray-600">{r.invoiceNumber ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {r.amount != null ? `฿${baht(r.amount)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.status === 'created' ? (
                        <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">✅ สร้างแล้ว</span>
                      ) : r.status === 'skipped' ? (
                        <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">⏭️ ข้าม</span>
                      ) : (
                        <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">❌ Error</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{r.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab 2: Late Penalties ────────────────────────────────────────────────────

function PenaltiesTab() {
  const [data,       setData]       = useState<PenaltyData | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [applying,   setApplying]   = useState(false);
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [rateInput,  setRateInput]  = useState('1.5');     // % per month
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState('');

  const dailyRate = parseFloat(rateInput) / 100 / 30;

  const fetchPreviews = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const res  = await fetch(`/api/billing/penalties?dailyRate=${dailyRate}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'โหลดข้อมูลล้มเหลว');
      setData(json as PenaltyData);
      setSelected(new Set()); // reset selection
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }, [dailyRate]);

  useEffect(() => { fetchPreviews(); }, [fetchPreviews]);

  const toggleAll = () => {
    if (!data) return;
    if (selected.size === data.penalties.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.penalties.map((p) => p.invoiceId)));
    }
  };

  const handleApply = async () => {
    if (selected.size === 0) return;
    setError('');
    setSuccess('');
    setApplying(true);
    try {
      const res  = await fetch('/api/billing/penalties', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          invoiceIds: Array.from(selected),
          dailyRate,
          penaltyNote: `ค่าปรับ — อัตรา ${rateInput}% ต่อเดือน`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'เกิดข้อผิดพลาด');
      setSuccess(`✅ บันทึกค่าปรับ ${json.applied} รายการเรียบร้อย`);
      fetchPreviews();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setApplying(false);
    }
  };

  const totalSelected = data?.penalties
    .filter((p) => selected.has(p.invoiceId))
    .reduce((s, p) => s + p.penaltyAmount, 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">ค่าปรับสำหรับใบแจ้งหนี้เกินกำหนด</h2>
        <div className="flex gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">อัตราค่าปรับ (% ต่อเดือน)</label>
            <input
              type="number"
              value={rateInput}
              onChange={(e) => setRateInput(e.target.value)}
              min="0"
              max="100"
              step="0.1"
              className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <button
            onClick={fetchPreviews}
            disabled={loading}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium px-4 py-2 rounded-lg text-sm transition"
          >
            {loading ? 'กำลังโหลด...' : '🔄 คำนวณใหม่'}
          </button>
          {selected.size > 0 && (
            <button
              onClick={handleApply}
              disabled={applying}
              className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-sm transition"
            >
              {applying ? 'กำลังบันทึก...' : `⚠️ บันทึกค่าปรับ ${selected.size} รายการ (฿${baht(totalSelected)})`}
            </button>
          )}
        </div>

        {error   && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">{error}</div>}
        {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded-lg text-sm">{success}</div>}
      </div>

      {/* Summary */}
      {data && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-center">
            <p className="text-xs text-orange-600">ใบแจ้งหนี้เกินกำหนด</p>
            <p className="text-3xl font-bold text-orange-700">{data.totalInvoices}</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
            <p className="text-xs text-red-500">ค่าปรับรวม</p>
            <p className="text-2xl font-bold text-red-700">฿{baht(data.totalPenalty)}</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
            <p className="text-xs text-blue-600">เลือกแล้ว</p>
            <p className="text-2xl font-bold text-blue-700">{selected.size} รายการ</p>
          </div>
        </div>
      )}

      {/* Table */}
      {data && data.penalties.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-center w-10">
                  <input
                    type="checkbox"
                    checked={selected.size === data.penalties.length}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">ห้อง</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">ผู้เช่า</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">เลขที่บิล</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">เกิน (วัน)</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">ยอดต้น</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">ค่าปรับ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.penalties.map((p) => (
                <tr
                  key={p.invoiceId}
                  className={`hover:bg-gray-50 cursor-pointer ${selected.has(p.invoiceId) ? 'bg-amber-50' : ''}`}
                  onClick={() => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      next.has(p.invoiceId) ? next.delete(p.invoiceId) : next.add(p.invoiceId);
                      return next;
                    });
                  }}
                >
                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(p.invoiceId)}
                      onChange={() => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          next.has(p.invoiceId) ? next.delete(p.invoiceId) : next.add(p.invoiceId);
                          return next;
                        });
                      }}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-700">{p.roomNumber}</td>
                  <td className="px-4 py-3 text-gray-600">{p.guestName}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{p.invoiceNumber}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-bold ${p.daysOverdue > 30 ? 'text-red-600' : 'text-amber-600'}`}>
                      {p.daysOverdue}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">฿{baht(p.originalAmount)}</td>
                  <td className="px-4 py-3 text-right font-medium text-red-600">฿{baht(p.penaltyAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.penalties.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center text-green-700">
          <p className="text-2xl mb-2">🎉</p>
          <p className="font-medium">ไม่มีใบแจ้งหนี้เกินกำหนดชำระในขณะนี้</p>
        </div>
      )}
    </div>
  );
}

// ─── Tab 3: Contract Renewal ──────────────────────────────────────────────────

interface ActiveBooking {
  id:          string;
  bookingNumber: string;
  guestName:   string;
  roomNumber:  string;
  checkOut:    string;
  rate:        number;
  bookingType: string;
}

function RenewalTab() {
  const [bookings,  setBookings]  = useState<ActiveBooking[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [selected,  setSelected]  = useState<ActiveBooking | null>(null);
  const [newDate,   setNewDate]   = useState('');
  const [newRate,   setNewRate]   = useState('');
  const [notes,     setNotes]     = useState('');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');

  // Fetch active monthly bookings
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res  = await fetch('/api/bookings?status=checked_in&bookingType=monthly_short,monthly_long&limit=100');
        const data = await res.json();
        const bks: ActiveBooking[] = (data.bookings ?? data ?? []).map((b: {
          id: string;
          bookingNumber: string;
          guest: { firstName: string; lastName: string };
          room: { number: string };
          checkOut: string;
          rate: number;
          bookingType: string;
        }) => ({
          id:           b.id,
          bookingNumber: b.bookingNumber,
          guestName:    `${b.guest.firstName} ${b.guest.lastName}`,
          roomNumber:   b.room.number,
          checkOut:     b.checkOut,
          rate:         Number(b.rate),
          bookingType:  b.bookingType,
        })).filter((b: ActiveBooking) => b.bookingType !== 'daily');
        setBookings(bks);
      } catch {
        setError('โหลดข้อมูลการจองล้มเหลว');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSelect = (bk: ActiveBooking) => {
    setSelected(bk);
    setNewDate('');
    setNewRate(String(bk.rate));
    setNotes('');
    setError('');
    setSuccess('');
  };

  const handleRenew = async () => {
    if (!selected || !newDate) return;
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const res  = await fetch(`/api/bookings/${selected.id}/renew`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          newCheckOut: newDate,
          newRate:     newRate ? parseFloat(newRate) : undefined,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'เกิดข้อผิดพลาด');
      setSuccess(`✅ ต่อสัญญาห้อง ${selected.roomNumber} สำเร็จ — สิ้นสุดใหม่: ${fmtDate(data.newCheckOut)}`);
      setSelected(null);
      // Refresh list
      const refresh = await fetch('/api/bookings?status=checked_in&bookingType=monthly_short,monthly_long&limit=100');
      const freshData = await refresh.json();
      setBookings((freshData.bookings ?? freshData ?? []).map((b: {
        id: string;
        bookingNumber: string;
        guest: { firstName: string; lastName: string };
        room: { number: string };
        checkOut: string;
        rate: number;
        bookingType: string;
      }) => ({
        id:           b.id,
        bookingNumber: b.bookingNumber,
        guestName:    `${b.guest.firstName} ${b.guest.lastName}`,
        roomNumber:   b.room.number,
        checkOut:     b.checkOut,
        rate:         Number(b.rate),
        bookingType:  b.bookingType,
      })).filter((b: ActiveBooking) => b.bookingType !== 'daily'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center text-gray-400 py-12">กำลังโหลด...</div>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Booking list */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">เลือกการจองที่ต้องการต่อสัญญา</h2>

        {error && !selected && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">{error}</div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{success}</div>
        )}

        {bookings.length === 0 ? (
          <div className="text-center text-gray-400 py-8 bg-white border rounded-xl">
            ไม่มีผู้เช่ารายเดือนที่ active อยู่
          </div>
        ) : (
          <div className="space-y-2">
            {bookings.map((bk) => {
              const daysLeft = Math.ceil(
                (new Date(bk.checkOut).getTime() - Date.now()) / 86_400_000
              );
              return (
                <div
                  key={bk.id}
                  onClick={() => handleSelect(bk)}
                  className={`cursor-pointer bg-white border-2 rounded-xl p-4 hover:border-blue-300 transition-all ${
                    selected?.id === bk.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold text-gray-800">ห้อง {bk.roomNumber}</p>
                      <p className="text-sm text-gray-500">{bk.guestName}</p>
                      <p className="text-xs text-gray-400">{bk.bookingType === 'monthly_long' ? 'รายเดือน (ยาว)' : 'รายเดือน (สั้น)'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">สิ้นสุดสัญญา</p>
                      <p className="text-sm font-medium text-gray-700">
                        {fmtDate(bk.checkOut)}
                      </p>
                      <p className={`text-xs font-medium ${daysLeft <= 30 ? 'text-red-500' : daysLeft <= 60 ? 'text-amber-500' : 'text-green-600'}`}>
                        {daysLeft > 0 ? `อีก ${daysLeft} วัน` : `เกินมา ${Math.abs(daysLeft)} วัน`}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-gray-500">
                    ค่าเช่า ฿{fmtBaht(bk.rate, 0)}/เดือน
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Renewal form */}
      {selected ? (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 self-start">
          <h2 className="text-sm font-semibold text-gray-700">ต่อสัญญา — ห้อง {selected.roomNumber}</h2>
          <p className="text-xs text-gray-500">ผู้เช่า: {selected.guestName}</p>
          <p className="text-xs text-gray-500">
            สัญญาปัจจุบันสิ้นสุด: {fmtDate(selected.checkOut)}
          </p>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">วันสิ้นสุดสัญญาใหม่ <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={newDate}
              min={selected.checkOut.split('T')[0]}
              onChange={(e) => setNewDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">ค่าเช่าใหม่ (฿/เดือน) — เว้นว่างถ้าคงเดิม</label>
            <input
              type="number"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              min="0"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">หมายเหตุ</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
              placeholder="เช่น ต่อสัญญา 6 เดือน, ปรับราคาตามตลาด"
            />
          </div>

          {error && selected && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">{error}</div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleRenew}
              disabled={saving || !newDate}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg text-sm transition"
            >
              {saving ? 'กำลังบันทึก...' : '✅ ต่อสัญญา'}
            </button>
            <button
              onClick={() => setSelected(null)}
              className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-8 flex items-center justify-center text-gray-400 text-sm self-start">
          เลือกการจองจากรายการทางซ้ายเพื่อต่อสัญญา
        </div>
      )}
    </div>
  );
}
