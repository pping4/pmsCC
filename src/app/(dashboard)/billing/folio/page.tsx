'use client';

/**
 * /billing/folio — Guest Folio Ledger Page
 *
 * หน้านี้ให้ staff ค้นหา booking และดู Folio Ledger แบบ real-time
 *
 * Features:
 *  - ค้นหา booking ด้วย booking number หรือชื่อลูกค้า
 *  - แสดง FolioLedger component แบบเต็ม
 *  - สถานะ Folio (เปิด/ปิด)
 *  - เพิ่ม charge เสริมได้ (extra service, penalty ฯลฯ)
 *  - Void invoice ผ่าน UI
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import FolioLedger from '@/components/folio/FolioLedger';
import { fmtDate } from '@/lib/date-format';
import { useToast, Dialog, Button } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BookingSummary {
  id: string;
  bookingNumber: string;
  status: string;
  checkIn: string;
  checkOut: string;
  bookingType: string;
  room: { number: string };
  guest: { firstName: string; lastName: string };
  folio: { id: string; folioNumber: string; balance: number } | null;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  confirmed:   { label: 'รอเช็คอิน', cls: 'bg-blue-100 text-blue-700'   },
  checked_in:  { label: 'เช็คอินแล้ว', cls: 'bg-green-100 text-green-700' },
  checked_out: { label: 'เช็คเอาท์แล้ว', cls: 'bg-gray-100 text-gray-600' },
  cancelled:   { label: 'ยกเลิก',      cls: 'bg-red-100 text-red-600'    },
};

const CHARGE_TYPES = [
  { value: 'ROOM',              label: '🏠 ค่าห้อง'        },
  { value: 'UTILITY_WATER',     label: '💧 ค่าน้ำ'         },
  { value: 'UTILITY_ELECTRIC',  label: '⚡ ค่าไฟ'          },
  { value: 'EXTRA_SERVICE',     label: '🛎 บริการเสริม'    },
  { value: 'PENALTY',           label: '⚠️ ค่าปรับ'        },
  { value: 'DISCOUNT',          label: '🏷️ ส่วนลด'        },
  { value: 'ADJUSTMENT',        label: '📝 ปรับรายการ'     },
  { value: 'OTHER',             label: '📋 อื่น ๆ'        },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FolioPage() {
  const toast = useToast();
  const searchParams = useSearchParams();
  // Sub-step 5.2/5.3 cross-link target — if /billing/folio?bookingId=xxx,
  // auto-select the booking on first load. The deep-link comes from the
  // tx-ledger and tax-invoice detail pages.
  const initialBookingId = searchParams.get('bookingId');
  const [search, setSearch] = useState('');
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(initialBookingId);
  const [loading, setLoading] = useState(false);
  const [folioKey, setFolioKey] = useState(0); // force FolioLedger to re-mount on refresh

  // Void invoice dialog
  const [voidTarget, setVoidTarget] = useState<{ invoiceId: string; invoiceNumber: string } | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [isVoiding, setIsVoiding] = useState(false);

  // Add charge form
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [chargeForm, setChargeForm] = useState({
    chargeType: 'EXTRA_SERVICE',
    description: '',
    amount: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const selectedBooking = bookings.find((b) => b.id === selectedBookingId) ?? null;

  // ── Search bookings ─────────────────────────────────────────────────────────
  const fetchBookings = useCallback(async () => {
    if (!search.trim()) return;
    setLoading(true);
    try {
      const q = encodeURIComponent(search.trim());
      const res = await fetch(`/api/bookings?search=${q}&status=all`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBookings(data);
    } catch (e) {
      setBookings([]);
      toast.error('ค้นหา booking ไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [search, toast]);

  useEffect(() => {
    if (search.length >= 2) {
      const t = setTimeout(fetchBookings, 400);
      return () => clearTimeout(t);
    }
  }, [search, fetchBookings]);

  // Sub-step 5.2/5.3 — when arriving via ?bookingId=xxx, fetch that single
  // booking so `selectedBooking` resolves on first render without forcing
  // the user to type anything in the search box.
  useEffect(() => {
    if (!initialBookingId) return;
    if (bookings.some((b) => b.id === initialBookingId)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/bookings/${initialBookingId}`);
        if (!res.ok) return;
        const b = await res.json();
        if (cancelled || !b?.id) return;
        setBookings((prev) => prev.some((x) => x.id === b.id) ? prev : [b, ...prev]);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [initialBookingId, bookings]);

  // ── Add extra charge ────────────────────────────────────────────────────────
  async function handleAddCharge(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!selectedBooking?.folio) return;

    const amount = parseFloat(chargeForm.amount);
    if (isNaN(amount) || amount <= 0) {
      setSaveMsg('❌ ระบุจำนวนเงินให้ถูกต้อง');
      toast.warning('กรุณาระบุจำนวนเงินให้ถูกต้อง');
      return;
    }

    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch(`/api/folios/${selectedBooking.folio.id}/charges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chargeType: chargeForm.chargeType,
          description: chargeForm.description,
          amount,
          notes: chargeForm.notes || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);

      setSaveMsg('✅ เพิ่มรายการสำเร็จ');
      toast.success('เพิ่มรายการค่าบริการสำเร็จ');
      setChargeForm({ chargeType: 'EXTRA_SERVICE', description: '', amount: '', notes: '' });
      setShowAddCharge(false);
      setFolioKey((k) => k + 1); // refresh FolioLedger
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      setSaveMsg(`❌ ${msg}`);
      toast.error('เพิ่มรายการค่าบริการไม่สำเร็จ', msg);
    } finally {
      setSaving(false);
    }
  }

  // ── Void invoice ─────────────────────────────────────────────────────────────
  function openVoidDialog(invoiceId: string, invoiceNumber: string) {
    setVoidReason('');
    setVoidTarget({ invoiceId, invoiceNumber });
  }

  async function handleVoidInvoiceConfirm() {
    if (!voidTarget || isVoiding) return;
    if (!voidReason.trim()) {
      toast.warning('กรุณาระบุเหตุผลในการ Void');
      return;
    }
    setIsVoiding(true);
    try {
      const res = await fetch(`/api/invoices/${voidTarget.invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'void', reason: voidReason.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success(`Void ${voidTarget.invoiceNumber} สำเร็จ`, 'รายการถูกปลดล็อกกลับเป็น UNBILLED แล้ว');
      setVoidTarget(null);
      setFolioKey((k) => k + 1);
    } catch (err) {
      toast.error('Void ใบแจ้งหนี้ไม่สำเร็จ', err instanceof Error ? err.message : undefined);
    } finally {
      setIsVoiding(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-7xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Guest Folio Ledger</h1>
        <p className="text-sm text-gray-500 mt-1">
          ค้นหา booking เพื่อดูรายการค่าใช้จ่าย, ใบแจ้งหนี้ และยอดคงค้าง
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left panel: search & booking list ── */}
        <div className="lg:col-span-1 space-y-3">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="เลข booking, ชื่อลูกค้า..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {loading && (
            <p className="text-center text-sm text-gray-400 py-4">กำลังค้นหา...</p>
          )}

          {!loading && search.length >= 2 && bookings.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-4">ไม่พบ booking</p>
          )}

          <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {bookings.map((b) => {
              const st = STATUS_LABEL[b.status] ?? { label: b.status, cls: 'bg-gray-100 text-gray-600' };
              const isSelected = b.id === selectedBookingId;
              return (
                <button
                  key={b.id}
                  onClick={() => setSelectedBookingId(b.id)}
                  className={`w-full text-left rounded-lg border p-3 transition-all ${
                    isSelected
                      ? 'border-blue-400 bg-blue-50 shadow-sm'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm text-gray-900">
                        {b.bookingNumber}
                      </p>
                      <p className="text-xs text-gray-600 mt-0.5">
                        {b.guest.firstName} {b.guest.lastName}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        ห้อง {b.room.number} &nbsp;·&nbsp;
                        {fmtDate(new Date(b.checkIn))} – {fmtDate(new Date(b.checkOut))}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.cls}`}>
                        {st.label}
                      </span>
                      {b.folio ? (
                        <span className={`text-xs font-mono ${
                          Number(b.folio.balance) > 0 ? 'text-red-600' : 'text-green-600'
                        }`}>
                          ฿{Number(b.folio.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="text-xs text-yellow-600">ไม่มี Folio</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Right panel: Folio Ledger ── */}
        <div className="lg:col-span-2">
          {!selectedBookingId ? (
            <div className="flex flex-col items-center justify-center h-64 rounded-xl border-2 border-dashed border-gray-200 text-gray-400">
              <svg className="h-10 w-10 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm">เลือก booking จากด้านซ้ายเพื่อดู Folio</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">

              {/* Action bar */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  {selectedBooking?.folio && (
                    <button
                      onClick={() => setShowAddCharge(true)}
                      className="inline-flex items-center gap-1 text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition"
                    >
                      + เพิ่มค่าบริการ
                    </button>
                  )}
                </div>
                {saveMsg && (
                  <span className={`text-sm ${saveMsg.startsWith('✅') ? 'text-green-600' : 'text-red-600'}`}>
                    {saveMsg}
                  </span>
                )}
              </div>

              {/* Add Charge Form */}
              {showAddCharge && selectedBooking?.folio && (
                <form
                  onSubmit={handleAddCharge}
                  className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3"
                >
                  <h4 className="text-sm font-semibold text-blue-800">เพิ่มรายการค่าบริการ</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-600 block mb-1">ประเภท</label>
                      <select
                        value={chargeForm.chargeType}
                        onChange={(e) => setChargeForm({ ...chargeForm, chargeType: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
                      >
                        {CHARGE_TYPES.map((ct) => (
                          <option key={ct.value} value={ct.value}>{ct.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-600 block mb-1">จำนวนเงิน (฿)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={chargeForm.amount}
                        onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-gray-600 block mb-1">รายละเอียด *</label>
                      <input
                        type="text"
                        required
                        value={chargeForm.description}
                        onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
                        placeholder="เช่น ค่าซักผ้า, ค่าที่จอดรถเพิ่ม"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-gray-600 block mb-1">หมายเหตุ</label>
                      <input
                        type="text"
                        value={chargeForm.notes}
                        onChange={(e) => setChargeForm({ ...chargeForm, notes: e.target.value })}
                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setShowAddCharge(false)}
                      className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                    </button>
                  </div>
                </form>
              )}

              {/* Folio Ledger */}
              <FolioLedger
                key={`${selectedBookingId}-${folioKey}`}
                bookingId={selectedBookingId}
                onRefresh={() => setFolioKey((k) => k + 1)}
                onVoidInvoice={openVoidDialog}
              />
            </div>
          )}
        </div>
      </div>
      {/* ── Void Invoice Dialog ── */}
      <Dialog
        open={!!voidTarget}
        onClose={() => !isVoiding && setVoidTarget(null)}
        title={`Void ${voidTarget?.invoiceNumber ?? ''}?`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setVoidTarget(null)} disabled={isVoiding}>
              ยกเลิก
            </Button>
            <Button variant="danger" onClick={handleVoidInvoiceConfirm} loading={isVoiding}>
              Void ใบแจ้งหนี้
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            ใบแจ้งหนี้จะถูก Void และรายการทั้งหมดจะถูกปลดล็อกกลับเป็น UNBILLED
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
              เหตุผล *
            </label>
            <input
              autoFocus
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleVoidInvoiceConfirm(); }}
              placeholder="ระบุเหตุผล..."
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid var(--border-default)',
                borderRadius: 6,
                fontSize: 13,
                background: 'var(--surface-muted)',
                color: 'var(--text-primary)',
                outline: 'none',
              }}
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
