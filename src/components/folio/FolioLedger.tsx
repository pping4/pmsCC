'use client';

/**
 * FolioLedger.tsx
 *
 * แสดง Guest Folio แบบ real-time — รายการค่าใช้จ่าย, สถานะ billing,
 * ยอดรวม, และ invoices ทั้งหมดของ booking นั้น
 *
 * Usage:
 *   <FolioLedger bookingId="uuid" />
 *
 * Features:
 *  - ดึง Folio จาก GET /api/bookings/[id]/folio
 *  - แสดง FolioLineItems พร้อม BillingStatus badges (UNBILLED/BILLED/PAID/VOIDED)
 *  - แสดง Invoice list พร้อมสถานะ
 *  - แสดง KPI: ยอดรวมค่าใช้จ่าย, ชำระแล้ว, คงค้าง
 *  - Refresh ได้ผ่าน onRefresh callback
 */

import React, { useEffect, useState, useCallback } from 'react';
import { fmtDate, fmtDateTime, fmtBaht } from '@/lib/date-format';
import { useToast, ConfirmDialog } from '@/components/ui';
import { ReceivingAccountPicker } from '@/components/payment/ReceivingAccountPicker';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FolioLineItem {
  id: string;
  chargeType: string;
  description: string;
  amount: number;
  quantity: number;
  billingStatus: 'UNBILLED' | 'BILLED' | 'PAID' | 'VOIDED';
  serviceDate: string | null;
  notes: string | null;
  createdAt: string;
  invoiceItem?: {
    invoice?: { invoiceNumber: string; status: string } | null;
  } | null;
}

interface FolioInvoice {
  id: string;
  invoiceNumber: string;
  invoiceType: string;
  status: string;
  grandTotal: number;
  paidAmount: number;
  issueDate: string;
  dueDate: string;
}

interface FolioPayment {
  id: string;
  paymentNumber: string;
  receiptNumber: string;
  amount: number;
  paymentMethod: string;
  paymentDate: string;
  referenceNo: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'VOIDED';
  voidReason: string | null;
  voidedAt: string | null;
  createdAt: string;
  // Sub-step 5.1 cross-links — surface the cashier shift that took this
  // payment so each row can link back to /finance ledger view.
  cashSessionId: string | null;
  cashSession: {
    id: string;
    openedAt: string;
    closedAt: string | null;
    cashBox: { code: string } | null;
  } | null;
}

interface FolioData {
  id: string;
  folioNumber: string;
  bookingId: string;
  totalCharges: number;
  totalPayments: number;
  balance: number;
  closedAt: string | null;
  lineItems: FolioLineItem[];
  invoices: FolioInvoice[];
  payments: FolioPayment[];
  booking: {
    bookingNumber: string;
    bookingType: string;
    checkIn: string;
    checkOut: string;
    room: { number: string };
    guest: { firstName: string; lastName: string };
  };
}

interface FolioLedgerProps {
  bookingId: string;
  onRefresh?: () => void;
  onVoidInvoice?: (invoiceId: string, invoiceNumber: string) => void;
  compact?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CHARGE_LABEL: Record<string, string> = {
  ROOM: '🏠 ค่าห้อง',
  UTILITY_WATER: '💧 น้ำ',
  UTILITY_ELECTRIC: '⚡ ไฟ',
  EXTRA_SERVICE: '🛎 บริการเสริม',
  PENALTY: '⚠️ ค่าปรับ',
  DISCOUNT: '🏷️ ส่วนลด',
  ADJUSTMENT: '📝 ปรับรายการ',
  DEPOSIT_BOOKING: '🔐 มัดจำ',
  OTHER: '📋 อื่น ๆ',
};

const BILLING_STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  UNBILLED: { label: 'ยังไม่ออกบิล', bg: 'bg-yellow-100', text: 'text-yellow-800' },
  BILLED:   { label: 'ออกบิลแล้ว',   bg: 'bg-blue-100',   text: 'text-blue-800'   },
  PAID:     { label: 'ชำระแล้ว',      bg: 'bg-green-100',  text: 'text-green-800'  },
  VOIDED:   { label: 'ยกเลิก',        bg: 'bg-gray-100',   text: 'text-gray-500'   },
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash:        '💵 เงินสด',
  transfer:    '🏦 โอนเงิน',
  credit_card: '💳 บัตรเครดิต',
  debit_card:  '💳 บัตรเดบิต',
  qr:          '📱 QR Code',
  cheque:      '📄 เช็ค',
  city_ledger: '🏢 City Ledger',
};

