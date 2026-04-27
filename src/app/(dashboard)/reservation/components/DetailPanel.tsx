'use client';

import { useState, useEffect } from 'react';
import type { BookingItem, RoomItem } from '../lib/types';
import { STATUS_STYLE, BOOKING_TYPE_LABEL, SOURCE_LABEL, FONT } from '../lib/constants';
import { fmtThaiLong, fmtCurrency, guestDisplayName, diffDays, parseUTCDate } from '../lib/date-utils';
import { fmtDate, fmtDateTime, fmtBaht } from '@/lib/date-format';
import ReceiptModal from '@/components/receipt/ReceiptModal';
import type { ReceiptData } from '@/components/receipt/types';
import { ReceivingAccountPicker } from '@/components/payment/ReceivingAccountPicker';
import InvoiceModal from '@/components/invoice/InvoiceModal';
import MoveRoomDialog from './MoveRoomDialog';
import SplitSegmentDialog from './SplitSegmentDialog';
import type { InvoiceDocumentData } from '@/components/invoice/types';
import { useToast, ConfirmDialog } from '@/components/ui';
import CancelBookingDialog, { CancelConfirmInput } from './CancelBookingDialog';
import RequestCleaningDialog from '../../housekeeping/components/RequestCleaningDialog';
import ScheduleDialog from '../../housekeeping/components/ScheduleDialog';
import CheckoutContractGuard from './CheckoutContractGuard';

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

// Minimal shapes for the HK section — only fields we actually render.
interface HkTaskLite {
  id:             string;
  taskNumber:     string;
  taskType:       string;
  status:         string;
  scheduledAt:    string;
  chargeable:     boolean;
  fee:            number | string | null;
  requestSource:  string;
  requestChannel: string | null;
}

interface HkScheduleLite {
  id:          string;
  cadenceDays: number | null;
  weekdays:    number | null;
  timeOfDay:   string | null;
  activeFrom:  string;
  activeUntil: string | null;
  fee:         number | string | null;
  chargeable:  boolean;
  isActive:    boolean;
}

const HK_STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  pending:     { label: 'รอทำ',     color: '#f59e0b', bg: '#fef3c7' },
  in_progress: { label: 'กำลังทำ',  color: '#3b82f6', bg: '#dbeafe' },
  completed:   { label: 'เสร็จแล้ว', color: '#22c55e', bg: '#dcfce7' },
  inspected:   { label: 'ตรวจแล้ว', color: '#8b5cf6', bg: '#ede9fe' },
  cancelled:   { label: 'ยกเลิก',   color: '#64748b', bg: '#f1f5f9' },
};

const HK_CHANNEL_ICON: Record<string, string> = {
  door_sign:  '🏷️',
  phone:      '📞',
  guest_app:  '📱',
  front_desk: '🛎️',
  system:     '🤖',
};

const HK_WEEKDAY_BITS: Array<{ bit: number; short: string }> = [
  { bit: 1, short: 'จ.' }, { bit: 2,  short: 'อ.' }, { bit: 4,  short: 'พ.' },
  { bit: 8, short: 'พฤ.' }, { bit: 16, short: 'ศ.' }, { bit: 32, short: 'ส.' },
  { bit: 64, short: 'อา.' },
];

