'use client';

import { useState, useEffect } from 'react';
import type { BookingItem, RoomItem } from '../lib/types';
import { STATUS_STYLE, BOOKING_TYPE_LABEL, SOURCE_LABEL, FONT } from '../lib/constants';
import { fmtThaiLong, fmtCurrency, guestDisplayName, diffDays, parseUTCDate } from '../lib/date-utils';
import { fmtDateTime } from '@/lib/date-format';
import ReceiptModal from '@/components/receipt/ReceiptModal';
import type { ReceiptData } from '@/components/receipt/types';
import InvoiceModal from '@/components/invoice/InvoiceModal';
import type { InvoiceDocumentData } from '@/components/invoice/types';

interface DetailPanelProps {
  booking: BookingItem | null;
  room: RoomItem | null;
  onClose: () => void;
  onRefresh: () => void;
}

interface ApiError {
  message: string;
}

interface ActivityLogEntry {
  id: string;
  icon: string;
  description: string;
  action: string;
  category: string;
  userName: string | null;
  createdAt: string;
  severity: string;
  metadata?: Record<string, unknown> | null;
}

interface BillingInvoice {
  id:            string;
  invoiceNumber: string;
  invoiceType:   string;
  status:        string;
  grandTotal:    number;
  paidAmount:    number;
  issueDate:     string;
  // Proforma-only fields — set when no real invoices exist yet
  isProforma?:   boolean;
  bookingId?:    string;
}

const INVOICE_TYPE_TH: Record<string, string> = {
  deposit_receipt:  'มัดจำ/ล่วงหน้า',
  daily_stay:       'เช็คอิน',
  checkout_balance: 'เช็คเอาท์',
  monthly_rent:     'รายเดือน',
  utility:          'สาธารณูปโภค',
  extra_service:    'บริการเสริม',
  general:          'ทั่วไป',
  proforma:         'ใบแจ้งหนี้ล่วงหน้า',
};

const INV_STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  unpaid:    { bg: '#fef2f2', color: '#dc2626', label: 'ค้างชำระ' },
  paid:      { bg: '#f0fdf4', color: '#16a34a', label: 'ชำระแล้ว' },
  voided:    { bg: '#f3f4f6', color: '#6b7280', label: 'ยกเลิก' },
  cancelled: { bg: '#f3f4f6', color: '#6b7280', label: 'ยกเลิก' },
  partial:   { bg: '#fffbeb', color: '#d97706', label: 'ชำระบางส่วน' },
  proforma:  { bg: '#f5f3ff', color: '#7c3aed', label: 'ล่วงหน้า' },
};

const PAYMENT_METHODS = [
  { value: 'cash',        label: '💵 เงินสด' },
  { value: 'transfer',    label: '🏦 โอนเงิน' },
  { value: 'credit_card', label: '💳 บัตรเครดิต' },
];

