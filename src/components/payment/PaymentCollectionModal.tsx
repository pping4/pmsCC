'use client';

/**
 * PaymentCollectionModal
 *
 * Shared modal for collecting payment across 3 modes:
 *   - checkin: collect payment at check-in (daily / monthly advance)
 *   - checkout: collect remaining balance at check-out
 *   - collect: general payment collection for existing invoices
 *
 * Features:
 * - Payment method selector (Cash / Transfer / PromptPay / Credit Card)
 * - Invoice allocation interface (select which invoices to pay)
 * - Auto-distribute: Pay All / Oldest First
 * - Idempotency key (UUID) generated per modal open — prevents double-submit
 * - Reference number input for non-cash methods
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { fmtBaht } from '@/lib/date-format';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  invoiceType: string;
  grandTotal: number;
  paidAmount: number;
  status: string;
  dueDate: string;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
}

interface AllocationItem {
  invoiceId: string;
  invoiceNumber: string;
  dueAmount: number;
  allocated: number;
}

interface PaymentCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  bookingId: string;
  guestId: string;
  invoices: InvoiceSummary[];
  mode?: 'checkin' | 'checkout' | 'collect';
}

// ─── Payment method config ────────────────────────────────────────────────────

const PAYMENT_METHODS = [
  { value: 'cash',        label: 'เงินสด',       icon: '💵' },
  { value: 'transfer',    label: 'โอนเงิน',       icon: '🏦' },
  { value: 'promptpay',   label: 'PromptPay',     icon: '📱' },
  { value: 'credit_card', label: 'บัตรเครดิต',   icon: '💳' },
] as const;

type PaymentMethodValue = typeof PAYMENT_METHODS[number]['value'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return fmtBaht(n);
}

function invoiceTypeLabel(type: string): string {
  const map: Record<string, string> = {
    daily_stay: 'ค่าห้อง (รายวัน)',
    monthly_rent: 'ค่าเช่า (รายเดือน)',
    utility: 'ค่าสาธารณูปโภค',
    extra_service: 'บริการเพิ่มเติม',
    deposit_receipt: 'เงินประกัน',
    checkout_balance: 'ยอดชำระ Check-out',
    general: 'ใบแจ้งหนี้',
  };
  return map[type] ?? type;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PaymentCollectionModal({
  isOpen,
  onClose,
  onSuccess,
  bookingId,
  guestId,
  invoices,
  mode = 'collect',
}: PaymentCollectionModalProps) {
  // Filter: only unpaid / partial invoices
  const unpaidInvoices = useMemo(
    () => invoices.filter((inv) => ['unpaid', 'partial', 'overdue'].includes(inv.status)),
    [invoices]
  );

  // ─── State ──────────────────────────────────────────────────────────────────

  const [idempotencyKey] = useState(() => uuidv4()); // stable per modal open
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodValue>('cash');
  const [referenceNo, setReferenceNo] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // CashSession — auto-fetched when payment method is 'cash'
  const [cashSessionId, setCashSessionId]       = useState<string | null>(null);
  const [cashSessionLoading, setCashSessionLoading] = useState(false);
  const [cashSessionWarning, setCashSessionWarning] = useState('');

  // Allocation state: invoiceId -> allocated amount
  const [allocations, setAllocations] = useState<AllocationItem[]>([]);

  // Initialize allocations when modal opens
  useEffect(() => {
    if (isOpen) {
      setAllocations(
        unpaidInvoices.map((inv) => ({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          dueAmount: Math.max(0, inv.grandTotal - inv.paidAmount),
          allocated: 0,
        }))
      );
      setError('');
      setReferenceNo('');
      setNotes('');
    }
  }, [isOpen, unpaidInvoices]);

  // Fetch current cash session whenever 'cash' is selected
  useEffect(() => {
    if (!isOpen || paymentMethod !== 'cash') {
      setCashSessionId(null);
      setCashSessionWarning('');
      return;
    }
    let cancelled = false;
    (async () => {
      setCashSessionLoading(true);
      try {
        const res  = await fetch('/api/cash-sessions/current');
        const data = await res.json();
        if (cancelled) return;
        if (data.session?.id) {
          setCashSessionId(data.session.id);
          setCashSessionWarning('');
        } else {
          setCashSessionId(null);
          setCashSessionWarning('⚠️ ยังไม่ได้เปิดกะแคชเชียร์ — ไปที่หน้า กะแคชเชียร์ ก่อนรับเงินสด');
        }
      } catch {
        if (!cancelled) setCashSessionWarning('ไม่สามารถตรวจสอบกะแคชเชียร์ได้');
      } finally {
        if (!cancelled) setCashSessionLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, paymentMethod]);

  // ─── Computed values ─────────────────────────────────────────────────────────

  const totalDue = useMemo(
    () => allocations.reduce((s, a) => s + a.dueAmount, 0),
    [allocations]
  );

  const totalAllocated = useMemo(
    () => allocations.reduce((s, a) => s + a.allocated, 0),
    [allocations]
  );

  const remaining = totalAllocated; // amount entered, for validation
  const isBalanced = Math.abs(totalAllocated - remaining) < 0.01;

  // ─── Allocation helpers ───────────────────────────────────────────────────────

  const setAllocation = useCallback((invoiceId: string, value: string) => {
    const amount = parseFloat(value) || 0;
    setAllocations((prev) =>
      prev.map((a) =>
        a.invoiceId === invoiceId ? { ...a, allocated: Math.min(amount, a.dueAmount) } : a
      )
    );
  }, []);

  const payAll = useCallback(() => {
    setAllocations((prev) => prev.map((a) => ({ ...a, allocated: a.dueAmount })));
  }, []);

  const clearAll = useCallback(() => {
    setAllocations((prev) => prev.map((a) => ({ ...a, allocated: 0 })));
  }, []);

  const payOldestFirst = useCallback(
    (budget: number) => {
      let remaining = budget;
      setAllocations((prev) =>
        prev.map((a) => {
          if (remaining <= 0) return { ...a, allocated: 0 };
          const pay = Math.min(remaining, a.dueAmount);
          remaining -= pay;
          return { ...a, allocated: pay };
        })
      );
    },
    []
  );

  // ─── Submit ───────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    setError('');

    const activeAllocations = allocations.filter((a) => a.allocated > 0);
    if (activeAllocations.length === 0) {
      setError('กรุณาเลือกอย่างน้อย 1 ใบแจ้งหนี้');
      return;
    }
    if (totalAllocated <= 0) {
      setError('ยอดชำระต้องมากกว่า 0');
      return;
    }
    if (['transfer', 'promptpay', 'credit_card'].includes(paymentMethod) && !referenceNo.trim()) {
      setError('กรุณาระบุ Reference No. สำหรับการโอน/PromptPay/บัตร');
      return;
    }
    if (paymentMethod === 'cash' && !cashSessionId) {
      setError('ต้องเปิดกะแคชเชียร์ก่อนรับเงินสด — ไปที่หน้า กะแคชเชียร์');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey,
          guestId,
          bookingId,
          amount: totalAllocated,
          paymentMethod,
          referenceNo: referenceNo.trim() || undefined,
          notes: notes.trim() || undefined,
          cashSessionId: paymentMethod === 'cash' ? cashSessionId : undefined,
          allocations: activeAllocations.map((a) => ({
            invoiceId: a.invoiceId,
            amount: a.allocated,
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? 'เกิดข้อผิดพลาด');
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  if (!isOpen) return null;

  const modeTitle =
    mode === 'checkin' ? '💰 รับชำระเงิน (Check-in)'
    : mode === 'checkout' ? '💰 รับชำระเงิน (Check-out)'
    : '💰 รับชำระเงิน';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-blue-50">
          <h2 className="text-lg font-bold text-blue-900">{modeTitle}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            disabled={loading}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* ── Outstanding summary ── */}
          <div className="bg-blue-50 rounded-xl p-4 flex justify-between items-center">
            <div>
              <p className="text-sm text-blue-600">ยอดค้างชำระทั้งหมด</p>
              <p className="text-2xl font-bold text-blue-900">฿{fmt(totalDue)}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">ยอดที่เลือกชำระ</p>
              <p className="text-2xl font-bold text-green-700">฿{fmt(totalAllocated)}</p>
            </div>
          </div>

          {/* ── Payment method ── */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">วิธีชำระเงิน</label>
            <div className="grid grid-cols-4 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setPaymentMethod(m.value)}
                  className={`flex flex-col items-center py-3 px-2 rounded-xl border-2 text-sm font-medium transition-all ${
                    paymentMethod === m.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-600'
                  }`}
                >
                  <span className="text-xl mb-1">{m.icon}</span>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* CashSession status (cash only) */}
          {paymentMethod === 'cash' && (
            <div>
              {cashSessionLoading ? (
                <div className="text-xs text-gray-400 animate-pulse">กำลังตรวจสอบกะแคชเชียร์...</div>
              ) : cashSessionWarning ? (
                <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2 text-xs">
                  {cashSessionWarning}
                </div>
              ) : cashSessionId ? (
                <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2 text-xs">
                  🟢 กะแคชเชียร์เปิดอยู่ — รับเงินสดได้
                </div>
              ) : null}
            </div>
          )}

          {/* Reference no (non-cash) */}
          {paymentMethod !== 'cash' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Reference No. <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                placeholder="เลขที่อ้างอิงการโอน / QR / บัตร"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          )}

          {/* ── Invoice allocation ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-gray-700">เลือกใบแจ้งหนี้ที่ชำระ</label>
              <div className="flex gap-2">
                <button
                  onClick={payAll}
                  className="text-xs text-blue-600 hover:underline font-medium"
                >
                  ชำระทั้งหมด
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => payOldestFirst(totalDue)}
                  className="text-xs text-blue-600 hover:underline font-medium"
                >
                  เก่าสุดก่อน
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={clearAll}
                  className="text-xs text-gray-400 hover:underline"
                >
                  ล้าง
                </button>
              </div>
            </div>

            {allocations.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                ไม่มีใบแจ้งหนี้ค้างชำระ
              </div>
            ) : (
              <div className="space-y-2">
                {allocations.map((alloc) => (
                  <div
                    key={alloc.invoiceId}
                    className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {alloc.invoiceNumber}
                      </p>
                      <p className="text-xs text-gray-500">
                        ค้าง: ฿{fmt(alloc.dueAmount)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">฿</span>
                      <input
                        type="number"
                        min={0}
                        max={alloc.dueAmount}
                        step={0.01}
                        value={alloc.allocated || ''}
                        onChange={(e) => setAllocation(alloc.invoiceId, e.target.value)}
                        placeholder="0.00"
                        className="w-28 text-right border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      <button
                        onClick={() => setAllocation(alloc.invoiceId, String(alloc.dueAmount))}
                        className="text-xs text-blue-500 hover:text-blue-700 whitespace-nowrap"
                      >
                        เต็ม
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">หมายเหตุ</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            ยอดรวมชำระ:{' '}
            <span className="font-bold text-gray-800 text-base">฿{fmt(totalAllocated)}</span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-5 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 text-sm font-medium disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || totalAllocated <= 0}
              className="px-6 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <span className="animate-spin">⏳</span> กำลังบันทึก...
                </>
              ) : (
                <>💾 บันทึกการชำระเงิน</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
