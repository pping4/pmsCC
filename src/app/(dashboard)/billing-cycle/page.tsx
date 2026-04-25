'use client';

/**
 * /billing-cycle — Monthly Billing Cycle Dashboard
 *
 * Tabs:
 *  1. Generate Invoices — trigger monthly billing, see results
 *  2. Late Penalties    — preview + apply penalties for overdue invoices
 *  3. Contract Renewal  — extend a booking's contract
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { fmtDate, fmtBaht } from '@/lib/date-format';
import { useToast } from '@/components/ui';
import { DataTable, type ColDef } from '@/components/data-table';

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
  const toast = useToast();
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState<GenerateSummary | null>(null);
  const [error,    setError]    = useState('');
  const [date,     setDate]     = useState(new Date().toISOString().split('T')[0]);

  // DataTable columns for generate results
  type GenColKey = 'roomNumber' | 'invoiceNumber' | 'amount' | 'status' | 'reason';
  const genColumns: ColDef<GenerateResult, GenColKey>[] = useMemo(() => [
    {
      key: 'roomNumber', label: 'ห้อง', minW: 80,
      getValue: r => r.roomNumber,
      render:   r => <span className="font-medium text-gray-700">{r.roomNumber}</span>,
    },
    {
      key: 'invoiceNumber', label: 'เลขที่บิล', minW: 160,
      getValue: r => r.invoiceNumber ?? '—',
      render:   r => <span className="text-gray-600">{r.invoiceNumber ?? '—'}</span>,
    },
    {
      key: 'amount', label: 'จำนวนเงิน', align: 'right', minW: 110,
      getValue: r => r.amount != null ? String(Math.round(r.amount * 100)).padStart(14, '0') : '__none__',
      getLabel: r => r.amount != null ? `฿${fmtBaht(r.amount)}` : '—',
      aggregate: 'sum',
      aggValue:  r => r.amount ?? 0,
      render:    r => <span className="text-gray-700">{r.amount != null ? `฿${fmtBaht(r.amount)}` : '—'}</span>,
    },
    {
      key: 'status', label: 'สถานะ', align: 'center', minW: 110,
      getValue: r => r.status,
      getLabel: r => r.status === 'created' ? 'สร้างแล้ว' : r.status === 'skipped' ? 'ข้าม' : 'Error',
      render:   r => r.status === 'created'
        ? <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">✅ สร้างแล้ว</span>
        : r.status === 'skipped'
          ? <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">⏭️ ข้าม</span>
          : <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">❌ Error</span>,
    },
    {
      key: 'reason', label: 'หมายเหตุ', minW: 180,
      getValue: r => r.reason ?? '',
      render:   r => <span className="text-xs text-gray-400">{r.reason ?? ''}</span>,
    },
  ], []);

  const handleGenerate = async () => {
    if (loading) return;
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const res  = await fetch('/api/billing/generate-monthly', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ billingDate: date }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setResult(data as GenerateSummary);
      toast.success('ออกบิลรายเดือนสำเร็จ', `สร้าง ${data.created} / ข้าม ${data.skipped} / ผิดพลาด ${data.errors}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('ออกบิลรายเดือนไม่สำเร็จ', msg);
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
          <DataTable<GenerateResult, GenColKey>
            tableKey="billing-cycle.generate"
            rows={result.results}
            columns={genColumns}
            rowKey={r => r.bookingId}
            emptyText="ไม่มีรายการ"
          />
        </div>
      )}
    </div>
  );
}

// ─── Tab 2: Late Penalties ────────────────────────────────────────────────────

function PenaltiesTab() {
  const toast = useToast();
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
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setData(json as PenaltyData);
      setSelected(new Set()); // reset selection
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('โหลดค่าปรับไม่สำเร็จ', msg);
    } finally {
      setLoading(false);
    }
  }, [dailyRate, toast]);

  useEffect(() => { fetchPreviews(); }, [fetchPreviews]);

  // DataTable columns for penalty preview table
  type PenColKey = 'check' | 'roomNumber' | 'guestName' | 'invoiceNumber' | 'daysOverdue' | 'originalAmount' | 'penaltyAmount';
  const penColumns: ColDef<PenaltyPreview, PenColKey>[] = useMemo(() => [
    {
      key: 'check', label: '', minW: 36, align: 'center', noFilter: true,
      getValue: () => '',
      render: p => (
        <input
          type="checkbox"
          checked={selected.has(p.invoiceId)}
          onChange={() => setSelected(prev => {
            const next = new Set(prev);
            if (next.has(p.invoiceId)) next.delete(p.invoiceId); else next.add(p.invoiceId);
            return next;
          })}
          onClick={e => e.stopPropagation()}
          className="rounded"
        />
      ),
    },
    {
      key: 'roomNumber', label: 'ห้อง', minW: 80,
      getValue: p => p.roomNumber,
      render:   p => <span className="font-medium text-gray-700">{p.roomNumber}</span>,
    },
    {
      key: 'guestName', label: 'ผู้เช่า', minW: 140,
      getValue: p => p.guestName,
      render:   p => <span className="text-gray-600">{p.guestName}</span>,
    },
    {
      key: 'invoiceNumber', label: 'เลขที่บิล', minW: 150,
      getValue: p => p.invoiceNumber,
      render:   p => <span className="text-gray-500 text-xs">{p.invoiceNumber}</span>,
    },
    {
      key: 'daysOverdue', label: 'เกิน (วัน)', align: 'center', minW: 90,
      getValue: p => String(p.daysOverdue).padStart(5, '0'),
      getLabel: p => String(p.daysOverdue),
      render:   p => (
        <span className={`font-bold ${p.daysOverdue > 30 ? 'text-red-600' : 'text-amber-600'}`}>
          {p.daysOverdue}
        </span>
      ),
    },
    {
      key: 'originalAmount', label: 'ยอดต้น', align: 'right', minW: 110,
      getValue: p => String(Math.round(p.originalAmount * 100)).padStart(14, '0'),
      getLabel: p => `฿${fmtBaht(p.originalAmount)}`,
      aggregate: 'sum',
      aggValue:  p => p.originalAmount,
      render:    p => <span className="text-gray-700">฿{fmtBaht(p.originalAmount)}</span>,
    },
    {
      key: 'penaltyAmount', label: 'ค่าปรับ', align: 'right', minW: 110,
      getValue: p => String(Math.round(p.penaltyAmount * 100)).padStart(14, '0'),
      getLabel: p => `฿${fmtBaht(p.penaltyAmount)}`,
      aggregate: 'sum',
      aggValue:  p => p.penaltyAmount,
      render:    p => <span className="font-medium text-red-600">฿{fmtBaht(p.penaltyAmount)}</span>,
    },
  ], [selected]);

  const toggleAll = () => {
    if (!data) return;
    if (selected.size === data.penalties.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.penalties.map((p) => p.invoiceId)));
    }
  };

  const handleApply = async () => {
    if (applying) return;
    if (selected.size === 0) {
      toast.warning('กรุณาเลือกใบแจ้งหนี้อย่างน้อย 1 รายการ');
      return;
    }
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
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setSuccess(`✅ บันทึกค่าปรับ ${json.applied} รายการเรียบร้อย`);
      toast.success('บันทึกค่าปรับสำเร็จ', `${json.applied} รายการ`);
      fetchPreviews();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('บันทึกค่าปรับไม่สำเร็จ', msg);
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

      {/* Select-all bar */}
      {data && data.penalties.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={selected.size === data.penalties.length}
            onChange={toggleAll}
            className="rounded"
          />
          เลือกทั้งหมด ({data.penalties.length})
        </div>
      )}

      {/* Table */}
      {data && data.penalties.length > 0 && (
        <DataTable<PenaltyPreview, PenColKey>
          tableKey="billing-cycle.penalties"
          rows={data.penalties}
          columns={penColumns}
          rowKey={p => p.invoiceId}
          rowHighlight={p => selected.has(p.invoiceId) ? '#fffbeb' : undefined}
          onRowClick={p => setSelected(prev => {
            const next = new Set(prev);
            if (next.has(p.invoiceId)) next.delete(p.invoiceId); else next.add(p.invoiceId);
            return next;
          })}
          emptyText="ไม่มีใบเกินกำหนด"
        />
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
  const toast = useToast();
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
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
      } catch (e) {
        setError('โหลดข้อมูลการจองล้มเหลว');
        toast.error('โหลดข้อมูลการจองไม่สำเร็จ', e instanceof Error ? e.message : undefined);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (saving) return;
    if (!selected) return;
    if (!newDate) {
      toast.warning('กรุณาระบุวันสิ้นสุดสัญญาใหม่');
      return;
    }
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setSuccess(`✅ ต่อสัญญาห้อง ${selected.roomNumber} สำเร็จ — สิ้นสุดใหม่: ${fmtDate(data.newCheckOut)}`);
      toast.success('ต่อสัญญาสำเร็จ', `ห้อง ${selected.roomNumber} — สิ้นสุดใหม่ ${fmtDate(data.newCheckOut)}`);
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
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('ต่อสัญญาไม่สำเร็จ', msg);
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