export default function DetailPanel({
  booking,
  room,
  onClose,
  onRefresh,
}: DetailPanelProps): JSX.Element {
  const [loading, setLoading]         = useState<boolean>(false);
  const [error, setError]             = useState<string>('');
  const [activeTab, setActiveTab]     = useState<'details' | 'activity' | 'billing'>('details');
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // ── Billing tab: invoice list ─────────────────────────────────────────────
  const [billingInvoices, setBillingInvoices] = useState<BillingInvoice[]>([]);
  const [billingLoading, setBillingLoading]   = useState(false);
  const [reprintData,  setReprintData]        = useState<ReceiptData | null>(null);
  const [invoiceDoc,   setInvoiceDoc]         = useState<InvoiceDocumentData | null>(null);

  // ── Billing tab: inline payment form ──────────────────────────────────────
  const [billingPayOpen,    setBillingPayOpen]    = useState(false);
  const [billingPayMethod,  setBillingPayMethod]  = useState<string>('cash');
  const [billingCashSessId, setBillingCashSessId] = useState<string | null>(null);
  const [billingPayLoading, setBillingPayLoading] = useState(false);

  // ── Check-in payment step ─────────────────────────────────────────────────
  // 'idle'     → show normal action buttons
  // 'payment'  → show payment collection form
  // 'confirm'  → show final confirm panel
  const [checkinStep, setCheckinStep] = useState<'idle' | 'payment' | 'confirm'>('idle');

  const [depositAmount,   setDepositAmount]   = useState<number>(0);
  const [depositMethod,   setDepositMethod]   = useState<string>('cash');
  const [collectUpfront,  setCollectUpfront]  = useState<boolean>(false);
  const [upfrontMethod,   setUpfrontMethod]   = useState<string>('cash');
  const [cashSessionId,   setCashSessionId]   = useState<string | null>(null);

  // ── Check-out payment step ────────────────────────────────────────────────
  // 'idle'    → normal action buttons
  // 'collect' → show outstanding + payment method selection
  const [checkoutStep,          setCheckoutStep]          = useState<'idle' | 'collect'>('idle');
  const [checkoutPayMethod,     setCheckoutPayMethod]     = useState<string>('cash');
  const [checkoutCashSessionId, setCheckoutCashSessionId] = useState<string | null>(null);
  // Actual outstanding fetched from folio (replaces stale booking.totalPaid calculation)
  const [checkoutFolioBalance,  setCheckoutFolioBalance]  = useState<number | null>(null);

  // ── Receipt modal ─────────────────────────────────────────────────────────
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);

  const isOpen = booking !== null && room !== null;

  // Reset all steps when panel opens a new booking
  useEffect(() => {
    setCheckinStep('idle');
    setDepositAmount(0);
    setDepositMethod('cash');
    setCollectUpfront(false);
    setUpfrontMethod('cash');
    setCashSessionId(null);
    setCheckoutStep('idle');
    setCheckoutPayMethod('cash');
    setCheckoutCashSessionId(null);
    setCheckoutFolioBalance(null);
    setReceiptData(null);
    setReprintData(null);
    setInvoiceDoc(null);
    setBillingInvoices([]);
    setBillingPayOpen(false);
    setBillingPayMethod('cash');
    setBillingCashSessId(null);
    setError('');
    setActiveTab('details');
  }, [booking?.id]);

  // Auto-fetch current open cash session for check-in payment methods
  useEffect(() => {
    const needsCash = depositMethod === 'cash' || upfrontMethod === 'cash';
    if (!needsCash) { setCashSessionId(null); return; }
    fetch('/api/cash-sessions/current')
      .then(r => r.json())
      .then(d => setCashSessionId(d.session?.id ?? null))
      .catch(() => setCashSessionId(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositMethod, upfrontMethod, booking?.id, checkinStep]);

  // Auto-fetch current open cash session for check-out payment
  useEffect(() => {
    if (checkoutPayMethod !== 'cash') { setCheckoutCashSessionId(null); return; }
    fetch('/api/cash-sessions/current')
      .then(r => r.json())
      .then(d => setCheckoutCashSessionId(d.session?.id ?? null))
      .catch(() => setCheckoutCashSessionId(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutPayMethod, booking?.id, checkoutStep]);

  // Fetch actual folio balance when entering checkout collect step.
  // This replaces the stale booking.totalPaid calculation and correctly reflects
  // any payment already collected at check-in or from the billing tab.
  useEffect(() => {
    if (checkoutStep !== 'collect' || !booking?.id) return;
    fetch(`/api/bookings/${booking.id}/folio`)
      .then(r => r.json())
      .then((folio: { balance?: number } | null) => {
        // folio.balance = totalCharges - totalPayments (from recalculateFolioBalance)
        // A positive balance means money still owed; negative or zero = fully paid.
        const balance = folio ? Math.max(0, Number(folio.balance ?? 0)) : null;
        setCheckoutFolioBalance(balance);
      })
      .catch(() => setCheckoutFolioBalance(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutStep, booking?.id]);

  const loadActivityLogs = async (bookingId: string) => {
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/activity-log?bookingId=${bookingId}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setActivityLogs(data.logs ?? []);
      }
    } catch { /* non-fatal */ }
    finally { setLogsLoading(false); }
  };

  useEffect(() => {
    if (booking?.id && activeTab === 'activity') {
      loadActivityLogs(booking.id);
    }
    if (booking?.id && activeTab === 'billing') {
      loadBillingInvoices(booking.id);
    }
  }, [booking?.id, activeTab]);

  const loadBillingInvoices = async (bookingId: string) => {
    setBillingLoading(true);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/folio`);
      if (res.ok) {
        const folio = await res.json() as { invoices?: BillingInvoice[] } | null;
        const realInvoices = folio?.invoices ?? [];

        if (realInvoices.length > 0) {
          // Real invoices exist — show them as-is
          setBillingInvoices(realInvoices);
        } else {
          // No real invoices yet — inject a virtual proforma row so staff
          // can print an invoice immediately after booking confirmation.
          // We only need enough fields to render the card; the document is
          // fetched on-demand when the button is clicked.
          const proformaRow: BillingInvoice = {
            id:            bookingId,          // used as key; handleProformaPrint reads bookingId
            invoiceNumber: `PRO-${booking?.bookingNumber ?? bookingId}`,
            invoiceType:   'proforma',
            status:        'proforma',
            grandTotal:    0,                  // actual amount shown in the document itself
            paidAmount:    0,
            issueDate:     '',
            isProforma:    true,
            bookingId,
          };
          setBillingInvoices([proformaRow]);
        }
      }
    } catch { /* non-fatal */ }
    finally { setBillingLoading(false); }
  };

  // Auto-fetch cash session when billing pay form is open with cash method
  useEffect(() => {
    if (!billingPayOpen || billingPayMethod !== 'cash') {
      setBillingCashSessId(null);
      return;
    }
    fetch('/api/cash-sessions/current')
      .then(r => r.json())
      .then(d => setBillingCashSessId(d.session?.id ?? null))
      .catch(() => setBillingCashSessId(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingPayOpen, billingPayMethod, booking?.id]);

  /** Collect payment from billing tab — works for confirmed or checked_in bookings. */
  const handleBillingPay = async () => {
    if (!booking || billingPayLoading) return;
    setBillingPayLoading(true);
    setError('');
    try {
      const res  = await fetch(`/api/bookings/${booking.id}/pay`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount:        booking.rate * Math.max(
            1,
            Math.ceil(
              (new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) /
                (1000 * 60 * 60 * 24),
            ),
          ),
          paymentMethod: billingPayMethod,
          ...(billingPayMethod === 'cash' && billingCashSessId
            ? { cashSessionId: billingCashSessId }
            : {}),
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string; receipt?: ReceiptData };
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
      setBillingPayOpen(false);
      onRefresh();
      // Reload billing tab invoices & show receipt
      await loadBillingInvoices(booking.id);
      if (data.receipt) setReceiptData(data.receipt);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setBillingPayLoading(false);
    }
  };

  /** Fetch and open the proforma A4 invoice from booking data (no DB invoice). */
  const handleProformaPrint = async (bkId: string) => {
    try {
      const res  = await fetch(`/api/bookings/${bkId}/proforma`);
      const data = await res.json() as { document?: InvoiceDocumentData; error?: string };
      if (!res.ok || !data.document) throw new Error(data.error ?? 'ไม่พบข้อมูล');
      setInvoiceDoc(data.document);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดใบแจ้งหนี้ได้');
    }
  };

  const handleReprint = async (invoiceId: string) => {
    try {
      const res  = await fetch(`/api/invoices/${invoiceId}/receipt`);
      const data = await res.json() as { receipt?: ReceiptData; error?: string };
      if (!res.ok || !data.receipt) throw new Error(data.error ?? 'ไม่พบข้อมูล');
      setReprintData(data.receipt);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดใบเสร็จได้');
    }
  };

  const handleInvoicePrint = async (invoiceId: string) => {
    try {
      const res  = await fetch(`/api/invoices/${invoiceId}/document`);
      const data = await res.json() as { document?: InvoiceDocumentData; error?: string };
      if (!res.ok || !data.document) throw new Error(data.error ?? 'ไม่พบข้อมูล');
      setInvoiceDoc(data.document);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดใบแจ้งหนี้ได้');
    }
  };

  // ── Check-in with payment ────────────────────────────────────────────────
  const handleCheckinConfirm = async (): Promise<void> => {
    if (!booking || loading) return;
    setLoading(true);
    setError('');
    try {
      const payload: Record<string, unknown> = { bookingId: booking.id };

      if (depositAmount > 0) {
        payload.depositAmount = depositAmount;
        payload.depositPaymentMethod = depositMethod;
        if (depositMethod === 'cash' && cashSessionId) {
          payload.depositCashSessionId = cashSessionId;
        }
      }
      if (collectUpfront && booking.bookingType === 'daily') {
        payload.collectUpfront = true;
        payload.upfrontPaymentMethod = upfrontMethod;
        if (upfrontMethod === 'cash' && cashSessionId) {
          payload.cashSessionId = cashSessionId;
        }
      }

      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { success?: boolean; error?: string; receipt?: ReceiptData };
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setCheckinStep('idle');
      setLoading(false);
      onRefresh();
      // Show receipt if payment was collected
      if (data.receipt) {
        setReceiptData(data.receipt);
      } else {
        onClose();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
      setLoading(false);
    }
  };

  // ── Simple API actions (cancel only — checkout is now a multi-step flow) ──
  const handleApiAction = async (action: string): Promise<void> => {
    if (!booking || loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/bookings/${booking.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        let errMsg = `ข้อผิดพลาด HTTP ${response.status}`;
        try {
          const data: ApiError = await response.json();
          errMsg = data.message || errMsg;
        } catch { /* non-JSON */ }
        throw new Error(errMsg);
      }
      onClose();
      onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      setLoading(false);
    }
  };

  // ── Checkout: confirm & call proper folio-based checkout route ─────────────
  const handleCheckoutConfirm = async (): Promise<void> => {
    if (!booking || loading) return;
    setLoading(true);
    setError('');
    try {
      const payload: Record<string, unknown> = { bookingId: booking.id };

      // Only add payment info when there's an outstanding balance
      if (checkoutOutstanding > 0) {
        payload.paymentMethod = checkoutPayMethod;
        if (checkoutPayMethod === 'cash' && checkoutCashSessionId) {
          payload.cashSessionId = checkoutCashSessionId;
        }
      }

      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { success?: boolean; error?: string; receipt?: ReceiptData };
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setCheckoutStep('idle');
      onRefresh();
      if (data.receipt) {
        setReceiptData(data.receipt);
      } else {
        onClose();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
      setLoading(false);
    }
  };

  const handleCancel = async (): Promise<void> => {
    if (!window.confirm('ยืนยันการยกเลิกการจอง?')) return;
    await handleApiAction('cancel');
  };

  const handleEdit = (): void => {
    if (!booking) return;
    window.open(`/checkin?bookingId=${booking.id}`, '_blank');
  };

  const nights    = booking ? diffDays(parseUTCDate(booking.checkIn), parseUTCDate(booking.checkOut)) : 0;
  const total     = booking ? nights * booking.rate : 0;
  const statusStyle = booking ? STATUS_STYLE[booking.status] : null;

  // Outstanding balance that will be collected at checkout.
  // Prefer the live folio balance (fetched when checkout step opens) — it correctly
  // reflects payments already made at check-in or from the billing tab.
  // Fall back to booking.totalPaid calculation only when folio hasn't loaded yet.
  const checkoutOutstanding =
    checkoutFolioBalance !== null
      ? checkoutFolioBalance
      : booking
        ? Math.max(0, total - (booking.totalPaid ?? 0))
        : 0;
  const checkoutCashMissing =
    checkoutOutstanding > 0 &&
    checkoutPayMethod === 'cash' &&
    !checkoutCashSessionId;

  // Whether cash is required but no session found
  const cashRequired = (depositMethod === 'cash' && depositAmount > 0) ||
                       (collectUpfront && upfrontMethod === 'cash');
  const cashMissing  = cashRequired && !cashSessionId;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 40,
          }}
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, height: '100%', width: 400,
          backgroundColor: '#fff', boxShadow: '-4px 0 12px rgba(0,0,0,0.15)',
          zIndex: 50, display: 'flex', flexDirection: 'column',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s ease', fontFamily: FONT,
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
            {statusStyle && (
              <div style={{ backgroundColor: statusStyle.bg, color: statusStyle.text, border: `2px solid ${statusStyle.border}`, borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {statusStyle.label}
              </div>
            )}
            {booking && (
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1f2937' }}>
                BK-{booking.bookingNumber}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 24, color: '#9ca3af', cursor: 'pointer', padding: 0, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ×
          </button>
        </div>

        {/* Tab Navigation */}
        {booking && checkinStep === 'idle' && checkoutStep === 'idle' && (
          <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', padding: '0 20px' }}>
            {(['details', 'billing', 'activity'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '8px 12px', fontSize: 13,
                  fontWeight: activeTab === tab ? 700 : 500,
                  color: activeTab === tab ? '#4f46e5' : '#6b7280',
                  background: 'none', border: 'none',
                  borderBottom: activeTab === tab ? '2px solid #4f46e5' : '2px solid transparent',
                  cursor: 'pointer', fontFamily: FONT, marginBottom: -1,
                }}
              >
                {tab === 'details' ? 'รายละเอียด' : tab === 'billing' ? '💳 บิล' : '📋 ประวัติ'}
              </button>
            ))}
          </div>
        )}

        {/* ── CHECK-IN PAYMENT STEP header ── */}
        {booking && checkinStep !== 'idle' && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10, backgroundColor: '#f0fdf4' }}>
            <span style={{ fontSize: 18 }}>🏨</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#166534' }}>เช็คอิน — ห้อง {room?.number}</div>
              <div style={{ fontSize: 11, color: '#4ade80' }}>
                {checkinStep === 'payment' ? 'ขั้นที่ 1: กรอกข้อมูลการรับเงิน' : 'ขั้นที่ 2: ยืนยันการเช็คอิน'}
              </div>
            </div>
          </div>
        )}

        {/* ── CHECK-OUT COLLECT STEP header ── */}
        {booking && checkoutStep === 'collect' && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10, backgroundColor: '#eff6ff' }}>
            <span style={{ fontSize: 18 }}>🧳</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>เช็คเอาท์ — ห้อง {room?.number}</div>
              <div style={{ fontSize: 11, color: '#60a5fa' }}>
                {checkoutFolioBalance === null && checkoutStep === 'collect'
                  ? 'กำลังตรวจสอบยอดค้างชำระ...'
                  : checkoutOutstanding > 0
                    ? `ยอดค้างชำระ ${fmtCurrency(checkoutOutstanding)} — เลือกช่องทางชำระ`
                    : 'ชำระครบแล้ว — กดยืนยันเพื่อเช็คเอาท์'}
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', fontSize: 13, color: '#374151' }}>
          {booking && room ? (
            <>
              {/* ─── PAYMENT COLLECTION STEP ─────────────────────────────────── */}
              {checkinStep === 'payment' && (
                <div>
                  <p style={{ margin: '0 0 16px', fontSize: 13, color: '#374151' }}>
                    ระบุยอดรับเงิน ณ เช็คอิน (ถ้ามี) แล้วกด <strong>ถัดไป</strong>
                  </p>

                  {/* Upfront payment — daily only, hidden when already fully/partially paid */}
                  {booking.bookingType === 'daily' && booking.paymentLevel === 'pending' && (
                    <div style={{ marginBottom: 16, padding: '12px 14px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={collectUpfront}
                          onChange={e => setCollectUpfront(e.target.checked)}
                          style={{ width: 15, height: 15 }}
                        />
                        <span style={{ fontWeight: 600, color: '#1f2937' }}>
                          เก็บเงินเต็มจำนวน {fmtCurrency(total)} ตอนนี้เลย
                        </span>
                      </label>
                      {collectUpfront && (
                        <div style={{ marginTop: 10, paddingLeft: 22 }}>
                          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>ช่องทางชำระ</div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {PAYMENT_METHODS.map(pm => (
                              <button
                                key={pm.value}
                                onClick={() => setUpfrontMethod(pm.value)}
                                style={{
                                  padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                                  border: `1.5px solid ${upfrontMethod === pm.value ? '#2563eb' : '#e5e7eb'}`,
                                  background: upfrontMethod === pm.value ? '#dbeafe' : '#fff',
                                  color: upfrontMethod === pm.value ? '#2563eb' : '#6b7280',
                                  cursor: 'pointer',
                                }}
                              >
                                {pm.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Already paid notice — shown instead of upfront checkbox */}
                  {booking.bookingType === 'daily' && booking.paymentLevel === 'fully_paid' && (
                    <div style={{ marginBottom: 16, padding: '12px 14px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #86efac', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>✅</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#166534' }}>ชำระเงินครบแล้ว</div>
                        <div style={{ fontSize: 11, color: '#4ade80' }}>
                          รับ {fmtCurrency(booking.totalPaid)} ณ วันจอง (INV-BK) — ไม่ต้องเก็บเงินซ้ำ
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Partial deposit notice */}
                  {booking.bookingType === 'daily' && booking.paymentLevel === 'deposit_paid' && (
                    <div style={{ marginBottom: 16, padding: '12px 14px', background: '#fefce8', borderRadius: 8, border: '1px solid #fde047', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>⚠️</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#854d0e' }}>รับมัดจำแล้ว {fmtCurrency(booking.totalPaid)}</div>
                        <div style={{ fontSize: 11, color: '#a16207' }}>
                          ยอดคงเหลือ {fmtCurrency(total - booking.totalPaid)} จะเก็บอัตโนมัติ ณ เช็คเอาท์
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Security Deposit */}
                  <div style={{ marginBottom: 16, padding: '12px 14px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
                      🔒 มัดจำ (Security Deposit)
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 12, color: '#6b7280', minWidth: 36 }}>฿</span>
                      <input
                        type="number"
                        min="0"
                        value={depositAmount || ''}
                        placeholder="0"
                        onChange={e => setDepositAmount(parseInt(e.target.value) || 0)}
                        style={{
                          flex: 1, padding: '7px 10px', border: '1.5px solid #e5e7eb',
                          borderRadius: 6, fontSize: 13, fontFamily: FONT, outline: 'none',
                        }}
                        onFocus={e => (e.target.style.borderColor = '#16a34a')}
                        onBlur={e => (e.target.style.borderColor = '#e5e7eb')}
                      />
                    </div>
                    {depositAmount > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {PAYMENT_METHODS.map(pm => (
                          <button
                            key={pm.value}
                            onClick={() => setDepositMethod(pm.value)}
                            style={{
                              padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                              border: `1.5px solid ${depositMethod === pm.value ? '#16a34a' : '#e5e7eb'}`,
                              background: depositMethod === pm.value ? '#dcfce7' : '#fff',
                              color: depositMethod === pm.value ? '#16a34a' : '#6b7280',
                              cursor: 'pointer',
                            }}
                          >
                            {pm.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Cash session warning */}
                  {cashMissing && (
                    <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12, color: '#b91c1c' }}>
                      ⚠️ ยังไม่มีกะแคชเชียร์ที่เปิดอยู่ — กรุณาไปที่เมนู <strong>แคชเชียร์</strong> และเปิดกะก่อน หรือเลือกช่องทางชำระอื่น
                    </div>
                  )}

                  {/* Error */}
                  {error && (
                    <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fee2e2', borderRadius: 8, fontSize: 12, color: '#991b1b' }}>
                      {error}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => { setCheckinStep('idle'); setError(''); }}
                      style={{ flex: 1, padding: '10px', borderRadius: 6, background: '#e5e7eb', color: '#1f2937', border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: FONT }}
                    >
                      ยกเลิก
                    </button>
                    <button
                      onClick={() => { setError(''); setCheckinStep('confirm'); }}
                      disabled={cashMissing}
                      style={{
                        flex: 2, padding: '10px', borderRadius: 6, background: cashMissing ? '#d1fae5' : '#22c55e',
                        color: '#fff', border: 'none', fontSize: 13, fontWeight: 700,
                        cursor: cashMissing ? 'not-allowed' : 'pointer', fontFamily: FONT,
                        opacity: cashMissing ? 0.5 : 1,
                      }}
                    >
                      ถัดไป →
                    </button>
                  </div>
                </div>
              )}

              {/* ─── CONFIRM STEP ─────────────────────────────────────────────── */}
              {checkinStep === 'confirm' && (
                <div>
                  {/* Summary card */}
                  <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#166534', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      สรุปการเช็คอิน
                    </div>
                    <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#6b7280' }}>ผู้เข้าพัก</span>
                        <span style={{ fontWeight: 600, color: '#1f2937' }}>{guestDisplayName(booking.guest)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#6b7280' }}>ห้อง</span>
                        <span style={{ fontWeight: 600, color: '#1f2937' }}>#{room.number}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#6b7280' }}>เข้าพัก</span>
                        <span style={{ color: '#1f2937' }}>{fmtThaiLong(booking.checkIn)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#6b7280' }}>เช็คเอาท์</span>
                        <span style={{ color: '#1f2937' }}>{fmtThaiLong(booking.checkOut)}</span>
                      </div>
                      {(depositAmount > 0 || collectUpfront) && (
                        <div style={{ borderTop: '1px solid #86efac', marginTop: 4, paddingTop: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#166534', marginBottom: 6 }}>💰 รับเงิน ณ เช็คอิน</div>
                          {depositAmount > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ color: '#6b7280' }}>มัดจำ ({PAYMENT_METHODS.find(p => p.value === depositMethod)?.label})</span>
                              <span style={{ fontWeight: 700, color: '#166534' }}>{fmtCurrency(depositAmount)}</span>
                            </div>
                          )}
                          {collectUpfront && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: '#6b7280' }}>ชำระเต็มจำนวน ({PAYMENT_METHODS.find(p => p.value === upfrontMethod)?.label})</span>
                              <span style={{ fontWeight: 700, color: '#166534' }}>{fmtCurrency(total)}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Error */}
                  {error && (
                    <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fee2e2', borderRadius: 8, fontSize: 12, color: '#991b1b' }}>
                      {error}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => { setCheckinStep('payment'); setError(''); }}
                      disabled={loading}
                      style={{ flex: 1, padding: '10px', borderRadius: 6, background: '#e5e7eb', color: '#1f2937', border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: FONT }}
                    >
                      ← แก้ไข
                    </button>
                    <button
                      onClick={handleCheckinConfirm}
                      disabled={loading}
                      style={{
                        flex: 2, padding: '10px', borderRadius: 6, background: '#22c55e',
                        color: '#fff', border: 'none', fontSize: 13, fontWeight: 700,
                        cursor: loading ? 'not-allowed' : 'pointer', fontFamily: FONT,
                        opacity: loading ? 0.6 : 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}
                    >
                      {loading ? '⏳ กำลังดำเนินการ...' : '✅ ยืนยันเช็คอิน'}
                    </button>
                  </div>
                </div>
              )}

              {/* ─── CHECKOUT COLLECT STEP ───────────────────────────────────── */}
              {checkoutStep === 'collect' && (
                <div>
                  {/* Outstanding summary */}
                  <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      สรุปยอดเช็คเอาท์
                    </div>
                    <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#6b7280' }}>ค่าห้อง ({nights} คืน × {fmtCurrency(booking?.rate ?? 0)})</span>
                        <span style={{ fontWeight: 600 }}>{fmtCurrency(total)}</span>
                      </div>
                      {(booking?.totalPaid ?? 0) > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#6b7280' }}>หักมัดจำ / ชำระล่วงหน้า</span>
                          <span style={{ fontWeight: 600, color: '#16a34a' }}>−{fmtCurrency(booking?.totalPaid ?? 0)}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #bfdbfe', paddingTop: 8, marginTop: 2 }}>
                        <span style={{ fontWeight: 700, color: '#1e40af' }}>ยอดค้างชำระ</span>
                        <span style={{ fontWeight: 700, fontSize: 15, color: checkoutOutstanding > 0 ? '#dc2626' : '#16a34a' }}>
                          {fmtCurrency(checkoutOutstanding)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Payment method — only show when there's an outstanding balance */}
                  {checkoutOutstanding > 0 ? (
                    <div style={{ marginBottom: 16, padding: '12px 14px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
                        💳 ช่องทางชำระเงิน
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {PAYMENT_METHODS.map(pm => (
                          <button
                            key={pm.value}
                            onClick={() => setCheckoutPayMethod(pm.value)}
                            style={{
                              padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                              border: `1.5px solid ${checkoutPayMethod === pm.value ? '#2563eb' : '#e5e7eb'}`,
                              background: checkoutPayMethod === pm.value ? '#dbeafe' : '#fff',
                              color: checkoutPayMethod === pm.value ? '#2563eb' : '#6b7280',
                              cursor: 'pointer',
                            }}
                          >
                            {pm.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginBottom: 16, padding: '12px 14px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #86efac', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>✅</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#166534' }}>ชำระครบแล้ว</div>
                        <div style={{ fontSize: 11, color: '#4ade80' }}>ไม่มียอดค้างชำระ — กดยืนยันเพื่อเช็คเอาท์</div>
                      </div>
                    </div>
                  )}

                  {/* Cash session warning */}
                  {checkoutCashMissing && (
                    <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12, color: '#b91c1c' }}>
                      ⚠️ ยังไม่มีกะแคชเชียร์ที่เปิดอยู่ — กรุณาไปที่เมนู <strong>แคชเชียร์</strong> และเปิดกะก่อน หรือเลือกช่องทางชำระอื่น
                    </div>
                  )}

                  {error && (
                    <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fee2e2', borderRadius: 8, fontSize: 12, color: '#991b1b' }}>
                      {error}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => { setCheckoutStep('idle'); setError(''); }}
                      disabled={loading}
                      style={{ flex: 1, padding: '10px', borderRadius: 6, background: '#e5e7eb', color: '#1f2937', border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: FONT }}
                    >
                      ยกเลิก
                    </button>
                    <button
                      onClick={handleCheckoutConfirm}
                      disabled={loading || checkoutCashMissing}
                      style={{
                        flex: 2, padding: '10px', borderRadius: 6,
                        background: checkoutCashMissing ? '#93c5fd' : '#3b82f6',
                        color: '#fff', border: 'none', fontSize: 13, fontWeight: 700,
                        cursor: (loading || checkoutCashMissing) ? 'not-allowed' : 'pointer',
                        opacity: (loading || checkoutCashMissing) ? 0.6 : 1,
                        fontFamily: FONT,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}
                    >
                      {loading ? '⏳ กำลังดำเนินการ...' : `🧳 ยืนยันเช็คเอาท์${checkoutOutstanding > 0 ? ` & รับ ${fmtCurrency(checkoutOutstanding)}` : ''}`}
                    </button>
                  </div>
                </div>
              )}

              {/* ─── DETAILS TAB (idle only) ──────────────────────────────────── */}
              {checkinStep === 'idle' && checkoutStep === 'idle' && activeTab === 'details' && (
                <>
                  {/* Guest Section */}
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      ผู้เข้าพัก
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 2 }}>ชื่อ</div>
                        <div style={{ fontSize: 13, color: '#1f2937' }}>{guestDisplayName(booking.guest)}</div>
                      </div>
                      {booking.guest.phone && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 2 }}>เบอร์โทร</div>
                          <div style={{ fontSize: 13, color: '#1f2937' }}>{booking.guest.phone}</div>
                        </div>
                      )}
                      {booking.guest.email && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 2 }}>อีเมล</div>
                          <div style={{ fontSize: 13, color: '#1f2937' }}>{booking.guest.email}</div>
                        </div>
                      )}
                      {booking.guest.nationality && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 2 }}>สัญชาติ</div>
                          <div style={{ fontSize: 13, color: '#1f2937' }}>{booking.guest.nationality}</div>
                        </div>
                      )}
                      {booking.guest.id && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 2 }}>เลขบัตร</div>
                          <div style={{ fontSize: 13, color: '#1f2937' }}>{booking.guest.id}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Booking Section */}
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      รายละเอียดการจอง
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 2 }}>ห้อง</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>{room.number}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 2 }}>ประเภทห้อง</div>
                          <div style={{ fontSize: 13, color: '#1f2937' }}>{room.id}</div>
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 2 }}>เข้าพัก</div>
                        <div style={{ fontSize: 13, color: '#1f2937' }}>{fmtThaiLong(booking.checkIn)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 2 }}>เช็คเอาท์</div>
                        <div style={{ fontSize: 13, color: '#1f2937' }}>{fmtThaiLong(booking.checkOut)}</div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 2 }}>ระยะเวลา</div>
                          <div style={{ fontSize: 13, color: '#1f2937' }}>{nights} {BOOKING_TYPE_LABEL[booking.bookingType]}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 2 }}>ประเภทการจอง</div>
                          <div style={{ fontSize: 13, color: '#1f2937' }}>{BOOKING_TYPE_LABEL[booking.bookingType]}</div>
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 2 }}>แหล่งที่มา</div>
                        <div style={{ fontSize: 13, color: '#1f2937' }}>{SOURCE_LABEL[booking.source]}</div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 2 }}>ราคา/คืน</div>
                          <div style={{ fontSize: 13, color: '#1f2937' }}>{fmtCurrency(booking.rate)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 2 }}>มัดจำ</div>
                          <div style={{ fontSize: 13, color: '#1f2937' }}>{fmtCurrency(booking.deposit)}</div>
                        </div>
                      </div>
                      <div style={{ paddingTop: 8, borderTop: '1px solid #e5e7eb' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 2 }}>รวมทั้งสิ้น</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#1f2937' }}>{fmtCurrency(total)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Notes */}
                  {booking.notes && (
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        หมายเหตุ
                      </div>
                      <div style={{ fontSize: 13, color: '#374151', backgroundColor: '#f9fafb', padding: 12, borderRadius: 6, lineHeight: 1.5 }}>
                        {booking.notes}
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {error && (
                    <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: 12, lineHeight: 1.4 }}>
                      {error}
                    </div>
                  )}
                </>
              )}

              {/* ── BILLING TAB ──────────────────────────────────────────────── */}
              {checkinStep === 'idle' && checkoutStep === 'idle' && activeTab === 'billing' && (
                <div>
                  {billingLoading ? (
                    <div style={{ textAlign: 'center', padding: 32, color: '#9ca3af', fontSize: 13 }}>กำลังโหลด...</div>
                  ) : billingInvoices.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 32, color: '#9ca3af', fontSize: 13 }}>ยังไม่มีใบแจ้งหนี้</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {billingInvoices.map((inv) => {
                        const st     = INV_STATUS_STYLE[inv.status] ?? INV_STATUS_STYLE['unpaid'];
                        const typeTH = INVOICE_TYPE_TH[inv.invoiceType] ?? inv.invoiceType;
                        const isPaid = inv.status === 'paid' || inv.status === 'partial';

                        return (
                          <div
                            key={inv.id}
                            style={{
                              border: `1px solid ${inv.isProforma ? '#ddd6fe' : '#e5e7eb'}`,
                              borderRadius: 8,
                              padding: '10px 12px',
                              backgroundColor: inv.isProforma ? '#faf9ff' : '#fff',
                            }}
                          >
                            {/* Invoice header row */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: '#1f2937' }}>{inv.invoiceNumber}</div>
                                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
                                  {typeTH}
                                  {inv.isProforma && (
                                    <span style={{ marginLeft: 6, fontSize: 10, color: '#7c3aed' }}>
                                      · รอชำระเงิน
                                    </span>
                                  )}
                                </div>
                              </div>
                              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, backgroundColor: st.bg, color: st.color }}>
                                {st.label}
                              </span>
                            </div>

                            {/* Amount row — proforma hides 0 amount since it's in the document */}
                            {!inv.isProforma && (
                              <div style={{ fontSize: 12, marginTop: 4, marginBottom: 8 }}>
                                <span style={{ color: '#6b7280' }}>ยอด: </span>
                                <span style={{ fontWeight: 700 }}>
                                  ฿{Number(inv.grandTotal).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                                {Number(inv.paidAmount) > 0 && Number(inv.paidAmount) < Number(inv.grandTotal) && (
                                  <span style={{ color: '#d97706', fontSize: 11, marginLeft: 4 }}>
                                    (ชำระแล้ว ฿{Number(inv.paidAmount).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Action buttons row */}
                            <div style={{ display: 'flex', gap: 6, marginTop: inv.isProforma ? 8 : 0 }}>
                              {/* Invoice print — always visible; proforma uses booking ID, real invoices use invoice ID */}
                              <button
                                onClick={() =>
                                  inv.isProforma && inv.bookingId
                                    ? handleProformaPrint(inv.bookingId)
                                    : handleInvoicePrint(inv.id)
                                }
                                style={{
                                  flex: 1,
                                  padding: '5px 0',
                                  fontSize: 11, fontWeight: 600,
                                  borderRadius: 6,
                                  border: `1.5px solid ${inv.isProforma ? '#7c3aed' : '#475569'}`,
                                  background: inv.isProforma ? '#f5f3ff' : '#f8fafc',
                                  color: inv.isProforma ? '#6d28d9' : '#334155',
                                  cursor: 'pointer',
                                  fontFamily: FONT,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                }}
                              >
                                📄 ใบแจ้งหนี้
                              </button>

                              {/* Pay now — shown on proforma (confirmed, unpaid) or unpaid real invoice */}
                              {(inv.isProforma || inv.status === 'unpaid') && (
                                <button
                                  onClick={() => setBillingPayOpen(o => !o)}
                                  style={{
                                    flex: 1,
                                    padding: '5px 0',
                                    fontSize: 11, fontWeight: 600,
                                    borderRadius: 6,
                                    border: '1.5px solid #16a34a',
                                    background: billingPayOpen ? '#dcfce7' : '#f0fdf4',
                                    color: '#15803d',
                                    cursor: 'pointer',
                                    fontFamily: FONT,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                  }}
                                >
                                  💳 รับชำระเงิน
                                </button>
                              )}

                              {/* Receipt reprint — only when actually paid; never for proforma */}
                              {!inv.isProforma && isPaid && (
                                <button
                                  onClick={() => handleReprint(inv.id)}
                                  style={{
                                    flex: 1,
                                    padding: '5px 0',
                                    fontSize: 11, fontWeight: 600,
                                    borderRadius: 6,
                                    border: '1.5px solid #2563eb',
                                    background: '#eff6ff',
                                    color: '#1d4ed8',
                                    cursor: 'pointer',
                                    fontFamily: FONT,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                  }}
                                >
                                  🧾 ใบเสร็จ
                                </button>
                              )}
                            </div>

                            {/* ── Inline payment form (shared across all cards, only one open) ── */}
                            {(inv.isProforma || inv.status === 'unpaid') && billingPayOpen && (
                              <div style={{ marginTop: 10, padding: '10px 12px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #86efac' }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: '#166534', marginBottom: 8 }}>💳 เลือกช่องทางชำระเงิน</div>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                                  {PAYMENT_METHODS.map(pm => (
                                    <button
                                      key={pm.value}
                                      onClick={() => setBillingPayMethod(pm.value)}
                                      style={{
                                        padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                                        border: `1.5px solid ${billingPayMethod === pm.value ? '#16a34a' : '#e5e7eb'}`,
                                        background: billingPayMethod === pm.value ? '#dcfce7' : '#fff',
                                        color: billingPayMethod === pm.value ? '#15803d' : '#6b7280',
                                        cursor: 'pointer', fontFamily: FONT,
                                      }}
                                    >
                                      {pm.label}
                                    </button>
                                  ))}
                                </div>
                                {billingPayMethod === 'cash' && !billingCashSessId && (
                                  <div style={{ marginBottom: 8, fontSize: 11, color: '#b91c1c', padding: '6px 8px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fca5a5' }}>
                                    ⚠️ ยังไม่มีกะแคชเชียร์ที่เปิดอยู่ — กรุณาเปิดกะก่อน
                                  </div>
                                )}
                                {error && (
                                  <div style={{ marginBottom: 8, fontSize: 11, color: '#991b1b', padding: '6px 8px', background: '#fee2e2', borderRadius: 6 }}>
                                    {error}
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button
                                    onClick={() => { setBillingPayOpen(false); setError(''); }}
                                    disabled={billingPayLoading}
                                    style={{ flex: 1, padding: '7px', borderRadius: 6, border: '1.5px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: FONT }}
                                  >
                                    ยกเลิก
                                  </button>
                                  <button
                                    onClick={handleBillingPay}
                                    disabled={billingPayLoading || (billingPayMethod === 'cash' && !billingCashSessId)}
                                    style={{
                                      flex: 2, padding: '7px', borderRadius: 6, border: 'none',
                                      background: (billingPayLoading || (billingPayMethod === 'cash' && !billingCashSessId)) ? '#86efac' : '#16a34a',
                                      color: '#fff', fontSize: 11, fontWeight: 700,
                                      cursor: billingPayLoading ? 'wait' : 'pointer', fontFamily: FONT,
                                    }}
                                  >
                                    {billingPayLoading ? '⏳ กำลังดำเนินการ...' : '✅ ยืนยันรับชำระเงิน'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── ACTIVITY TAB ─────────────────────────────────────────────── */}
              {checkinStep === 'idle' && checkoutStep === 'idle' && activeTab === 'activity' && (
                <div>
                  {logsLoading ? (
                    <div style={{ textAlign: 'center', padding: 32, color: '#9ca3af', fontSize: 13 }}>กำลังโหลด...</div>
                  ) : activityLogs.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 32, color: '#9ca3af', fontSize: 13 }}>ยังไม่มีประวัติการดำเนินการ</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                      {activityLogs.map((log, idx) => {
                        const severityColor: Record<string, string> = {
                          success: '#22c55e', warning: '#f59e0b', error: '#ef4444', info: '#6b7280',
                        };
                        const color = severityColor[log.severity] ?? '#6b7280';
                        return (
                          <div key={log.id} style={{ display: 'flex', gap: 12, paddingBottom: 16, position: 'relative' }}>
                            {idx < activityLogs.length - 1 && (
                              <div style={{ position: 'absolute', left: 15, top: 30, bottom: 0, width: 2, backgroundColor: '#e5e7eb' }} />
                            )}
                            <div style={{ width: 30, height: 30, borderRadius: '50%', backgroundColor: '#f3f4f6', border: `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, zIndex: 1 }}>
                              {log.icon}
                            </div>
                            <div style={{ flex: 1, paddingTop: 3 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: '#1f2937', lineHeight: 1.4 }}>{log.description}</div>
                              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>
                                {log.userName ?? 'ระบบ'} · {fmtDateTime(log.createdAt)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* ─── Actions Footer (idle state only) ────────────────────────────────── */}
        {booking && checkinStep === 'idle' && checkoutStep === 'idle' && (
          <div style={{ padding: '16px 20px', borderTop: '1px solid #e5e7eb', display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
            {booking.status === 'confirmed' && (
              <button
                onClick={() => { setError(''); setCheckinStep('payment'); }}
                disabled={loading}
                style={{ padding: '10px 12px', backgroundColor: '#22c55e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, fontFamily: FONT }}
              >
                เช็คอิน
              </button>
            )}

            {booking.status === 'checked_in' && (
              <button
                onClick={() => { setError(''); setCheckoutStep('collect'); }}
                disabled={loading}
                style={{ padding: '10px 12px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, fontFamily: FONT }}
              >
                🧳 เช็คเอาท์
              </button>
            )}

            {(booking.status === 'confirmed' || booking.status === 'checked_in') && (
              <button
                onClick={handleEdit}
                disabled={loading}
                style={{ padding: '10px 12px', backgroundColor: '#9ca3af', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, fontFamily: FONT }}
              >
                แก้ไข
              </button>
            )}

            {booking.status !== 'cancelled' && booking.status !== 'checked_out' && (
              <button
                onClick={handleCancel}
                disabled={loading}
                style={{ padding: '10px 12px', backgroundColor: '#fff', color: '#dc2626', border: '2px solid #dc2626', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, fontFamily: FONT }}
              >
                ยกเลิก
              </button>
            )}
          </div>
        )}

        {/* Loading Overlay */}
        {loading && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}
      </div>

      {/* Receipt Modal — shown after any payment action */}
      <ReceiptModal
        receipt={receiptData}
        onClose={() => { setReceiptData(null); onClose(); }}
      />

      {/* Reprint Modal — shown when reprinting from billing tab */}
      <ReceiptModal
        receipt={reprintData}
        isReprint
        onClose={() => setReprintData(null)}
      />

      {/* Invoice Modal — A4 ใบแจ้งหนี้ print */}
      <InvoiceModal
        document={invoiceDoc}
        isReprint={false}
        onClose={() => setInvoiceDoc(null)}
      />
    </>
  );
}