function hkScheduleLabel(s: HkScheduleLite): string {
  if (s.cadenceDays) return `ทุก ${s.cadenceDays} วัน`;
  if (s.weekdays) {
    const days = HK_WEEKDAY_BITS.filter(w => (s.weekdays! & w.bit) !== 0).map(w => w.short).join(', ');
    return days || '—';
  }
  return '—';
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

// Payment methods accepted by the add-service endpoint
const SVC_PAYMENT_METHODS = [
  { value: 'cash',          label: '💵 เงินสด' },
  { value: 'credit_card',   label: '💳 บัตรเครดิต' },
  { value: 'bank_transfer', label: '🏦 โอนเงิน' },
  { value: 'qr_code',       label: '📱 QR Code' },
];

export default function DetailPanel({
  booking,
  room,
  onClose,
  onRefresh,
}: DetailPanelProps): JSX.Element {
  const toast = useToast();
  const [loading, setLoading]         = useState<boolean>(false);
  const [error, setError]             = useState<string>('');
  const [activeTab, setActiveTab]     = useState<'details' | 'activity' | 'billing'>('details');
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // ── Billing tab: invoice list ─────────────────────────────────────────────
  const [moveDialogOpen, setMoveDialogOpen]   = useState(false);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  // ── Housekeeping (Sprint 2b) ──────────────────────────────────────────────
  const [hkTasks,          setHkTasks]          = useState<HkTaskLite[]>([]);
  const [hkSchedules,      setHkSchedules]      = useState<HkScheduleLite[]>([]);
  const [hkLoading,        setHkLoading]        = useState(false);
  const [hkRequestOpen,    setHkRequestOpen]    = useState(false);
  const [hkScheduleOpen,   setHkScheduleOpen]   = useState(false);
  const [hkDeclineTaskId,  setHkDeclineTaskId]  = useState<string | null>(null);
  const [hkDeclineBusy,    setHkDeclineBusy]    = useState(false);
  const [billingInvoices, setBillingInvoices] = useState<BillingInvoice[]>([]);
  const [billingLoading, setBillingLoading]   = useState(false);
  const [reprintData,  setReprintData]        = useState<ReceiptData | null>(null);
  const [invoiceDoc,   setInvoiceDoc]         = useState<InvoiceDocumentData | null>(null);

  // ── Billing tab: inline payment form ──────────────────────────────────────
  const [billingPayOpen,    setBillingPayOpen]    = useState(false);
  const [billingPayMethod,  setBillingPayMethod]  = useState<string>('cash');
  const [billingCashSessId, setBillingCashSessId] = useState<string | null>(null);
  // Tracks whether the /api/cash-sessions/current fetch has resolved at least
  // once. Without this, the form briefly renders the "ยังไม่มีกะ..." warning
  // before the GET completes -- a one-frame flash that confuses the cashier.
  const [billingCashSessChecked, setBillingCashSessChecked] = useState(false);
  const [billingPayLoading, setBillingPayLoading] = useState(false);
  // Transfer / promptpay — receiving account is required by the server.
  // Auto-defaulted by ReceivingAccountPicker when there's only one bank
  // account (or one is flagged isDefault).
  const [billingReceivingAccountId, setBillingReceivingAccountId] = useState<string | undefined>();

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
  // Shared bank-account picker state for ANY transfer in the check-in flow
  // (deposit, upfront).  Auto-defaulted by ReceivingAccountPicker.
  const [checkinReceivingAccountId, setCheckinReceivingAccountId] = useState<string | undefined>();
  // Same idea for the extend / checkout / checkout-collect flows below.
  const [extendReceivingAccountId,  setExtendReceivingAccountId]  = useState<string | undefined>();
  const [checkoutReceivingAccountId, setCheckoutReceivingAccountId] = useState<string | undefined>();

  // ── Check-out payment step ────────────────────────────────────────────────
  // 'idle'      → normal action buttons
  // 'collect'   → show outstanding + payment method selection
  // 'bad_debt'  → bad-debt reason form (checkout without collecting payment)
  const [checkoutStep,          setCheckoutStep]          = useState<'idle' | 'collect' | 'bad_debt'>('idle');
  const [badDebtNote,           setBadDebtNote]           = useState<string>('');
  const [checkoutPayMethod,     setCheckoutPayMethod]     = useState<string>('cash');
  const [checkoutCashSessionId, setCheckoutCashSessionId] = useState<string | null>(null);
  // Actual outstanding fetched from folio (replaces stale booking.totalPaid calculation)
  const [checkoutFolioBalance,  setCheckoutFolioBalance]  = useState<number | null>(null);
  // Separate loading flag so we can distinguish "still fetching" vs "fetched but no folio"
  const [folioBalanceLoading,   setFolioBalanceLoading]   = useState<boolean>(false);
  // T14: true when an active contract blocks checkout until it's terminated.
  // Set by <CheckoutContractGuard/> via onBlockingChange. Daily bookings never
  // reach this branch because the guard is not mounted for bookingType='daily'.
  const [contractBlockingCheckout, setContractBlockingCheckout] = useState<boolean>(false);

  // ── Extend booking step ───────────────────────────────────────────────────
  // 'idle'    → normal action buttons
  // 'form'    → date picker + charge preview
  // 'payment' → choose to collect now or pay later
  const [extendStep,        setExtendStep]        = useState<'idle' | 'form' | 'payment'>('idle');
  const [extendNewCheckOut, setExtendNewCheckOut] = useState<string>('');
  const [extendNewRate,     setExtendNewRate]      = useState<string>('');
  const [extendCollectNow,  setExtendCollectNow]   = useState<boolean>(true);
  const [extendPayMethod,   setExtendPayMethod]    = useState<string>('cash');
  const [extendCashSessId,  setExtendCashSessId]   = useState<string | null>(null);
  const [extendNotes,       setExtendNotes]        = useState<string>('');

  // ── Add Extra Service step ────────────────────────────────────────────────
  // 'idle'    → normal action buttons
  // 'form'    → product catalogue + cart
  // 'payment' → collect now / later + method
  const [serviceStep,      setServiceStep]      = useState<'idle' | 'form' | 'payment'>('idle');
  // Cart items
  const [svcCart,          setSvcCart]          = useState<{ tempId: string; description: string; qty: number; unitPrice: number; unit?: string }[]>([]);
  // Currently selected product / manual entry (pending add to cart)
  const [svcPendingDesc,   setSvcPendingDesc]   = useState<string>('');
  const [svcPendingPrice,  setSvcPendingPrice]  = useState<number>(0);
  const [svcPendingUnit,   setSvcPendingUnit]   = useState<string>('');
  const [svcPendingQty,    setSvcPendingQty]    = useState<number>(1);
  // Payment
  const [svcCollectNow,    setSvcCollectNow]    = useState<boolean>(true);
  const [svcPayMethod,     setSvcPayMethod]     = useState<string>('cash');
  const [svcCashSessId,    setSvcCashSessId]    = useState<string>('');
  const [svcNotes,         setSvcNotes]         = useState<string>('');
  // Product catalogue
  const [svcProducts,      setSvcProducts]      = useState<{ id: string; name: string; price: number; unit?: string; category: string }[]>([]);
  const [svcSearch,        setSvcSearch]        = useState<string>('');

  // ── Receipt modal ─────────────────────────────────────────────────────────
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);

  const isOpen = booking !== null && room !== null;

  // Reset all steps when panel opens a new booking.
  // IMPORTANT: loading states MUST be reset here too — if an in-flight
  // request never completed (network error, unmount, etc.) the loading flag
  // stays true and disables every button in the newly-opened panel.
  useEffect(() => {
    setLoading(false);
    setLogsLoading(false);
    setBillingLoading(false);
    setBillingPayLoading(false);
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
    setFolioBalanceLoading(false);
    setContractBlockingCheckout(false);
    setBadDebtNote('');
    setExtendStep('idle');
    setExtendNewCheckOut('');
    setExtendNewRate('');
    setExtendCollectNow(true);
    setExtendPayMethod('cash');
    setExtendCashSessId(null);
    setExtendNotes('');
    setServiceStep('idle');
    setSvcCart([]);
    setSvcPendingDesc('');
    setSvcPendingPrice(0);
    setSvcPendingUnit('');
    setSvcPendingQty(1);
    setSvcCollectNow(true);
    setSvcPayMethod('cash');
    setSvcCashSessId('');
    setSvcNotes('');
    setSvcProducts([]);
    setSvcSearch('');
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

  // Auto-fetch current open cash session for extend payment
  useEffect(() => {
    if (extendStep !== 'payment' || !extendCollectNow || extendPayMethod !== 'cash') {
      setExtendCashSessId(null);
      return;
    }
    fetch('/api/cash-sessions/current')
      .then(r => r.json())
      .then(d => setExtendCashSessId(d.session?.id ?? null))
      .catch(() => setExtendCashSessId(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extendPayMethod, extendCollectNow, extendStep, booking?.id]);

  // Fetch product catalogue when entering the service form step
  useEffect(() => {
    if (serviceStep !== 'form') return;
    fetch('/api/products')
      .then(r => r.json())
      .then((products: { id: string; name: string; price: number; unit?: string; category: string }[]) => setSvcProducts(products))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceStep]);

  // Auto-fetch current open cash session for add-service payment
  useEffect(() => {
    if (serviceStep !== 'payment' || !svcCollectNow || svcPayMethod !== 'cash') {
      setSvcCashSessId('');
      return;
    }
    fetch('/api/cash-sessions/current')
      .then(r => r.json())
      .then(d => setSvcCashSessId(d.session?.id ?? ''))
      .catch(() => setSvcCashSessId(''));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svcPayMethod, svcCollectNow, serviceStep, booking?.id]);

  // Fetch actual folio balance when entering checkout collect step.
  // Uses folioBalanceLoading (not checkoutFolioBalance===null) to drive the
  // "กำลังตรวจสอบ..." indicator so that a missing-folio result (null) no
  // longer leaves the spinner stuck forever.
  useEffect(() => {
    if (checkoutStep !== 'collect' || !booking?.id) return;
    setFolioBalanceLoading(true);
    setCheckoutFolioBalance(null);
    fetch(`/api/bookings/${booking.id}/folio`)
      .then(r => r.json())
      .then((folio: { balance?: number } | null) => {
        // folio.balance = totalCharges - totalPayments (from recalculateFolioBalance)
        const balance = folio ? Math.max(0, Number(folio.balance ?? 0)) : null;
        setCheckoutFolioBalance(balance);
      })
      .catch(() => setCheckoutFolioBalance(null))
      .finally(() => setFolioBalanceLoading(false));
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
    if (booking?.id && activeTab === 'details') {
      loadHkForBooking(booking.id);
    }
  }, [booking?.id, activeTab]);

  const loadHkForBooking = async (bookingId: string) => {
    setHkLoading(true);
    try {
      const [tasksRes, schedRes] = await Promise.all([
        fetch(`/api/housekeeping?bookingId=${encodeURIComponent(bookingId)}`),
        fetch(`/api/housekeeping/schedule?bookingId=${encodeURIComponent(bookingId)}&includeInactive=true`),
      ]);
      if (tasksRes.ok) {
        const tasks = await tasksRes.json() as HkTaskLite[];
        setHkTasks(Array.isArray(tasks) ? tasks.slice(0, 5) : []);
      } else {
        setHkTasks([]);
      }
      if (schedRes.ok) {
        const schedules = await schedRes.json() as HkScheduleLite[];
        setHkSchedules(Array.isArray(schedules) ? schedules : []);
      } else {
        setHkSchedules([]);
      }
    } catch {
      /* non-fatal — keep existing state */
    } finally {
      setHkLoading(false);
    }
  };

  const declineHkTask = async (taskId: string) => {
    if (hkDeclineBusy) return;
    setHkDeclineBusy(true);
    try {
      const res = await fetch(`/api/housekeeping/${taskId}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'front_desk' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success('บันทึกว่าแขกไม่ต้องการทำความสะอาดแล้ว');
      setHkDeclineTaskId(null);
      if (booking?.id) await loadHkForBooking(booking.id);
    } catch (e) {
      toast.error('ยกเลิกงานไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setHkDeclineBusy(false);
    }
  };

  const toggleScheduleActive = async (scheduleId: string, nextActive: boolean) => {
    try {
      const res = await fetch(`/api/housekeeping/schedule/${scheduleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: nextActive }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(nextActive ? 'เปิดรอบทำความสะอาดแล้ว' : 'ปิดรอบทำความสะอาดแล้ว');
      if (booking?.id) await loadHkForBooking(booking.id);
    } catch (e) {
      toast.error('ปรับสถานะรอบไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    }
  };

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
      setBillingCashSessChecked(false);
      return;
    }
    setBillingCashSessChecked(false);
    fetch('/api/cash-sessions/current')
      .then(r => r.json())
      .then(d => setBillingCashSessId(d.session?.id ?? null))
      .catch(() => setBillingCashSessId(null))
      .finally(() => setBillingCashSessChecked(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingPayOpen, billingPayMethod, booking?.id]);

  /** Collect payment from billing tab — works for confirmed or checked_in bookings. */
  const handleBillingPay = async () => {
    if (!booking || billingPayLoading) return;
    setBillingPayLoading(true);
    setError('');
    try {
      // Client-side guard: server validates again, but failing fast here
      // gives the cashier an immediate inline message instead of a roundtrip.
      if ((billingPayMethod === 'transfer' || billingPayMethod === 'promptpay')
          && !billingReceivingAccountId) {
        setBillingPayLoading(false);
        setError('กรุณาเลือกบัญชีที่รับเงิน');
        return;
      }
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
          // Sprint 4B: cashSessionId resolved server-side from caller's shift.
          paymentMethod: billingPayMethod,
          // Sprint 5: bank-transfer fields
          ...(billingPayMethod === 'transfer' || billingPayMethod === 'promptpay'
            ? { receivingAccountId: billingReceivingAccountId } : {}),
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string; receipt?: ReceiptData };
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
      setBillingPayOpen(false);
      onRefresh();
      // Reload billing tab invoices & show receipt
      await loadBillingInvoices(booking.id);
      if (data.receipt) setReceiptData(data.receipt);
      toast.success('บันทึกการชำระเงินสำเร็จ');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('ชำระเงินไม่สำเร็จ', msg);
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
      const msg = err instanceof Error ? err.message : 'ไม่สามารถโหลดใบแจ้งหนี้ได้';
      setError(msg);
      toast.error('โหลดใบแจ้งหนี้ไม่สำเร็จ', msg);
    }
  };

  const handleReprint = async (invoiceId: string) => {
    try {
      const res  = await fetch(`/api/invoices/${invoiceId}/receipt`);
      const data = await res.json() as { receipt?: ReceiptData; error?: string };
      if (!res.ok || !data.receipt) throw new Error(data.error ?? 'ไม่พบข้อมูล');
      setReprintData(data.receipt);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ไม่สามารถโหลดใบเสร็จได้';
      setError(msg);
      toast.error('โหลดใบเสร็จไม่สำเร็จ', msg);
    }
  };

  const handleInvoicePrint = async (invoiceId: string) => {
    try {
      const res  = await fetch(`/api/invoices/${invoiceId}/document`);
      const data = await res.json() as { document?: InvoiceDocumentData; error?: string };
      if (!res.ok || !data.document) throw new Error(data.error ?? 'ไม่พบข้อมูล');
      setInvoiceDoc(data.document);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ไม่สามารถโหลดใบแจ้งหนี้ได้';
      setError(msg);
      toast.error('โหลดใบแจ้งหนี้ไม่สำเร็จ', msg);
    }
  };

  // ── Check-in with payment ────────────────────────────────────────────────
  const handleCheckinConfirm = async (): Promise<void> => {
    if (!booking || loading) return;
    setLoading(true);
    setError('');
    try {
      const payload: Record<string, unknown> = { bookingId: booking.id };

      // Sprint 4B: cashSessionId / depositCashSessionId resolved server-side.
      if (depositAmount > 0) {
        payload.depositAmount = depositAmount;
        payload.depositPaymentMethod = depositMethod;
      }
      if (collectUpfront && booking.bookingType === 'daily') {
        payload.collectUpfront = true;
        payload.upfrontPaymentMethod = upfrontMethod;
      }
      // Receipt-Standardization: when ANY of the check-in payment legs goes
      // through a bank transfer, route the ledger DEBIT to the bank account
      // the cashier picked.  Sent unconditionally — server ignores it for
      // cash legs.
      if ((depositMethod === 'transfer' || upfrontMethod === 'transfer')
          && checkinReceivingAccountId) {
        payload.receivingAccountId = checkinReceivingAccountId;
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
      toast.success('เช็คอินสำเร็จ');
      // Show receipt if payment was collected
      if (data.receipt) {
        setReceiptData(data.receipt);
      } else {
        onClose();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('เช็คอินไม่สำเร็จ', msg);
      setLoading(false);
    }
  };

  // ── Extend booking handler ────────────────────────────────────────────────
  const handleExtendBooking = async (): Promise<void> => {
    if (!booking || loading || !extendNewCheckOut) return;
    setLoading(true);
    setError('');
    try {
      const effectiveRate = extendNewRate ? parseFloat(extendNewRate) : Number(booking.rate);
      const oldOut  = new Date(booking.checkOut);
      const newOut  = new Date(`${extendNewCheckOut}T00:00:00.000Z`);
      const extraDays = Math.round((newOut.getTime() - oldOut.getTime()) / 86_400_000);

      const payload: Record<string, unknown> = {
        newCheckOut: extendNewCheckOut,
        newRate:     extendNewRate ? effectiveRate : undefined,
        collectNow:  extendCollectNow && extraDays * effectiveRate > 0,
        notes:       extendNotes || undefined,
      };
      if (extendCollectNow && extraDays * effectiveRate > 0) {
        // Sprint 4B: cashSessionId resolved server-side.
        payload.paymentMethod = extendPayMethod;
        if (extendPayMethod === 'transfer' && extendReceivingAccountId) {
          payload.receivingAccountId = extendReceivingAccountId;
        }
      }

      const res = await fetch(`/api/bookings/${booking.id}/extend`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const data = await res.json() as { success?: boolean; error?: string; receipt?: ReceiptData | null };
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);

      setExtendStep('idle');
      setLoading(false);
      onRefresh();
      toast.success('ขยายเวลาการจองสำเร็จ');
      // Receipt-Standardization: surface the receipt modal if the user chose
      // "เก็บเงินตอนนี้". `receipt` is null when "เก็บเงินภายหลัง" — no modal.
      if (data.receipt) setReceiptData(data.receipt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('ขยายเวลาการจองไม่สำเร็จ', msg);
      setLoading(false);
    }
  };

  // ── Add extra service handler ─────────────────────────────────────────────
  const handleAddService = async (): Promise<void> => {
    if (!booking || loading || svcCart.length === 0) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/bookings/${booking.id}/add-service`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: svcCart.map(c => ({
            description: c.description,
            quantity:    c.qty,
            unitPrice:   c.unitPrice,
          })),
          // Sprint 4B: cashSessionId resolved server-side.
          collectNow:    svcCollectNow,
          paymentMethod: svcCollectNow ? svcPayMethod : undefined,
          notes: svcNotes || undefined,
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);

      // Reset all svc* states
      setServiceStep('idle');
      setSvcCart([]);
      setSvcPendingDesc('');
      setSvcPendingPrice(0);
      setSvcPendingUnit('');
      setSvcPendingQty(1);
      setSvcCollectNow(true);
      setSvcPayMethod('cash');
      setSvcCashSessId('');
      setSvcNotes('');
      setSvcProducts([]);
      setSvcSearch('');
      setLoading(false);
      onRefresh();
      toast.success('เพิ่มบริการสำเร็จ');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('เพิ่มบริการไม่สำเร็จ', msg);
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
      setLoading(false);
      onClose();
      onRefresh();
      toast.success('ดำเนินการสำเร็จ');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(msg);
      toast.error('ดำเนินการไม่สำเร็จ', msg);
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

      // Only add payment info when there's an outstanding balance.
      // Sprint 4B: cashSessionId is resolved server-side from the caller's shift.
      if (checkoutOutstanding > 0) {
        payload.paymentMethod = checkoutPayMethod;
        if (checkoutPayMethod === 'transfer' && checkoutReceivingAccountId) {
          payload.receivingAccountId = checkoutReceivingAccountId;
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
      setLoading(false);
      onRefresh();
      toast.success('เช็คเอาท์สำเร็จ');
      if (data.receipt) {
        setReceiptData(data.receipt);
      } else {
        onClose();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('เช็คเอาท์ไม่สำเร็จ', msg);
      setLoading(false);
    }
  };

  // ── Bad-debt checkout (checkout without collecting payment) ────────────────
  const handleBadDebtCheckout = async (): Promise<void> => {
    if (!booking || loading) return;
    const note = badDebtNote.trim();
    if (!note) { setError('กรุณาระบุเหตุผล'); toast.warning('กรุณาระบุเหตุผล'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, badDebt: true, badDebtNote: note }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setCheckoutStep('idle');
      setLoading(false);
      setBadDebtNote('');
      onRefresh();
      onClose();
      toast.success('บันทึกหนี้สูญสำเร็จ');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('บันทึกหนี้สูญไม่สำเร็จ', msg);
      setLoading(false);
    }
  };

  const handleCancelClick = (): void => {
    if (!booking) return;
    if (booking.status === 'checked_in') {
      toast.info(
        'ไม่สามารถยกเลิกการจองที่เช็คอินแล้ว',
        'กรุณาใช้ "เช็คเอาท์" หรือลากขอบขวาในตารางเพื่อย่นวันพัก',
      );
      return;
    }
    setCancelConfirmOpen(true);
  };

  const handleCancelConfirm = async (input: CancelConfirmInput): Promise<void> => {
    if (!booking || loading) return;
    setCancelConfirmOpen(false);
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/bookings/${booking.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel',
          refundAmount: input.refundAmount,
          reason: input.reason,
        }),
      });
      if (!response.ok) {
        let errMsg = `ข้อผิดพลาด HTTP ${response.status}`;
        try {
          const data: ApiError = await response.json();
          errMsg = data.message || errMsg;
        } catch { /* non-JSON */ }
        throw new Error(errMsg);
      }
      setLoading(false);
      onClose();
      onRefresh();
      toast.success(
        'ยกเลิกการจองสำเร็จ',
        input.refundAmount > 0
          ? `สร้างรายการคืนเงิน ฿${fmtBaht(input.refundAmount)} รอดำเนินการ`
          : undefined,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(msg);
      toast.error('ยกเลิกไม่สำเร็จ', msg);
      setLoading(false);
    }
  };

  const handleEdit = (): void => {
    if (!booking) return;
    toast.info(
      'แก้ไขวันพัก / ราคา',
      'ลากขอบซ้าย-ขวาของการจองในตารางเพื่อปรับวันพัก ระบบจะคำนวณค่าใช้จ่ายและคืนเงินให้อัตโนมัติ',
    );
  };

  const nights    = booking ? diffDays(parseUTCDate(booking.checkIn), parseUTCDate(booking.checkOut)) : 0;
  const total     = booking ? nights * booking.rate : 0;
  const statusStyle = booking ? STATUS_STYLE[booking.status] : null;

  // Outstanding balance that will be collected at checkout.
  // Priority: (1) live folio balance from API, (2) fallback from booking.totalPaid.
  // While folioBalanceLoading is true we keep outstanding at 0 so the confirm
  // button stays disabled until we know the real amount.
  const checkoutOutstanding =
    folioBalanceLoading
      ? 0
      : checkoutFolioBalance !== null
        ? checkoutFolioBalance
        : booking
          ? Math.max(0, total - (booking.totalPaid ?? 0))
          : 0;
  const checkoutCashMissing =
    !folioBalanceLoading &&
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
        {booking && checkinStep === 'idle' && checkoutStep === 'idle' && extendStep === 'idle' && serviceStep === 'idle' && (
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

        {/* ── CHECK-OUT BAD DEBT STEP header ── */}
        {booking && checkoutStep === 'bad_debt' && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10, backgroundColor: '#fff7ed' }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#c2410c' }}>เช็คเอาท์โดยไม่รับชำระเงิน</div>
              <div style={{ fontSize: 11, color: '#ea580c' }}>ยอดค้างชำระ {fmtCurrency(checkoutOutstanding)} จะถูกบันทึกเป็นหนี้เสีย</div>
            </div>
          </div>
        )}

        {/* ── EXTEND STEP header ── */}
        {booking && extendStep !== 'idle' && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10, backgroundColor: '#faf5ff' }}>
            <span style={{ fontSize: 18 }}>📅</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#6d28d9' }}>
                ต่ออายุการจอง — ห้อง {room?.number}
              </div>
              <div style={{ fontSize: 11, color: '#a78bfa' }}>
                {extendStep === 'form' ? 'ขั้นที่ 1: เลือกวันเช็คเอาท์ใหม่' : 'ขั้นที่ 2: เลือกวิธีชำระเงิน'}
              </div>
            </div>
          </div>
        )}

        {/* ── ADD SERVICE STEP header ── */}
        {booking && serviceStep !== 'idle' && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10, backgroundColor: '#f0fdf4' }}>
            <span style={{ fontSize: 18 }}>🛒</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#166534' }}>
                เพิ่มบริการ/สินค้า — ห้อง {room?.number}
              </div>
              <div style={{ fontSize: 11, color: '#4ade80' }}>
                {serviceStep === 'form'
                  ? `ขั้นที่ 1: เลือกสินค้า/บริการ${svcCart.length > 0 ? ` (${svcCart.length} รายการในตะกร้า)` : ''}`
                  : 'ขั้นที่ 2: ยืนยันการชำระเงิน'}
              </div>
            </div>
          </div>
        )}

        {/* ── CHECK-OUT COLLECT STEP header ── */}
        {booking && checkoutStep === 'collect' && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10, backgroundColor: booking.cityLedgerAccountId ? '#f5f3ff' : '#eff6ff' }}>
            <span style={{ fontSize: 18 }}>{booking.cityLedgerAccountId ? '🏢' : '🧳'}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: booking.cityLedgerAccountId ? '#6d28d9' : '#1e40af' }}>
                {booking.cityLedgerAccountId ? `City Ledger — ห้อง ${room?.number}` : `เช็คเอาท์ — ห้อง ${room?.number}`}
              </div>
              <div style={{ fontSize: 11, color: booking.cityLedgerAccountId ? '#a78bfa' : '#60a5fa' }}>
                {booking.cityLedgerAccountId
                  ? `บิลจะถูกส่งไปยัง ${booking.cityLedgerAccount?.companyName ?? 'บัญชี City Ledger'}`
                  : folioBalanceLoading
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
                          {upfrontMethod === 'transfer' && (
                            <div style={{ marginTop: 8 }}>
                              <ReceivingAccountPicker
                                receivingAccountId={checkinReceivingAccountId}
                                onChange={setCheckinReceivingAccountId}
                                label="บัญชีที่รับเงิน (โอน)"
                              />
                            </div>
                          )}
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
                      <>
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
                        {depositMethod === 'transfer' && (
                          <div style={{ marginTop: 8 }}>
                            <ReceivingAccountPicker
                              receivingAccountId={checkinReceivingAccountId}
                              onChange={setCheckinReceivingAccountId}
                              label="บัญชีที่รับเงินมัดจำ"
                            />
                          </div>
                        )}
                      </>
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
                  {/* T14: Early-termination guard. Mounted only for non-daily
                      bookings — `disabled` short-circuits the fetch and keeps
                      `blocking=false` so the confirm button stays enabled for
                      walk-in/daily checkouts. */}
                  <CheckoutContractGuard
                    bookingId={booking.id}
                    disabled={booking.bookingType === 'daily'}
                    onBlockingChange={setContractBlockingCheckout}
                    onTerminated={onRefresh}
                  />
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

                  {/* City Ledger notice OR normal payment method selector */}
                  {booking.cityLedgerAccountId ? (
                    <div style={{ marginBottom: 16, padding: '14px 16px', background: '#f5f3ff', borderRadius: 8, border: '1px solid #c4b5fd', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <span style={{ fontSize: 20 }}>🏢</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#6d28d9', marginBottom: 4 }}>บิล City Ledger</div>
                        <div style={{ fontSize: 12, color: '#7c3aed' }}>
                          ยอดค้างชำระ <strong>{fmtCurrency(checkoutOutstanding)}</strong> จะถูกบันทึกเข้าบัญชี
                          <strong> {booking.cityLedgerAccount?.companyName ?? ''}</strong> ({booking.cityLedgerAccount?.accountCode ?? ''})
                        </div>
                        <div style={{ fontSize: 11, color: '#a78bfa', marginTop: 4 }}>
                          ไม่ต้องรับเงินสดจากลูกค้า — บริษัทจะชำระภายหลังตามเงื่อนไขเครดิต
                        </div>
                      </div>
                    </div>
                  ) : checkoutOutstanding > 0 ? (
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
                      {checkoutPayMethod === 'transfer' && (
                        <div style={{ marginTop: 10 }}>
                          <ReceivingAccountPicker
                            receivingAccountId={checkoutReceivingAccountId}
                            onChange={setCheckoutReceivingAccountId}
                            label="บัญชีที่รับเงิน (โอน)"
                          />
                        </div>
                      )}
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

                  {/* Cash session warning — only for non-CL bookings */}
                  {!booking.cityLedgerAccountId && checkoutCashMissing && (
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
                      type="button"
                      onClick={handleCheckoutConfirm}
                      disabled={loading || folioBalanceLoading || contractBlockingCheckout || (!booking.cityLedgerAccountId && checkoutCashMissing)}
                      title={contractBlockingCheckout ? 'ต้องยกเลิกสัญญาที่ยังมีผลอยู่ก่อน' : undefined}
                      style={{
                        flex: 2, padding: '10px', borderRadius: 6,
                        background: booking.cityLedgerAccountId
                          ? '#7c3aed'
                          : (contractBlockingCheckout || (!booking.cityLedgerAccountId && checkoutCashMissing)) ? '#93c5fd' : '#3b82f6',
                        color: '#fff', border: 'none', fontSize: 13, fontWeight: 700,
                        cursor: (loading || folioBalanceLoading || contractBlockingCheckout || (!booking.cityLedgerAccountId && checkoutCashMissing)) ? 'not-allowed' : 'pointer',
                        opacity: (loading || folioBalanceLoading || contractBlockingCheckout || (!booking.cityLedgerAccountId && checkoutCashMissing)) ? 0.6 : 1,
                        fontFamily: FONT,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}
                    >
                      {loading
                        ? '⏳ กำลังดำเนินการ...'
                        : folioBalanceLoading
                          ? '⏳ กำลังตรวจสอบยอด...'
                          : contractBlockingCheckout
                            ? '🔒 ยกเลิกสัญญาก่อน'
                            : booking.cityLedgerAccountId
                              ? '🏢 บันทึกเข้า City Ledger และเช็คเอาท์'
                              : `🧳 ยืนยันเช็คเอาท์${checkoutOutstanding > 0 ? ` & รับ ${fmtCurrency(checkoutOutstanding)}` : ''}`}
                    </button>
                  </div>

                  {/* Bad-debt escape hatch — only when there is outstanding AND not City Ledger */}
                  {!booking.cityLedgerAccountId && checkoutOutstanding > 0 && !folioBalanceLoading && (
                    <button
                      onClick={() => { setError(''); setBadDebtNote(''); setCheckoutStep('bad_debt'); }}
                      disabled={loading}
                      style={{
                        width: '100%', marginTop: 10, padding: '9px', borderRadius: 6,
                        background: 'transparent', color: '#c2410c',
                        border: '1.5px solid #fb923c', fontSize: 12, fontWeight: 600,
                        cursor: loading ? 'not-allowed' : 'pointer', fontFamily: FONT,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}
                    >
                      ⚠️ เช็คเอาท์ (ไม่สามารถเก็บเงินได้)
                    </button>
                  )}
                </div>
              )}

              {/* ─── BAD DEBT CHECKOUT FORM ──────────────────────────────────── */}
              {checkoutStep === 'bad_debt' && (
                <div>
                  <div style={{ marginBottom: 16, padding: '14px 16px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#c2410c', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      ⚠️ เช็คเอาท์โดยไม่รับชำระเงิน
                    </div>
                    <div style={{ fontSize: 12, color: '#9a3412', lineHeight: 1.5 }}>
                      ยอดค้างชำระ <strong>{fmtCurrency(checkoutOutstanding)}</strong> จะถูกบันทึกเป็น<strong>หนี้เสีย</strong> ในบัญชี
                    </div>
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                      เหตุผล <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <textarea
                      value={badDebtNote}
                      onChange={e => setBadDebtNote(e.target.value)}
                      placeholder='ระบุเหตุผล เช่น ลูกค้าหนี ไม่ยู่รับสาย ฯลฯ'
                      rows={3}
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '9px 12px', borderRadius: 8,
                        border: `1.5px solid ${error && !badDebtNote.trim() ? '#f87171' : '#d1d5db'}`,
                        fontSize: 13, fontFamily: FONT, resize: 'vertical',
                        outline: 'none', color: '#1f2937',
                      }}
                    />
                  </div>

                  {error && (
                    <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fee2e2', borderRadius: 8, fontSize: 12, color: '#991b1b' }}>
                      {error}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => { setCheckoutStep('collect'); setError(''); }}
                      disabled={loading}
                      style={{ flex: 1, padding: '10px', borderRadius: 6, background: '#e5e7eb', color: '#1f2937', border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: FONT }}
                    >
                      ← กลับ
                    </button>
                    <button
                      onClick={handleBadDebtCheckout}
                      disabled={loading || !badDebtNote.trim()}
                      style={{
                        flex: 2, padding: '10px', borderRadius: 6,
                        background: (loading || !badDebtNote.trim()) ? '#fca5a5' : '#ef4444',
                        color: '#fff', border: 'none', fontSize: 13, fontWeight: 700,
                        cursor: (loading || !badDebtNote.trim()) ? 'not-allowed' : 'pointer',
                        opacity: (loading || !badDebtNote.trim()) ? 0.7 : 1,
                        fontFamily: FONT,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}
                    >
                      {loading ? '⏳ กำลังดำเนินการ...' : '✅ ยืนยัน — บันทึกเป็นหนี้เสีย'}
                    </button>
                  </div>
                </div>
              )}

              {/* ─── EXTEND BOOKING STEP ─────────────────────────────────────── */}
              {extendStep !== 'idle' && booking && (() => {
                const oldOut      = new Date(booking.checkOut);
                const newOut      = extendNewCheckOut ? new Date(`${extendNewCheckOut}T00:00:00.000Z`) : null;
                const extraDays   = newOut && newOut > oldOut
                  ? Math.round((newOut.getTime() - oldOut.getTime()) / 86_400_000)
                  : 0;
                const effectiveRate = extendNewRate ? parseFloat(extendNewRate) || Number(booking.rate) : Number(booking.rate);
                const extraCharge   = +(extraDays * effectiveRate).toFixed(2);
                const isValid       = extraDays > 0;
                const cashMissing   = extendCollectNow && extendPayMethod === 'cash' && !extendCashSessId;

                return (
                  <div>
                    {/* ── FORM STEP ──────────────────────────────────────────── */}
                    {extendStep === 'form' && (
                      <div>
                        {/* Current checkout summary */}
                        <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            สรุปการจองปัจจุบัน
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                            <div>
                              <div style={{ fontSize: 11, color: '#9ca3af' }}>เช็คเอาท์เดิม</div>
                              <div style={{ fontWeight: 700 }}>{fmtDateTime(booking.checkOut)}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: '#9ca3af' }}>ราคา / {booking.bookingType === 'daily' ? 'คืน' : 'เดือน'}</div>
                              <div style={{ fontWeight: 700 }}>{fmtCurrency(booking.rate)}</div>
                            </div>
                          </div>
                        </div>

                        {/* New checkout date */}
                        <div style={{ marginBottom: 14 }}>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
                            📅 วันเช็คเอาท์ใหม่ *
                          </label>
                          <input
                            type="date"
                            value={extendNewCheckOut}
                            min={(() => {
                              const d = new Date(booking.checkOut);
                              d.setDate(d.getDate() + 1);
                              return d.toISOString().slice(0, 10);
                            })()}
                            onChange={e => setExtendNewCheckOut(e.target.value)}
                            style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: FONT }}
                          />
                        </div>

                        {/* Optional rate change (monthly only) */}
                        {booking.bookingType !== 'daily' && (
                          <div style={{ marginBottom: 14 }}>
                            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
                              💰 ราคาใหม่ต่อเดือน (ถ้าเปลี่ยน)
                            </label>
                            <input
                              type="number"
                              placeholder={String(booking.rate)}
                              value={extendNewRate}
                              onChange={e => setExtendNewRate(e.target.value)}
                              style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: FONT }}
                            />
                          </div>
                        )}

                        {/* Notes */}
                        <div style={{ marginBottom: 14 }}>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
                            📝 หมายเหตุ (ไม่บังคับ)
                          </label>
                          <input
                            type="text"
                            placeholder="เช่น ลูกค้าขอต่อเพิ่มเนื่องจาก..."
                            value={extendNotes}
                            onChange={e => setExtendNotes(e.target.value)}
                            style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: FONT }}
                          />
                        </div>

                        {/* Live preview */}
                        {isValid && (
                          <div style={{ background: '#faf5ff', border: '1.5px solid #c4b5fd', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                              สรุปการต่ออายุ
                            </div>
                            <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#6b7280' }}>จำนวนวันที่ต่อเพิ่ม</span>
                                <span style={{ fontWeight: 600 }}>{extraDays} วัน</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#6b7280' }}>ราคาต่อ{booking.bookingType === 'daily' ? 'คืน' : 'วัน'}</span>
                                <span style={{ fontWeight: 600 }}>{fmtCurrency(effectiveRate)}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #c4b5fd', paddingTop: 8, marginTop: 2 }}>
                                <span style={{ fontWeight: 700, color: '#6d28d9' }}>ค่าใช้จ่ายเพิ่มเติม</span>
                                <span style={{ fontWeight: 800, fontSize: 16, color: '#6d28d9' }}>{fmtCurrency(extraCharge)}</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

                        {/* Buttons */}
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={() => { setExtendStep('idle'); setError(''); }}
                            style={{ flex: 1, padding: '10px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
                          >
                            ← ยกเลิก
                          </button>
                          <button
                            onClick={() => { setError(''); setExtendStep('payment'); }}
                            disabled={!isValid}
                            style={{ flex: 2, padding: '10px 12px', background: isValid ? '#7c3aed' : '#e9d5ff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: isValid ? 'pointer' : 'not-allowed', fontFamily: FONT }}
                          >
                            ดำเนินการต่อ →
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ── PAYMENT STEP ───────────────────────────────────────── */}
                    {extendStep === 'payment' && (
                      <div>
                        {/* Charge summary */}
                        <div style={{ background: '#faf5ff', border: '1.5px solid #c4b5fd', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            สรุปค่าใช้จ่ายเพิ่มเติม
                          </div>
                          <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: '#6b7280' }}>ต่ออายุ {extraDays} วัน × {fmtCurrency(effectiveRate)}</span>
                              <span style={{ fontWeight: 600 }}>{fmtCurrency(extraCharge)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: '#6b7280' }}>เช็คเอาท์ใหม่</span>
                              <span style={{ fontWeight: 600 }}>{extendNewCheckOut}</span>
                            </div>
                          </div>
                        </div>

                        {/* Collect now toggle */}
                        {extraCharge > 0 && (
                          <div style={{ marginBottom: 14 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
                              💳 การชำระเงิน
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                onClick={() => setExtendCollectNow(true)}
                                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: `1.5px solid ${extendCollectNow ? '#7c3aed' : '#e5e7eb'}`, background: extendCollectNow ? '#f5f3ff' : '#fff', color: extendCollectNow ? '#6d28d9' : '#6b7280', cursor: 'pointer' }}
                              >
                                💰 รับชำระตอนนี้
                              </button>
                              <button
                                onClick={() => setExtendCollectNow(false)}
                                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: `1.5px solid ${!extendCollectNow ? '#7c3aed' : '#e5e7eb'}`, background: !extendCollectNow ? '#f5f3ff' : '#fff', color: !extendCollectNow ? '#6d28d9' : '#6b7280', cursor: 'pointer' }}
                              >
                                ⏸ เก็บเงินภายหลัง
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Payment method (if collect now) */}
                        {extendCollectNow && extraCharge > 0 && (
                          <div style={{ marginBottom: 14, padding: '12px 14px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
                              💳 ช่องทางชำระเงิน
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {PAYMENT_METHODS.map(pm => (
                                <button
                                  key={pm.value}
                                  onClick={() => setExtendPayMethod(pm.value)}
                                  style={{
                                    padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                                    border: `1.5px solid ${extendPayMethod === pm.value ? '#7c3aed' : '#e5e7eb'}`,
                                    background: extendPayMethod === pm.value ? '#f5f3ff' : '#fff',
                                    color: extendPayMethod === pm.value ? '#7c3aed' : '#6b7280',
                                    cursor: 'pointer',
                                  }}
                                >
                                  {pm.label}
                                </button>
                              ))}
                            </div>
                            {extendPayMethod === 'cash' && (
                              <div style={{ marginTop: 8, fontSize: 11, color: extendCashSessId ? '#16a34a' : '#dc2626' }}>
                                {extendCashSessId ? `✅ กะแคชเชียร์: ${extendCashSessId.slice(-6)}` : '⚠️ ไม่มีกะแคชเชียร์ที่เปิดอยู่'}
                              </div>
                            )}
                            {extendPayMethod === 'transfer' && (
                              <div style={{ marginTop: 10 }}>
                                <ReceivingAccountPicker
                                  receivingAccountId={extendReceivingAccountId}
                                  onChange={setExtendReceivingAccountId}
                                  label="บัญชีที่รับเงิน (โอน)"
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {/* "Pay later" info */}
                        {!extendCollectNow && extraCharge > 0 && (
                          <div style={{ marginBottom: 14, padding: '12px 14px', background: '#fffbeb', borderRadius: 8, border: '1px solid #fde68a', fontSize: 12, color: '#92400e' }}>
                            💡 ค่าใช้จ่าย <strong>{fmtCurrency(extraCharge)}</strong> จะถูกบันทึกในโฟลิโอ และสามารถเก็บเงินได้ทีหลังจากแท็บ "💳 บิล" หรือตอนเช็คเอาท์
                          </div>
                        )}

                        {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

                        {/* Buttons */}
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={() => { setExtendStep('form'); setError(''); }}
                            style={{ flex: 1, padding: '10px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
                          >
                            ← กลับ
                          </button>
                          <button
                            onClick={handleExtendBooking}
                            disabled={loading || (extendCollectNow && extraCharge > 0 && cashMissing)}
                            style={{ flex: 2, padding: '10px 12px', background: loading ? '#e9d5ff' : '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: (extendCollectNow && extraCharge > 0 && cashMissing) ? 0.5 : 1, fontFamily: FONT }}
                          >
                            {loading
                              ? '⏳ กำลังดำเนินการ...'
                              : extendCollectNow && extraCharge > 0
                                ? `✅ ยืนยันต่ออายุ + รับเงิน ${fmtCurrency(extraCharge)}`
                                : '✅ ยืนยันต่ออายุ (ยังไม่รับชำระ)'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ─── ADD SERVICE STEP ────────────────────────────────────────── */}
              {serviceStep !== 'idle' && (() => {
                const cartTotal   = +svcCart.reduce((s, c) => s + c.qty * c.unitPrice, 0).toFixed(2);
                const pendingTotal = +(svcPendingQty * svcPendingPrice).toFixed(2);
                const filteredProducts = svcProducts.filter(p =>
                  p.name.toLowerCase().includes(svcSearch.toLowerCase()),
                );
                const svcCashMissing = svcCollectNow && svcPayMethod === 'cash' && !svcCashSessId;

                const resetSvc = () => {
                  setServiceStep('idle');
                  setSvcCart([]);
                  setSvcPendingDesc('');
                  setSvcPendingPrice(0);
                  setSvcPendingUnit('');
                  setSvcPendingQty(1);
                  setSvcCollectNow(true);
                  setSvcPayMethod('cash');
                  setSvcCashSessId('');
                  setSvcNotes('');
                  setSvcProducts([]);
                  setSvcSearch('');
                  setError('');
                };

                const addToCart = () => {
                  if (!svcPendingDesc.trim() || svcPendingPrice <= 0) return;
                  setSvcCart(prev => [...prev, {
                    tempId:      `${Date.now()}-${Math.random()}`,
                    description: svcPendingDesc.trim(),
                    qty:         svcPendingQty,
                    unitPrice:   svcPendingPrice,
                    unit:        svcPendingUnit || undefined,
                  }]);
                  // Reset pending but keep search/products open
                  setSvcPendingDesc('');
                  setSvcPendingPrice(0);
                  setSvcPendingUnit('');
                  setSvcPendingQty(1);
                };

                return (
                  <div>
                    {/* ── FORM STEP ──────────────────────────────────────────── */}
                    {serviceStep === 'form' && (
                      <div>
                        {/* Search bar */}
                        <div style={{ marginBottom: 8 }}>
                          <input
                            type="text"
                            placeholder="🔍 ค้นหาสินค้า/บริการ..."
                            value={svcSearch}
                            onChange={e => setSvcSearch(e.target.value)}
                            style={{
                              width: '100%', boxSizing: 'border-box',
                              padding: '8px 12px', borderRadius: 8,
                              border: '1.5px solid #d1d5db', fontSize: 13,
                              fontFamily: FONT, outline: 'none',
                            }}
                          />
                        </div>

                        {/* Product catalogue list */}
                        <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 12 }}>
                          {filteredProducts.length === 0 ? (
                            <div style={{ padding: '14px 12px', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
                              {svcProducts.length === 0 ? 'กำลังโหลด...' : 'ไม่พบสินค้า'}
                            </div>
                          ) : (
                            filteredProducts.map(p => {
                              const isSelected = svcPendingDesc === p.name && svcPendingPrice === Number(p.price);
                              return (
                                <div
                                  key={p.id}
                                  onClick={() => {
                                    setSvcPendingDesc(p.name);
                                    setSvcPendingPrice(Number(p.price));
                                    setSvcPendingUnit(p.unit ?? '');
                                    setSvcPendingQty(1);
                                  }}
                                  style={{
                                    padding: '7px 12px', cursor: 'pointer', fontSize: 13,
                                    borderBottom: '1px solid #f3f4f6',
                                    background: isSelected ? '#dcfce7' : '#fff',
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                  }}
                                >
                                  <div>
                                    <span style={{ fontWeight: isSelected ? 700 : 500, color: isSelected ? '#15803d' : '#1f2937' }}>
                                      {p.name}
                                    </span>
                                    {p.unit && <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 4 }}>/ {p.unit}</span>}
                                  </div>
                                  <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', flexShrink: 0 }}>
                                    ฿{fmtBaht(Number(p.price))}
                                  </span>
                                </div>
                              );
                            })
                          )}
                        </div>

                        {/* Pending-item editor */}
                        <div style={{ background: '#f9fafb', border: '1.5px solid #e5e7eb', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 8 }}>
                            {/* Description */}
                            <input
                              type="text"
                              placeholder="ชื่อสินค้า / บริการ *"
                              value={svcPendingDesc}
                              onChange={e => setSvcPendingDesc(e.target.value)}
                              style={{
                                padding: '7px 10px', borderRadius: 7,
                                border: '1.5px solid #d1d5db', fontSize: 13,
                                fontFamily: FONT, outline: 'none', boxSizing: 'border-box', width: '100%',
                              }}
                            />
                            {/* Quantity stepper */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <button
                                onClick={() => setSvcPendingQty(q => Math.max(1, q - 1))}
                                style={{ width: 28, height: 28, borderRadius: 6, border: '1.5px solid #d1d5db', background: '#fff', fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              >−</button>
                              <span style={{ minWidth: 24, textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#1f2937' }}>
                                {svcPendingQty}
                              </span>
                              <button
                                onClick={() => setSvcPendingQty(q => Math.min(999, q + 1))}
                                style={{ width: 28, height: 28, borderRadius: 6, border: '1.5px solid #16a34a', background: '#f0fdf4', fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16a34a' }}
                              >+</button>
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
                            {/* Unit price */}
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={svcPendingPrice || ''}
                              placeholder="ราคาต่อหน่วย (฿) *"
                              onChange={e => setSvcPendingPrice(parseFloat(e.target.value) || 0)}
                              style={{
                                padding: '7px 10px', borderRadius: 7,
                                border: '1.5px solid #d1d5db', fontSize: 13,
                                fontFamily: FONT, outline: 'none', boxSizing: 'border-box', width: '100%',
                              }}
                            />
                            {/* Add to cart button */}
                            <button
                              onClick={addToCart}
                              disabled={!svcPendingDesc.trim() || svcPendingPrice <= 0}
                              style={{
                                padding: '7px 14px', borderRadius: 7, fontSize: 13, fontWeight: 700,
                                border: 'none', cursor: (!svcPendingDesc.trim() || svcPendingPrice <= 0) ? 'not-allowed' : 'pointer',
                                background: (!svcPendingDesc.trim() || svcPendingPrice <= 0) ? '#bbf7d0' : '#16a34a',
                                color: '#fff', whiteSpace: 'nowrap', fontFamily: FONT,
                              }}
                            >
                              + เพิ่ม
                            </button>
                          </div>
                          {pendingTotal > 0 && (
                            <div style={{ marginTop: 6, fontSize: 12, color: '#374151', textAlign: 'right' }}>
                              {svcPendingQty} × ฿{fmtBaht(svcPendingPrice)} = <strong style={{ color: '#15803d' }}>฿{fmtBaht(pendingTotal)}</strong>
                            </div>
                          )}
                        </div>

                        {/* ── Cart ── */}
                        {svcCart.length > 0 && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                              🛒 ตะกร้า ({svcCart.length} รายการ)
                            </div>
                            <div style={{ border: '1.5px solid #86efac', borderRadius: 10, overflow: 'hidden' }}>
                              {svcCart.map((item, idx) => (
                                <div
                                  key={item.tempId}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '8px 12px',
                                    background: idx % 2 === 0 ? '#f0fdf4' : '#fff',
                                    borderBottom: idx < svcCart.length - 1 ? '1px solid #bbf7d0' : 'none',
                                  }}
                                >
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {item.description}
                                    </div>
                                    <div style={{ fontSize: 11, color: '#6b7280' }}>
                                      {item.qty} × ฿{fmtBaht(item.unitPrice)}
                                    </div>
                                  </div>
                                  {/* Qty controls */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                    <button
                                      onClick={() => setSvcCart(prev => prev.map(c => c.tempId === item.tempId ? { ...c, qty: Math.max(1, c.qty - 1) } : c))}
                                      style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    >−</button>
                                    <span style={{ fontSize: 12, fontWeight: 700, minWidth: 20, textAlign: 'center' }}>{item.qty}</span>
                                    <button
                                      onClick={() => setSvcCart(prev => prev.map(c => c.tempId === item.tempId ? { ...c, qty: Math.min(999, c.qty + 1) } : c))}
                                      style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid #16a34a', background: '#f0fdf4', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16a34a' }}
                                    >+</button>
                                  </div>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d', minWidth: 60, textAlign: 'right' }}>
                                    ฿{fmtBaht(item.qty * item.unitPrice)}
                                  </div>
                                  <button
                                    onClick={() => setSvcCart(prev => prev.filter(c => c.tempId !== item.tempId))}
                                    style={{ width: 22, height: 22, borderRadius: 4, border: 'none', background: '#fef2f2', color: '#dc2626', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                                  >×</button>
                                </div>
                              ))}
                              {/* Cart total */}
                              <div style={{ padding: '8px 12px', background: '#dcfce7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>รวมทั้งหมด</span>
                                <span style={{ fontSize: 16, fontWeight: 800, color: '#15803d' }}>฿{fmtBaht(cartTotal)}</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {error && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 10 }}>{error}</div>}

                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={resetSvc}
                            style={{ flex: 1, padding: '10px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
                          >
                            ✕ ยกเลิก
                          </button>
                          <button
                            onClick={() => { setError(''); setServiceStep('payment'); }}
                            disabled={svcCart.length === 0}
                            style={{
                              flex: 2, padding: '10px 12px',
                              background: svcCart.length === 0 ? '#bbf7d0' : '#16a34a',
                              color: '#fff', border: 'none', borderRadius: 8,
                              fontSize: 13, fontWeight: 700,
                              cursor: svcCart.length === 0 ? 'not-allowed' : 'pointer',
                              fontFamily: FONT,
                            }}
                          >
                            ถัดไป → ({svcCart.length} รายการ)
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ── PAYMENT STEP ───────────────────────────────────────── */}
                    {serviceStep === 'payment' && (
                      <div>
                        {/* Summary card — all cart items */}
                        <div style={{ background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#166534', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            สรุปรายการ ({svcCart.length} รายการ)
                          </div>
                          <div style={{ display: 'grid', gap: 6 }}>
                            {svcCart.map(item => (
                              <div key={item.tempId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                <span style={{ color: '#374151', flex: 1, marginRight: 8 }}>
                                  {item.description}
                                  <span style={{ color: '#9ca3af', fontSize: 11, marginLeft: 4 }}>× {item.qty}</span>
                                </span>
                                <span style={{ fontWeight: 600, color: '#1f2937', flexShrink: 0 }}>฿{fmtBaht(item.qty * item.unitPrice)}</span>
                              </div>
                            ))}
                            <div style={{ borderTop: '1px solid #bbf7d0', paddingTop: 8, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ fontWeight: 700, color: '#166534' }}>รวม</span>
                              <span style={{ fontWeight: 800, fontSize: 16, color: '#15803d' }}>฿{fmtBaht(cartTotal)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Collect now toggle */}
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
                            💳 การชำระเงิน
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              onClick={() => setSvcCollectNow(true)}
                              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: `1.5px solid ${svcCollectNow ? '#16a34a' : '#e5e7eb'}`, background: svcCollectNow ? '#dcfce7' : '#fff', color: svcCollectNow ? '#15803d' : '#6b7280', cursor: 'pointer' }}
                            >
                              💰 เก็บเงินทันที
                            </button>
                            <button
                              onClick={() => setSvcCollectNow(false)}
                              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: `1.5px solid ${!svcCollectNow ? '#16a34a' : '#e5e7eb'}`, background: !svcCollectNow ? '#dcfce7' : '#fff', color: !svcCollectNow ? '#15803d' : '#6b7280', cursor: 'pointer' }}
                            >
                              ⏸ ลงบิลไว้ก่อน
                            </button>
                          </div>
                        </div>

                        {/* Payment method selector (collect now) */}
                        {svcCollectNow && (
                          <div style={{ marginBottom: 14, padding: '12px 14px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
                              💳 ช่องทางชำระเงิน
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {SVC_PAYMENT_METHODS.map(pm => (
                                <button
                                  key={pm.value}
                                  onClick={() => setSvcPayMethod(pm.value)}
                                  style={{
                                    padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                                    border: `1.5px solid ${svcPayMethod === pm.value ? '#16a34a' : '#e5e7eb'}`,
                                    background: svcPayMethod === pm.value ? '#dcfce7' : '#fff',
                                    color: svcPayMethod === pm.value ? '#15803d' : '#6b7280',
                                    cursor: 'pointer',
                                  }}
                                >
                                  {pm.label}
                                </button>
                              ))}
                            </div>
                            {svcPayMethod === 'cash' && (
                              <div style={{ marginTop: 8, fontSize: 11, color: svcCashSessId ? '#16a34a' : '#dc2626' }}>
                                {svcCashSessId ? `✅ กะแคชเชียร์: ${svcCashSessId.slice(-6)}` : '⚠️ ไม่มีกะแคชเชียร์ที่เปิดอยู่'}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Pay later info */}
                        {!svcCollectNow && (
                          <div style={{ marginBottom: 14, padding: '12px 14px', background: '#fffbeb', borderRadius: 8, border: '1px solid #fde68a', fontSize: 12, color: '#92400e' }}>
                            💡 ค่าใช้จ่าย <strong>฿{fmtBaht(cartTotal)}</strong> จะถูกบันทึกในโฟลิโอ และสามารถเก็บเงินได้ทีหลังจากแท็บ "💳 บิล" หรือตอนเช็คเอาท์
                          </div>
                        )}

                        {/* Notes */}
                        <div style={{ marginBottom: 14 }}>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 4 }}>
                            📝 หมายเหตุ (ไม่บังคับ)
                          </label>
                          <textarea
                            value={svcNotes}
                            onChange={e => setSvcNotes(e.target.value)}
                            placeholder="เช่น ห้อง 301 ขอน้ำแข็ง..."
                            rows={2}
                            style={{
                              width: '100%', boxSizing: 'border-box',
                              padding: '8px 12px', borderRadius: 8,
                              border: '1.5px solid #d1d5db', fontSize: 13,
                              fontFamily: FONT, resize: 'vertical', outline: 'none',
                            }}
                          />
                        </div>

                        {error && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 10 }}>{error}</div>}

                        {svcCashMissing && (
                          <div style={{ marginBottom: 10, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12, color: '#b91c1c' }}>
                            ⚠️ ยังไม่มีกะแคชเชียร์ที่เปิดอยู่ — กรุณาเลือกช่องทางชำระอื่น
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={() => { setServiceStep('form'); setError(''); }}
                            style={{ flex: 1, padding: '10px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
                          >
                            ← ย้อนกลับ
                          </button>
                          <button
                            onClick={handleAddService}
                            disabled={loading || (svcCollectNow && svcCashMissing)}
                            style={{
                              flex: 2, padding: '10px 12px',
                              background: loading ? '#bbf7d0' : '#16a34a',
                              color: '#fff', border: 'none', borderRadius: 8,
                              fontSize: 13, fontWeight: 700,
                              cursor: loading ? 'not-allowed' : 'pointer',
                              opacity: (svcCollectNow && svcCashMissing) ? 0.5 : 1,
                              fontFamily: FONT,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            }}
                          >
                            {loading
                              ? '⏳ กำลังดำเนินการ...'
                              : svcCollectNow
                                ? `✅ ยืนยัน + รับ ฿${fmtBaht(cartTotal)}`
                                : '✅ ยืนยัน (ลงบิลไว้ก่อน)'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ─── DETAILS TAB (idle only) ──────────────────────────────────── */}
              {checkinStep === 'idle' && checkoutStep === 'idle' && extendStep === 'idle' && serviceStep === 'idle' && activeTab === 'details' && (
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

                  {/* ── Housekeeping (Sprint 2b) ─────────────────────────── */}
                  <div style={{ marginBottom: 24 }}>
                    <div style={{
                      fontSize: 12, fontWeight: 700, color: '#6b7280',
                      marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5,
                    }}>
                      🧹 งานแม่บ้าน
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                      <button
                        type="button"
                        onClick={() => setHkRequestOpen(true)}
                        className="pms-transition"
                        style={{
                          padding: '8px 12px', borderRadius: 6, border: 'none',
                          background: '#0284c7', color: '#fff', fontSize: 12,
                          fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
                        }}
                      >
                        ➕ สั่งทำความสะอาด
                      </button>
                      {booking.bookingType !== 'daily' && (
                        <button
                          type="button"
                          onClick={() => setHkScheduleOpen(true)}
                          className="pms-transition"
                          style={{
                            padding: '8px 12px', borderRadius: 6, border: 'none',
                            background: '#7c3aed', color: '#fff', fontSize: 12,
                            fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
                          }}
                        >
                          📅 ตั้งรอบประจำ
                        </button>
                      )}
                    </div>

                    {/* Task list */}
                    {hkLoading ? (
                      <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: 10 }}>
                        กำลังโหลด...
                      </div>
                    ) : hkTasks.length === 0 ? (
                      <div style={{
                        fontSize: 12, color: 'var(--text-faint)',
                        padding: 10, background: 'var(--surface-subtle)',
                        borderRadius: 6,
                      }}>
                        ยังไม่มีงานแม่บ้านสำหรับ booking นี้
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {hkTasks.map(t => {
                          const st = HK_STATUS_STYLE[t.status] ?? { label: t.status, color: '#64748b', bg: '#f1f5f9' };
                          const canDecline = t.status === 'pending' && t.requestSource === 'daily_auto';
                          return (
                            <div key={t.id} style={{
                              display: 'flex', alignItems: 'center', gap: 10,
                              padding: '8px 10px', borderRadius: 8,
                              border: '1px solid var(--border-light)',
                              background: 'var(--surface-card)',
                              fontSize: 12,
                            }}>
                              <span style={{
                                display: 'inline-flex', padding: '2px 8px', borderRadius: 10,
                                fontSize: 10, fontWeight: 700,
                                color: st.color, background: st.bg, minWidth: 64,
                                justifyContent: 'center',
                              }}>
                                {st.label}
                              </span>
                              <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: 11 }}>
                                {t.taskNumber}
                              </span>
                              <span style={{ color: 'var(--text-primary)', flex: 1 }}>
                                {fmtDate(t.scheduledAt)} · {t.taskType}
                                {t.requestChannel && (
                                  <span title={t.requestChannel} style={{ marginLeft: 6 }}>
                                    {HK_CHANNEL_ICON[t.requestChannel] ?? ''}
                                  </span>
                                )}
                              </span>
                              <span style={{ color: t.chargeable && t.fee ? '#0284c7' : 'var(--text-faint)', fontWeight: 600 }}>
                                {t.chargeable && t.fee ? `฿${fmtBaht(Number(t.fee))}` : '—'}
                              </span>
                              {canDecline && (
                                <button
                                  type="button"
                                  onClick={() => setHkDeclineTaskId(t.id)}
                                  style={{
                                    padding: '3px 8px', borderRadius: 6,
                                    border: '1px solid #fecaca', background: '#fff',
                                    color: '#dc2626', fontSize: 11, fontWeight: 600,
                                    cursor: 'pointer', fontFamily: FONT,
                                  }}
                                  title="บันทึกว่าแขกไม่ต้องการทำความสะอาดวันนี้"
                                >
                                  🚫 ลูกค้าไม่ต้องการ
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Active schedules */}
                    {hkSchedules.length > 0 && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{
                          fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                          marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5,
                        }}>
                          รอบประจำ
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {hkSchedules.map(s => (
                            <div key={s.id} style={{
                              display: 'flex', alignItems: 'center', gap: 10,
                              padding: '8px 10px', borderRadius: 8,
                              border: '1px solid var(--border-light)',
                              background: s.isActive ? 'var(--surface-card)' : 'var(--surface-muted)',
                              fontSize: 12, opacity: s.isActive ? 1 : 0.7,
                            }}>
                              <span style={{
                                display: 'inline-flex', padding: '2px 8px', borderRadius: 10,
                                fontSize: 10, fontWeight: 700,
                                color: s.isActive ? '#7c3aed' : '#64748b',
                                background: s.isActive ? '#ede9fe' : '#f1f5f9',
                                minWidth: 56, justifyContent: 'center',
                              }}>
                                {s.isActive ? 'active' : 'paused'}
                              </span>
                              <span style={{ color: 'var(--text-primary)', flex: 1 }}>
                                {hkScheduleLabel(s)}
                                {s.timeOfDay && ` · ${s.timeOfDay}`}
                                {' · '}
                                {fmtDate(s.activeFrom)}
                                {s.activeUntil ? ` → ${fmtDate(s.activeUntil)}` : ''}
                              </span>
                              <span style={{ color: s.chargeable && s.fee ? '#0284c7' : 'var(--text-faint)', fontWeight: 600 }}>
                                {s.chargeable && s.fee ? `฿${fmtBaht(Number(s.fee))}` : '—'}
                              </span>
                              <button
                                type="button"
                                onClick={() => toggleScheduleActive(s.id, !s.isActive)}
                                style={{
                                  padding: '3px 8px', borderRadius: 6,
                                  border: '1px solid var(--border-default)',
                                  background: '#fff', color: 'var(--text-primary)',
                                  fontSize: 11, fontWeight: 600,
                                  cursor: 'pointer', fontFamily: FONT,
                                }}
                              >
                                {s.isActive ? '⏸ หยุด' : '▶ เปิด'}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Error */}
                  {error && (
                    <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: 12, lineHeight: 1.4 }}>
                      {error}
                    </div>
                  )}
                </>
              )}

              {/* ── BILLING TAB ──────────────────────────────────────────────── */}
              {checkinStep === 'idle' && checkoutStep === 'idle' && extendStep === 'idle' && serviceStep === 'idle' && activeTab === 'billing' && (
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
                                {billingPayMethod === 'cash' && billingCashSessChecked && !billingCashSessId && (
                                  <div style={{ marginBottom: 8, fontSize: 11, color: '#b91c1c', padding: '6px 8px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fca5a5' }}>
                                    ⚠️ ยังไม่มีกะแคชเชียร์ที่เปิดอยู่ — กรุณาเปิดกะก่อน
                                  </div>
                                )}
                                {(billingPayMethod === 'transfer' || billingPayMethod === 'promptpay') && (
                                  <div style={{ marginBottom: 8 }}>
                                    {/* Auto-defaults when there is only one BANK account (or one
                                        is flagged isDefault). The cashier still sees the picker
                                        in case they need to override. */}
                                    <ReceivingAccountPicker
                                      receivingAccountId={billingReceivingAccountId}
                                      onChange={setBillingReceivingAccountId}
                                      disabled={billingPayLoading}
                                      label="บัญชีที่รับเงิน"
                                    />
                                  </div>
                                )}
                                {billingPayMethod === 'credit_card' && (
                                  <div style={{ marginBottom: 8, fontSize: 11, color: '#1e40af', padding: '6px 8px', background: '#eff6ff', borderRadius: 6, border: '1px solid #bfdbfe' }}>
                                    ℹ️ การรับชำระบัตรเครดิตต้องระบุเครื่อง EDC + แบรนด์บัตร — ใช้ฟอร์มเต็มที่หน้า Guest Folio แทน
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
                                    disabled={
                                      billingPayLoading ||
                                      (billingPayMethod === 'cash' && !billingCashSessId) ||
                                      ((billingPayMethod === 'transfer' || billingPayMethod === 'promptpay') && !billingReceivingAccountId) ||
                                      billingPayMethod === 'credit_card'
                                    }
                                    style={{
                                      flex: 2, padding: '7px', borderRadius: 6, border: 'none',
                                      background: (
                                        billingPayLoading ||
                                        (billingPayMethod === 'cash' && !billingCashSessId) ||
                                        ((billingPayMethod === 'transfer' || billingPayMethod === 'promptpay') && !billingReceivingAccountId) ||
                                        billingPayMethod === 'credit_card'
                                      ) ? '#86efac' : '#16a34a',
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
              {checkinStep === 'idle' && checkoutStep === 'idle' && extendStep === 'idle' && serviceStep === 'idle' && activeTab === 'activity' && (
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
        {booking && checkinStep === 'idle' && checkoutStep === 'idle' && extendStep === 'idle' && serviceStep === 'idle' && (
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

            {/* ── ต่ออายุ — for checked_in bookings ─────────────────────────── */}
            {booking.status === 'checked_in' && (
              <button
                onClick={() => { setError(''); setExtendStep('form'); }}
                disabled={loading}
                style={{ padding: '10px 12px', backgroundColor: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, fontFamily: FONT }}
              >
                📅 ต่ออายุ
              </button>
            )}

            {/* ── บริการ — add extra service for checked_in bookings ─────────── */}
            {booking.status === 'checked_in' && (
              <button
                onClick={() => { setError(''); setSvcSearch(''); setServiceStep('form'); }}
                disabled={loading}
                style={{ padding: '10px 12px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, fontFamily: FONT }}
              >
                🛒 บริการ
              </button>
            )}

            {(booking.status === 'confirmed' || booking.status === 'checked_in') && !booking.roomLocked && (
              <button
                onClick={() => { setError(''); setMoveDialogOpen(true); }}
                disabled={loading}
                style={{ padding: '10px 12px', backgroundColor: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, fontFamily: FONT }}
                title="ย้ายห้องโดยไม่กระทบยอดเงินที่ชำระแล้ว"
              >
                🔀 ย้ายห้อง
              </button>
            )}

            {(booking.status === 'confirmed' || booking.status === 'checked_in') && !booking.roomLocked && (
              <button
                onClick={() => { setError(''); setSplitDialogOpen(true); }}
                disabled={loading}
                style={{ padding: '10px 12px', backgroundColor: '#db2777', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, fontFamily: FONT }}
                title="แยกช่วงการพัก: เปลี่ยนเรท/ห้อง ในช่วงหลังวันที่เลือก"
              >
                ✂️ แยกช่วง
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
                onClick={handleCancelClick}
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

      {/* Move Room — guest-initiated, billing-invariant */}
      <MoveRoomDialog
        open={moveDialogOpen}
        booking={booking}
        currentRoom={room}
        onClose={() => setMoveDialogOpen(false)}
        onMoved={onRefresh}
      />

      {/* Split Segment — manual multi-room stay / rate change at a point in time */}
      <SplitSegmentDialog
        open={splitDialogOpen}
        booking={booking}
        onClose={() => setSplitDialogOpen(false)}
        onSplit={onRefresh}
      />

      {/* Cancel booking — with cancellation-policy selector */}
      <CancelBookingDialog
        open={cancelConfirmOpen}
        bookingNumber={booking?.bookingNumber ?? ''}
        totalPaid={booking?.totalPaid ?? 0}
        loading={loading}
        onConfirm={handleCancelConfirm}
        onCancel={() => setCancelConfirmOpen(false)}
      />

      {/* ── Housekeeping dialogs (Sprint 2b) ─────────────────────────────── */}
      {booking && room && (
        <RequestCleaningDialog
          open={hkRequestOpen}
          onClose={() => setHkRequestOpen(false)}
          roomId={room.id}
          roomNumber={room.number}
          bookingId={booking.id}
          bookingType={booking.bookingType}
          onCreated={() => { if (booking?.id) void loadHkForBooking(booking.id); }}
        />
      )}

      {booking && room && booking.bookingType !== 'daily' && (
        <ScheduleDialog
          open={hkScheduleOpen}
          onClose={() => setHkScheduleOpen(false)}
          roomId={room.id}
          roomNumber={room.number}
          bookingId={booking.id}
          guestName={guestDisplayName(booking.guest)}
          onCreated={() => { if (booking?.id) void loadHkForBooking(booking.id); }}
        />
      )}

      <ConfirmDialog
        open={hkDeclineTaskId !== null}
        title="ยืนยันการยกเลิกงานแม่บ้าน"
        description="บันทึกว่าแขกไม่ต้องการทำความสะอาดวันนี้? ระบบจะยกเลิก task ที่ pending"
        confirmText="🚫 ยืนยันยกเลิก"
        cancelText="ไม่"
        variant="danger"
        loading={hkDeclineBusy}
        onConfirm={() => { if (hkDeclineTaskId) void declineHkTask(hkDeclineTaskId); }}
        onCancel={() => setHkDeclineTaskId(null)}
      />
    </>
  );
}