const INVOICE_STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  unpaid:    { label: 'ค้างชำระ',   bg: 'bg-red-100',    text: 'text-red-800'    },
  partial:   { label: 'ชำระบางส่วน',bg: 'bg-orange-100', text: 'text-orange-800' },
  paid:      { label: 'ชำระแล้ว',   bg: 'bg-green-100',  text: 'text-green-800'  },
  overdue:   { label: 'เกินกำหนด',  bg: 'bg-red-200',    text: 'text-red-900'    },
  voided:    { label: 'Void',        bg: 'bg-gray-100',   text: 'text-gray-500'   },
  cancelled: { label: 'ยกเลิก',     bg: 'bg-gray-100',   text: 'text-gray-500'   },
};

function StatusBadge({
  status,
  config,
}: {
  status: string;
  config: Record<string, { label: string; bg: string; text: string }>;
}) {
  const c = config[status] ?? { label: status, bg: 'bg-gray-100', text: 'text-gray-600' };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}
    >
      {c.label}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FolioLedger({ bookingId, onRefresh, onVoidInvoice, compact = false }: FolioLedgerProps) {
  const toast = useToast();
  const [folio, setFolio] = useState<FolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── Refund (void payment) state ──────────────────────────────────────────
  const [refundTarget, setRefundTarget] = useState<FolioPayment | null>(null);
  const [refunding, setRefunding] = useState(false);

  // ─── Quick-pay (issue invoice for UNBILLED + collect) state ──────────────
  // Lets the cashier collect outstanding balance directly from the folio
  // page -- without this, the "ยังไม่ออกบิล" warning was a dead end (you
  // had to wait for checkout). The pay endpoint allocates to existing
  // unpaid invoices first, then falls back to creating a new one from
  // UNBILLED line items, so this single button works for every shape of
  // outstanding balance.
  const [payOpen,        setPayOpen]        = useState(false);
  const [payMethod,      setPayMethod]      = useState<'cash' | 'transfer' | 'credit_card'>('cash');
  const [payRecvAccount, setPayRecvAccount] = useState<string | undefined>();
  const [paySubmitting,  setPaySubmitting]  = useState(false);

  const handleQuickPay = useCallback(async () => {
    if (!folio || paySubmitting) return;
    if (payMethod === 'transfer' && !payRecvAccount) {
      toast.error('กรุณาเลือกบัญชีที่รับเงิน'); return;
    }
    if (payMethod === 'credit_card') {
      toast.error('บัตรเครดิตต้องระบุเครื่อง EDC — ใช้หน้า Guest Folio ของผู้เข้าพักหรือ DetailPanel แทน');
      return;
    }
    setPaySubmitting(true);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/pay`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount:        Number(folio.balance),
          paymentMethod: payMethod,
          ...(payMethod === 'transfer' && payRecvAccount
              ? { receivingAccountId: payRecvAccount } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      toast.success('รับชำระสำเร็จ', `ใบเสร็จ ${data.receipt?.receiptNumber ?? '-'} · ฿${fmtBaht(Number(folio.balance))}`);
      setPayOpen(false);
      setPayMethod('cash');
      setPayRecvAccount(undefined);
      load();
      onRefresh?.();
    } catch (e) {
      toast.error('รับชำระไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setPaySubmitting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folio, payMethod, payRecvAccount, paySubmitting, bookingId, onRefresh]);

  const handleRefund = useCallback(async () => {
    if (!refundTarget || refunding) return;
    setRefunding(true);
    try {
      const res = await fetch(`/api/payments/${refundTarget.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voidReason: 'คืนเงินโดย staff ผ่าน Folio Ledger' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      toast.success('คืนเงินสำเร็จ', `${refundTarget.paymentNumber} — ฿${fmtBaht(Number(refundTarget.amount))}`);
      setRefundTarget(null);
      load();
      onRefresh?.();
    } catch (e) {
      toast.error('คืนเงินไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setRefunding(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refundTarget, refunding, onRefresh]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/folio`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const data: FolioData = await res.json();
      setFolio(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลล้มเหลว');
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
        <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        กำลังโหลด Folio...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        ⚠️ {error}
        <button onClick={load} className="ml-3 underline hover:no-underline">
          ลองใหม่
        </button>
      </div>
    );
  }

  if (!folio) {
    return (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
        ยังไม่มี Folio สำหรับ booking นี้
      </div>
    );
  }

  const unbilledTotal = folio.lineItems
    .filter((i) => i.billingStatus === 'UNBILLED')
    .reduce((s, i) => s + Number(i.amount), 0);

  const balance = Number(folio.balance);

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            {folio.folioNumber}
          </h3>
          <p className="text-xs text-gray-500">
            {folio.booking.guest.firstName} {folio.booking.guest.lastName} &nbsp;·&nbsp;
            ห้อง {folio.booking.room.number} &nbsp;·&nbsp;
            {fmtDate(new Date(folio.booking.checkIn))} – {fmtDate(new Date(folio.booking.checkOut))}
            {folio.closedAt && (
              <span className="ml-2 text-red-500">(ปิด Folio แล้ว)</span>
            )}
          </p>
        </div>
        <button
          onClick={() => { load(); onRefresh?.(); }}
          className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
        >
          ↺ รีเฟรช
        </button>
      </div>

      {/* ── KPI Summary ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-center">
          <p className="text-xs text-gray-500 mb-1">ยอดรวมค่าใช้จ่าย</p>
          <p className="text-lg font-bold text-gray-900">
            ฿{fmtBaht(Number(folio.totalCharges))}
          </p>
        </div>
        <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-center">
          <p className="text-xs text-green-600 mb-1">ชำระแล้ว</p>
          <p className="text-lg font-bold text-green-700">
            ฿{fmtBaht(Number(folio.totalPayments))}
          </p>
        </div>
        {/* Phase 3 — three-state balance display.
            balance > 0  : guest still owes us → red "ยอดค้างชำระ"
            balance == 0 : settled            → grey "ชำระครบ"
            balance < 0  : we owe guest       → orange "ต้องคืนให้ลูกค้า"
            The old code used Math.abs() and labelled negative balance as
            "ยอดคงเหลือ" — to a Thai accountant that reads as "available
            cash on hand". Wrong direction. */}
        <div className={`rounded-lg border p-3 text-center ${
          balance > 0
            ? 'bg-red-50 border-red-200'
            : balance < 0
              ? 'bg-orange-50 border-orange-300'
              : 'bg-gray-50 border-gray-200'
        }`}>
          <p className={`text-xs mb-1 ${
            balance > 0 ? 'text-red-600'
              : balance < 0 ? 'text-orange-700'
              : 'text-gray-600'
          }`}>
            {balance > 0
              ? 'ยอดค้างชำระ'
              : balance < 0
                ? '⚠ ต้องคืนให้ลูกค้า'
                : 'ชำระครบ'}
          </p>
          <p className={`text-lg font-bold ${
            balance > 0 ? 'text-red-700'
              : balance < 0 ? 'text-orange-800'
              : 'text-gray-700'
          }`}>
            ฿{fmtBaht(Math.abs(balance))}
          </p>
          {balance < 0 && (
            <p className="text-[10px] text-orange-700 mt-1">
              รอดำเนินการคืนเงิน — ดูหน้า /refunds
            </p>
          )}
        </div>
      </div>

      {/* ── Unbilled Alert ── */}
      {unbilledTotal > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-yellow-50 border border-yellow-300 px-3 py-2 text-sm text-yellow-800">
          <span>⚠️</span>
          <span className="flex-1">
            มีรายการ <strong>ยังไม่ออกบิล</strong> มูลค่า{' '}
            <strong>฿{fmtBaht(unbilledTotal)}</strong> — ต้องออก Invoice ก่อนเช็คเอาท์
          </span>
        </div>
      )}

      {/* ── Quick-pay action ── */}
      {balance > 0 && !folio.closedAt && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-300 p-3 text-sm">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-base">💰</span>
            <span className="flex-1 text-emerald-900">
              ยอดค้างชำระ <strong>฿{fmtBaht(balance)}</strong>
              {unbilledTotal > 0 && (
                <span className="text-xs text-emerald-700 ml-2">
                  (จะออก Invoice ใหม่อัตโนมัติจากรายการที่ยังไม่ออกบิล)
                </span>
              )}
            </span>
            {!payOpen && (
              <button
                type="button"
                onClick={() => setPayOpen(true)}
                className="text-xs font-semibold px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                💵 รับชำระเงิน
              </button>
            )}
          </div>

          {payOpen && (
            <div className="bg-white rounded-md border border-emerald-200 p-3 space-y-3">
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">ช่องทางชำระ</p>
                <div className="flex gap-2 flex-wrap">
                  {([
                    { v: 'cash',        l: '💵 เงินสด' },
                    { v: 'transfer',    l: '🏦 โอนเงิน' },
                    { v: 'credit_card', l: '💳 บัตรเครดิต' },
                  ] as const).map((pm) => (
                    <button
                      key={pm.v}
                      type="button"
                      onClick={() => setPayMethod(pm.v)}
                      className={`px-3 py-1.5 text-xs rounded-md border ${
                        payMethod === pm.v
                          ? 'bg-emerald-100 border-emerald-500 text-emerald-700 font-semibold'
                          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {pm.l}
                    </button>
                  ))}
                </div>
              </div>

              {payMethod === 'transfer' && (
                <ReceivingAccountPicker
                  receivingAccountId={payRecvAccount}
                  onChange={setPayRecvAccount}
                  label="บัญชีที่รับเงิน (โอน)"
                />
              )}
              {payMethod === 'credit_card' && (
                <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-2 py-1.5">
                  ℹ️ บัตรเครดิตต้องระบุเครื่อง EDC + แบรนด์บัตร — ใช้ฟอร์มเก็บเงินที่ tab บิลในหน้าตารางจองแทน
                </div>
              )}

              <div className="flex gap-2 pt-1 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => { setPayOpen(false); setPayMethod('cash'); setPayRecvAccount(undefined); }}
                  disabled={paySubmitting}
                  className="flex-1 text-xs px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleQuickPay}
                  disabled={
                    paySubmitting ||
                    payMethod === 'credit_card' ||
                    (payMethod === 'transfer' && !payRecvAccount)
                  }
                  className="flex-[2] text-xs font-semibold px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {paySubmitting ? '⏳ กำลังบันทึก…' : `✅ ยืนยัน · ฿${fmtBaht(balance)}`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Line Items ── */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-2">
          รายการค่าใช้จ่าย ({folio.lineItems.length} รายการ)
        </h4>
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left">รายการ</th>
                {!compact && <th className="px-3 py-2 text-left">วันที่</th>}
                <th className="px-3 py-2 text-right">จำนวน</th>
                <th className="px-3 py-2 text-center">สถานะ</th>
                {!compact && <th className="px-3 py-2 text-left">Invoice</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {folio.lineItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-gray-400 text-sm">
                    ยังไม่มีรายการค่าใช้จ่าย
                  </td>
                </tr>
              ) : (
                folio.lineItems.map((item) => (
                  <tr
                    key={item.id}
                    className={item.billingStatus === 'VOIDED' ? 'opacity-40' : 'hover:bg-gray-50'}
                  >
                    <td className="px-3 py-2">
                      <p className="text-xs text-gray-400 mb-0.5">
                        {CHARGE_LABEL[item.chargeType] ?? item.chargeType}
                      </p>
                      <p className="text-gray-900">{item.description}</p>
                      {item.notes && (
                        <p className="text-xs text-gray-400 mt-0.5">{item.notes}</p>
                      )}
                    </td>
                    {!compact && (
                      <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                        {item.serviceDate
                          ? fmtDate(new Date(item.serviceDate))
                          : fmtDate(new Date(item.createdAt))}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right font-mono font-medium text-gray-900">
                      ฿{fmtBaht(Number(item.amount))}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <StatusBadge
                        status={item.billingStatus}
                        config={BILLING_STATUS_CONFIG}
                      />
                    </td>
                    {!compact && (
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {item.invoiceItem?.invoice?.invoiceNumber ?? '—'}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
            {folio.lineItems.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td
                    colSpan={compact ? 1 : 2}
                    className="px-3 py-2 text-sm font-semibold text-gray-700"
                  >
                    รวมทั้งหมด
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-gray-900">
                    ฿{fmtBaht(Number(folio.totalCharges))}
                  </td>
                  <td colSpan={compact ? 1 : 2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Payments ── */}
      {!compact && folio.payments.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">
            รายการชำระเงิน ({folio.payments.filter(p => p.status === 'ACTIVE').length} รายการ)
          </h4>
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">เลขที่ใบเสร็จ</th>
                  <th className="px-3 py-2 text-left">ช่องทาง</th>
                  <th className="px-3 py-2 text-left">วันที่</th>
                  <th className="px-3 py-2 text-right">จำนวน</th>
                  <th className="px-3 py-2 text-center">สถานะ</th>
                  <th className="px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {folio.payments.map((pmt) => (
                  <tr
                    key={pmt.id}
                    className={pmt.status === 'VOIDED' ? 'opacity-40 bg-gray-50' : 'hover:bg-gray-50'}
                  >
                    <td className="px-3 py-2">
                      <p className="font-mono text-xs text-blue-700">{pmt.receiptNumber}</p>
                      <p className="text-xs text-gray-400">{pmt.paymentNumber}</p>
                      {pmt.referenceNo && (
                        <p className="text-xs text-gray-400">Ref: {pmt.referenceNo}</p>
                      )}
                      {pmt.cashSession && (
                        <a
                          href={`/finance?period=custom&from=${pmt.cashSession.openedAt.slice(0,10)}&to=${(pmt.cashSession.closedAt ?? new Date().toISOString()).slice(0,10)}&sessionId=${pmt.cashSession.id}`}
                          className="text-[10px] text-blue-600 hover:underline mt-0.5 inline-flex items-center gap-0.5"
                          title="ดูในรายการเดินบัญชีของกะ"
                        >
                          🏧 {pmt.cashSession.cashBox?.code ?? 'shift'} →
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {PAYMENT_METHOD_LABEL[pmt.paymentMethod] ?? pmt.paymentMethod}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                      {fmtDate(new Date(pmt.paymentDate))}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-green-700">
                      ฿{fmtBaht(Number(pmt.amount))}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {pmt.status === 'ACTIVE' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          ชำระแล้ว
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          คืนเงินแล้ว
                        </span>
                      )}
                      {pmt.voidReason && (
                        <p className="text-xs text-gray-400 mt-0.5">{pmt.voidReason}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {pmt.status === 'ACTIVE' && (
                        <button
                          onClick={() => setRefundTarget(pmt)}
                          className="text-xs px-2 py-1 rounded-md border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
                        >
                          คืนเงิน
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-sm font-semibold text-gray-700">
                    รวมที่ชำระแล้ว
                  </td>
                  <td className="px-3 py-2 text-right font-bold text-green-700 font-mono">
                    ฿{fmtBaht(folio.payments
                      .filter(p => p.status === 'ACTIVE')
                      .reduce((s, p) => s + Number(p.amount), 0))}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Invoices ── */}
      {!compact && folio.invoices.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">
            Invoices ({folio.invoices.length} ใบ)
          </h4>
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">เลขที่</th>
                  <th className="px-3 py-2 text-left">วันที่</th>
                  <th className="px-3 py-2 text-right">ยอดรวม</th>
                  <th className="px-3 py-2 text-right">ชำระแล้ว</th>
                  <th className="px-3 py-2 text-center">สถานะ</th>
                  {onVoidInvoice && <th className="px-3 py-2 text-center">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {folio.invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-blue-700">
                      {inv.invoiceNumber}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {fmtDate(new Date(inv.issueDate))}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900">
                      ฿{fmtBaht(Number(inv.grandTotal))}
                    </td>
                    <td className="px-3 py-2 text-right text-green-700">
                      ฿{fmtBaht(Number(inv.paidAmount))}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <StatusBadge
                        status={inv.status}
                        config={INVOICE_STATUS_CONFIG}
                      />
                    </td>
                    {onVoidInvoice && (
                      <td className="px-3 py-2 text-center">
                        {!['voided', 'cancelled'].includes(inv.status) && (
                          <button
                            onClick={() => onVoidInvoice(inv.id, inv.invoiceNumber)}
                            className="text-xs px-2 py-1 rounded-md border border-orange-300 text-orange-600 hover:bg-orange-50 transition-colors"
                          >
                            Void
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={2} className="px-3 py-2 text-sm font-semibold text-gray-700">
                    รวม
                  </td>
                  <td className="px-3 py-2 text-right font-bold text-gray-900">
                    ฿{fmtBaht(folio.invoices.reduce((s, i) => s + Number(i.grandTotal), 0))}
                  </td>
                  <td className="px-3 py-2 text-right font-bold text-green-700">
                    ฿{fmtBaht(folio.invoices.reduce((s, i) => s + Number(i.paidAmount), 0))}
                  </td>
                  <td />
                  {onVoidInvoice && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
      {/* ── Refund Confirm Dialog ── */}
      <ConfirmDialog
        open={!!refundTarget}
        title="ยืนยันการคืนเงิน"
        description={refundTarget
          ? `คืนเงิน ฿${fmtBaht(Number(refundTarget.amount))} (${refundTarget.receiptNumber}) — การดำเนินการนี้จะยกเลิกการชำระเงินและไม่สามารถกู้คืนได้`
          : undefined}
        confirmText="คืนเงิน"
        cancelText="ยกเลิก"
        variant="danger"
        loading={refunding}
        onConfirm={handleRefund}
        onCancel={() => setRefundTarget(null)}
      />
    </div>
  );
}
