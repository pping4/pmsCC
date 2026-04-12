'use client';

import { Fragment, useState, useEffect } from 'react';
import { fmtDate } from '@/lib/date-format';

// ============================================================================
// TYPES
// ============================================================================

interface CollectionInvoice {
  id: string;
  invoiceNumber: string;
  grandTotal: number;
  dueDate: string;
  notes: string | null;
  daysOverdue: number;
  guest: { id: string; firstName: string; lastName: string; phone: string | null };
  room: { number: string; floor: number } | null;
  bookingType: string | null;
}

interface CollectionData {
  summary: {
    overdueAmount: number;
    overdueCount: number;
    dueTodayAmount: number;
    dueTodayCount: number;
    weekAmount: number;
    weekCount: number;
    upcomingAmount: number;
    notYetInvoicedCount: number;
  };
  overdue: CollectionInvoice[];
  dueToday: CollectionInvoice[];
  dueThisWeek: CollectionInvoice[];
  upcoming: CollectionInvoice[];
  notYetInvoiced: {
    bookingId: string;
    guestName: string;
    roomNumber: string;
    rate: number;
    nextBillingDate: string;
    billingDay: number;
  }[];
}

interface Transaction {
  id: string;
  invoiceNumber: string;
  paidAt: string;
  guestName: string;
  roomNumber: string | null;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  paymentMethod: string | null;
  notes: string | null;
  badDebt?: boolean;
  badDebtNote?: string | null;
  runningBalance: number;
  items: { description: string; amount: number; taxType: string }[];
}

interface FinanceData {
  summary: {
    totalRevenue: number;
    totalNet: number;
    totalTax: number;
    transactionCount: number;
    avgPerTransaction: number;
    outstanding: number;
    overdueAmt: number;
    badDebtAmt?: number;
    todayRevenue: number;
    todayCount: number;
  };
  byPaymentMethod: Record<string, number>;
  byDay: { date: string; revenue: number; count: number; tax: number }[];
  transactions: Transaction[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const BOOKING_TYPE_LABELS: Record<string, string> = {
  daily: 'รายวัน',
  monthly_short: 'รายเดือนระยะสั้น',
  monthly_long: 'รายเดือนระยะยาว',
  walkin: 'Walk-in',
};

const PAYMENT_LABELS: Record<
  string,
  { label: string; icon: string; color: string }
> = {
  cash: { label: 'เงินสด', icon: '💵', color: '#16a34a' },
  transfer: { label: 'โอนเงิน', icon: '🏦', color: '#2563eb' },
  credit_card: { label: 'บัตรเครดิต', icon: '💳', color: '#7c3aed' },
};

const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

// ============================================================================
// UTILITIES
// ============================================================================

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 0,
  }).format(value);
}

function formatDate(dateStr: string): string {
  return fmtDate(dateStr);
}

function formatDateTime(dateStr: string): string {
  return fmtDate(dateStr);
}

// ============================================================================
// COMPONENTS
// ============================================================================

// KPI Card Component
function KPICard({
  title,
  amount,
  count,
  accentColor,
  icon,
}: {
  title: string;
  amount?: number;
  count?: number;
  accentColor: string;
  icon?: string;
}) {
  return (
    <div
      style={{
        flex: '1 1 200px',
        minWidth: '160px',
        backgroundColor: '#fff',
        border: `2px solid ${accentColor}`,
        borderRadius: '8px',
        padding: '16px',
        textAlign: 'center',
      }}
    >
      {icon && (
        <div style={{ fontSize: '24px', marginBottom: '8px' }}>{icon}</div>
      )}
      <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
        {title}
      </div>
      {amount !== undefined && (
        <div style={{ fontSize: '20px', fontWeight: 'bold', color: accentColor }}>
          {formatCurrency(amount)}
        </div>
      )}
      {count !== undefined && (
        <div style={{ fontSize: '14px', color: '#999', marginTop: '4px' }}>
          {count} รายการ
        </div>
      )}
    </div>
  );
}

// Toast Notification
function Toast({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        backgroundColor: '#10b981',
        color: '#fff',
        padding: '12px 20px',
        borderRadius: '6px',
        fontSize: '14px',
        zIndex: 1000,
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
      }}
    >
      {message}
    </div>
  );
}

// Quick Pay Modal
function QuickPayModal({
  invoice,
  onClose,
  onPaymentSuccess,
}: {
  invoice: CollectionInvoice;
  onClose: () => void;
  onPaymentSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handlePayment = async (method: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pay', paymentMethod: method }),
      });
      if (res.ok) {
        onPaymentSuccess();
        onClose();
      }
    } catch (error) {
      console.error('Payment error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-end',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '500px',
          backgroundColor: '#fff',
          borderRadius: '12px 12px 0 0',
          padding: '24px',
          marginLeft: 'auto',
          marginRight: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px' }}>
          {invoice.invoiceNumber}
        </h3>
        <div style={{ marginBottom: '12px', fontSize: '14px', color: '#666' }}>
          <div>
            {invoice.guest.firstName} {invoice.guest.lastName}
          </div>
          {invoice.room && <div>ห้อง {invoice.room.number}</div>}
          <div style={{ fontWeight: 'bold', marginTop: '8px' }}>
            {formatCurrency(invoice.grandTotal)}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '12px',
            flexDirection: 'column',
            marginTop: '20px',
          }}
        >
          {Object.entries(PAYMENT_LABELS).map(([key, { label, icon }]) => (
            <button
              key={key}
              onClick={() => handlePayment(key)}
              disabled={loading}
              style={{
                padding: '12px 16px',
                backgroundColor: '#f3f4f6',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                opacity: loading ? 0.6 : 1,
              }}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        <button
          onClick={onClose}
          style={{
            width: '100%',
            padding: '12px',
            marginTop: '12px',
            backgroundColor: '#f3f4f6',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// TAB 1: Collection Center
// ============================================================================

function CollectionCenter() {
  const [data, setData] = useState<CollectionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<CollectionInvoice | null>(
    null
  );
  const [toast, setToast] = useState('');

  const fetchCollection = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/billing/collection');
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCollection();
  }, []);

  const handleGenerateInvoices = async () => {
    try {
      const res = await fetch('/api/billing/generate-monthly', {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to generate');
      const json = await res.json();
      setToast(`✅ สร้าง ${json.created} รายการ / ข้าม ${json.skipped} รายการ`);
      fetchCollection();
    } catch (err) {
      setToast(`❌ ${(err as Error).message}`);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>กำลังโหลด...</div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px' }}>
        <div style={{ color: '#dc2626', marginBottom: '12px' }}>
          เกิดข้อผิดพลาด: {error}
        </div>
        <button
          onClick={fetchCollection}
          style={{
            padding: '8px 16px',
            backgroundColor: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          ลองอีกครั้ง
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div>
      {/* Top Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ fontSize: '24px', fontWeight: 'bold' }}>
          ศูนย์รับเงิน
        </h2>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={handleGenerateInvoices}
            style={{
              padding: '8px 16px',
              backgroundColor: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            📋 ออก Invoice เดือนนี้
          </button>
          <button
            onClick={fetchCollection}
            style={{
              padding: '8px 16px',
              backgroundColor: '#6b7280',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            🔄 รีเฟรช
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          marginBottom: '24px',
          flexWrap: 'wrap',
        }}
      >
        <KPICard
          title="🔴 เกินกำหนด"
          amount={data.summary.overdueAmount}
          count={data.summary.overdueCount}
          accentColor="#ef4444"
        />
        <KPICard
          title="🟡 ครบกำหนดวันนี้"
          amount={data.summary.dueTodayAmount}
          count={data.summary.dueTodayCount}
          accentColor="#f59e0b"
        />
        <KPICard
          title="🔵 สัปดาห์นี้"
          amount={data.summary.weekAmount}
          count={data.summary.weekCount}
          accentColor="#3b82f6"
        />
        <KPICard
          title="🟢 ยังไม่ออก Invoice"
          count={data.summary.notYetInvoicedCount}
          accentColor="#8b5cf6"
        />
      </div>

      {/* Invoice Sections */}
      {[
        { title: '🔴 เกินกำหนด', invoices: data.overdue },
        { title: '🟡 ครบกำหนดวันนี้', invoices: data.dueToday },
        { title: '🔵 สัปดาห์นี้', invoices: data.dueThisWeek },
        { title: '🟢 ยังไม่ครบกำหนด', invoices: data.upcoming },
      ].map((section) =>
        section.invoices.length > 0 ? (
          <div key={section.title} style={{ marginBottom: '24px' }}>
            <h3
              style={{
                fontSize: '16px',
                fontWeight: 'bold',
                marginBottom: '12px',
                paddingBottom: '8px',
                borderBottom: '2px solid #e5e7eb',
              }}
            >
              {section.title}
            </h3>
            {section.invoices.map((inv) => (
              <div
                key={inv.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px',
                  borderBottom: '1px solid #f3f4f6',
                  flexWrap: 'wrap',
                  gap: '12px',
                  minHeight: '60px',
                }}
              >
                <div style={{ flex: '1', minWidth: '250px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
                    🏠 ห้อง {inv.room?.number || '-'} | {inv.guest.firstName}{' '}
                    {inv.guest.lastName}
                  </div>
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    {inv.invoiceNumber} | {BOOKING_TYPE_LABELS[inv.bookingType || 'daily']} | โทร{' '}
                    {inv.guest.phone || '-'}
                  </div>
                </div>

                <div style={{ minWidth: '100px', textAlign: 'right' }}>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    {formatDate(inv.dueDate)}
                  </div>
                  {inv.daysOverdue > 0 && (
                    <div
                      style={{
                        display: 'inline-block',
                        fontSize: '11px',
                        backgroundColor: '#ef4444',
                        color: '#fff',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        marginTop: '4px',
                      }}
                    >
                      เกิน {inv.daysOverdue} วัน
                    </div>
                  )}
                </div>

                <div style={{ minWidth: '100px', textAlign: 'right' }}>
                  <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                    {formatCurrency(inv.grandTotal)}
                  </div>
                </div>

                <button
                  onClick={() => setSelectedInvoice(inv)}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#16a34a',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  รับเงิน
                </button>
              </div>
            ))}
          </div>
        ) : null
      )}

      {/* Not Yet Invoiced */}
      {data.notYetInvoiced.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h3
            style={{
              fontSize: '16px',
              fontWeight: 'bold',
              marginBottom: '12px',
              paddingBottom: '8px',
              borderBottom: '2px solid #e5e7eb',
            }}
          >
            ⚪ ยังไม่ออก Invoice
          </h3>
          {data.notYetInvoiced.map((item) => (
            <div
              key={item.bookingId}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px',
                borderBottom: '1px solid #f3f4f6',
                flexWrap: 'wrap',
                gap: '12px',
                minHeight: '60px',
              }}
            >
              <div style={{ flex: '1', minWidth: '250px' }}>
                <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
                  🏠 ห้อง {item.roomNumber} | {item.guestName}
                </div>
                <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                  วันเก็บเงิน: {item.billingDay} ของทุกเดือน | {formatCurrency(item.rate)}/เดือน
                </div>
              </div>

              <button
                style={{
                  padding: '6px 12px',
                  backgroundColor: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                ออก Invoice
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedInvoice && (
        <QuickPayModal
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          onPaymentSuccess={() => {
            setToast(`✅ รับเงิน ${formatCurrency(selectedInvoice.grandTotal)} เรียบร้อย`);
            fetchCollection();
          }}
        />
      )}

      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </div>
  );
}

// ============================================================================
// TAB 2: Transaction Ledger
// ============================================================================

function TransactionLedger() {
  const [period, setPeriod] = useState('month');
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  useEffect(() => {
    const fetchFinance = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/finance?period=${period}`);
        if (!res.ok) throw new Error('Failed to fetch');
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    fetchFinance();
  }, [period]);

  if (loading) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>กำลังโหลด...</div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px', color: '#dc2626' }}>
        เกิดข้อผิดพลาด: {error}
      </div>
    );
  }

  if (!data) return null;

  // Defensive null coalescing for data properties
  const summary = data?.summary ?? { totalRevenue: 0, totalNet: 0, totalTax: 0, transactionCount: 0, avgPerTransaction: 0, outstanding: 0, overdueAmt: 0, todayRevenue: 0, todayCount: 0 };
  const transactions = data?.transactions ?? [];

  return (
    <div>
      {/* Period Selector */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '24px',
          flexWrap: 'wrap',
        }}
      >
        {[
          { value: 'today', label: 'วันนี้' },
          { value: 'week', label: 'สัปดาห์นี้' },
          { value: 'month', label: 'เดือนนี้' },
          { value: '30days', label: '30 วันล่าสุด' },
        ].map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            style={{
              padding: '8px 16px',
              backgroundColor: period === p.value ? '#3b82f6' : '#f3f4f6',
              color: period === p.value ? '#fff' : '#000',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Summary Stats */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          marginBottom: '24px',
          flexWrap: 'wrap',
        }}
      >
        <KPICard
          title="รายรับรวม"
          amount={summary.totalRevenue}
          accentColor="#3b82f6"
        />
        <KPICard
          title="วันนี้"
          amount={summary.todayRevenue}
          accentColor="#10b981"
        />
        <KPICard
          title="ค้างชำระ"
          amount={summary.outstanding}
          accentColor="#ef4444"
        />
        <KPICard
          title="เฉลี่ย/รายการ"
          amount={summary.avgPerTransaction}
          accentColor="#f59e0b"
        />
      </div>

      {/* Transaction Table */}
      <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '14px',
            minWidth: '600px',
          }}
        >
          <thead>
            <tr style={{ backgroundColor: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: '12px', textAlign: 'left' }}>วันที่/เวลา</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>เลขที่</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>ลูกค้า/ห้อง</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>จำนวนเงิน</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>ช่องทาง</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>ยอดสะสม</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              // Use React.Fragment (not <tbody>) so we can have two sibling <tr>s
              // without creating invalid nested-<tbody> that breaks column alignment.
              <Fragment key={tx.id}>
                {/* ── main row ── */}
                <tr
                  onClick={() => setExpandedRowId(expandedRowId === tx.id ? null : tx.id)}
                  style={{
                    borderBottom: '1px solid #f3f4f6',
                    cursor: 'pointer',
                    backgroundColor: expandedRowId === tx.id ? '#f9fafb' : '#fff',
                  }}
                >
                  <td style={{ padding: '12px' }}>{formatDateTime(tx.paidAt)}</td>
                  <td style={{ padding: '12px' }}>{tx.invoiceNumber}</td>
                  <td style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>
                        {tx.guestName} {tx.roomNumber ? `/ ห้อง ${tx.roomNumber}` : ''}
                      </span>
                      {tx.badDebt && (
                        <span style={{ display: 'inline-block', fontSize: '11px', backgroundColor: '#dc2626', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
                          หนี้เสีย
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', fontWeight: 'bold', color: tx.badDebt ? '#dc2626' : '#000' }}>
                    {formatCurrency(tx.grandTotal)}
                  </td>
                  <td style={{ padding: '12px' }}>
                    {tx.badDebt ? '—' : tx.paymentMethod
                      ? PAYMENT_LABELS[tx.paymentMethod]?.label || tx.paymentMethod
                      : '-'}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    {formatCurrency(tx.runningBalance)}
                  </td>
                </tr>
                {/* ── expandable detail row ── */}
                {expandedRowId === tx.id && (
                  <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                    <td colSpan={6} style={{ padding: '12px' }}>
                      <div style={{ fontSize: '13px' }}>
                        <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>รายการ:</div>
                        {tx.items.map((item, idx) => (
                          <div key={idx} style={{ marginBottom: '4px', color: '#666' }}>
                            {item.description}: {formatCurrency(item.amount)} ({item.taxType})
                          </div>
                        ))}
                        {tx.badDebt && tx.badDebtNote && (
                          <div style={{ marginTop: '8px', color: '#dc2626', fontWeight: 'bold' }}>
                            [หนี้เสีย] {tx.badDebtNote}
                          </div>
                        )}
                        {tx.notes && (
                          <div style={{ marginTop: '8px', color: '#999' }}>
                            หมายเหตุ: {tx.notes}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer Summary */}
      <div
        style={{
          backgroundColor: '#f9fafb',
          padding: '16px',
          borderRadius: '6px',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          fontSize: '14px',
        }}
      >
        <div>
          <span style={{ color: '#666' }}>รวมรายได้: </span>
          <span style={{ fontWeight: 'bold', fontSize: '16px' }}>
            {formatCurrency(summary.totalRevenue)}
          </span>
        </div>
        <div>
          <span style={{ color: '#666' }}>รวมภาษี: </span>
          <span style={{ fontWeight: 'bold', fontSize: '16px' }}>
            {formatCurrency(summary.totalTax)}
          </span>
        </div>
        <div>
          <span style={{ color: '#666' }}>สุทธิ: </span>
          <span style={{ fontWeight: 'bold', fontSize: '16px' }}>
            {formatCurrency(summary.totalNet)}
          </span>
        </div>
        <div>
          <span style={{ color: '#666' }}>จำนวนรายการ: </span>
          <span style={{ fontWeight: 'bold' }}>{summary.transactionCount}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TAB 3: Revenue Summary
// ============================================================================

function RevenueSummary() {
  const [period, setPeriod] = useState('month');
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchFinance = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/finance?period=${period}`);
        if (!res.ok) throw new Error('Failed to fetch');
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    fetchFinance();
  }, [period]);

  if (loading) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>กำลังโหลด...</div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px', color: '#dc2626' }}>
        เกิดข้อผิดพลาด: {error}
      </div>
    );
  }

  if (!data) return null;

  // Defensive null coalescing for data properties
  const summary = data?.summary ?? { totalRevenue: 0, totalNet: 0, totalTax: 0, transactionCount: 0, avgPerTransaction: 0, outstanding: 0, overdueAmt: 0, badDebtAmt: 0, todayRevenue: 0, todayCount: 0 };
  const byDay = data?.byDay ?? [];
  const transactionsForSummary = data?.transactions ?? [];

  // Find max revenue for bar chart scaling
  const maxRevenue = Math.max(
    1,
    ...byDay.map((d) => d.revenue)
  );

  // Group transactions by booking type
  const byBookingType: Record<string, number> = {};
  transactionsForSummary.forEach((tx) => {
    const type = tx.items[0]?.description || 'อื่น ๆ';
    byBookingType[type] = (byBookingType[type] || 0) + tx.grandTotal;
  });

  return (
    <div>
      {/* Period Selector */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '24px',
          flexWrap: 'wrap',
        }}
      >
        {[
          { value: 'today', label: 'วันนี้' },
          { value: 'week', label: 'สัปดาห์นี้' },
          { value: 'month', label: 'เดือนนี้' },
          { value: '30days', label: '30 วันล่าสุด' },
        ].map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            style={{
              padding: '8px 16px',
              backgroundColor: period === p.value ? '#3b82f6' : '#f3f4f6',
              color: period === p.value ? '#fff' : '#000',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          marginBottom: '24px',
          flexWrap: 'wrap',
        }}
      >
        <KPICard
          title="รายรับในช่วง"
          amount={summary.totalRevenue}
          accentColor="#3b82f6"
        />
        <KPICard
          title="รายรับวันนี้"
          amount={summary.todayRevenue}
          accentColor="#10b981"
        />
        <KPICard
          title="ค้างชำระ"
          amount={summary.outstanding}
          accentColor="#ef4444"
        />
        <KPICard
          title="เฉลี่ย/รายการ"
          amount={summary.avgPerTransaction}
          accentColor="#f59e0b"
        />
      </div>

      {/* Bar Chart: Revenue by Day */}
      {byDay.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>
            รายรับรายวัน
          </h3>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: '8px',
              padding: '16px',
              backgroundColor: '#f9fafb',
              borderRadius: '6px',
              minHeight: '250px',
              overflowX: 'auto',
            }}
          >
            {byDay.map((day) => {
              const date = new Date(day.date);
              const dayNum = date.getDate();
              const height = (day.revenue / maxRevenue) * 200 + 20;
              return (
                <div
                  key={day.date}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '8px',
                    flex: '0 0 auto',
                    minWidth: '50px',
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: `${height}px`,
                      backgroundColor: '#3b82f6',
                      borderRadius: '4px 4px 0 0',
                    }}
                    title={`${day.date}: ${formatCurrency(day.revenue)}`}
                  />
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#666',
                      textAlign: 'center',
                      minWidth: '40px',
                    }}
                  >
                    {dayNum}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Payment Method Breakdown */}
      {Object.keys(data.byPaymentMethod ?? {}).length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>
            รายรับตามช่องทาง
          </h3>
          {Object.entries(data.byPaymentMethod ?? {}).map(([method, amount]) => {
            const percentage = data.summary.totalRevenue > 0
              ? ((amount / data.summary.totalRevenue) * 100).toFixed(1)
              : '0';
            const label = PAYMENT_LABELS[method]?.label || method;
            const color = PAYMENT_LABELS[method]?.color || '#6b7280';
            return (
              <div key={method} style={{ marginBottom: '12px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '4px',
                    fontSize: '14px',
                  }}
                >
                  <span>{label}</span>
                  <span style={{ fontWeight: 'bold' }}>
                    {percentage}% ({formatCurrency(amount)})
                  </span>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: '8px',
                    backgroundColor: '#e5e7eb',
                    borderRadius: '4px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${percentage}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Booking Type Breakdown */}
      {Object.keys(byBookingType).length > 0 && (
        <div>
          <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px' }}>
            รายรับตามประเภท
          </h3>
          {Object.entries(byBookingType).map(([type, amount]) => {
            const percentage = data.summary.totalRevenue > 0
              ? ((amount / data.summary.totalRevenue) * 100).toFixed(1)
              : '0';
            return (
              <div key={type} style={{ marginBottom: '12px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '4px',
                    fontSize: '14px',
                  }}
                >
                  <span>{type}</span>
                  <span style={{ fontWeight: 'bold' }}>
                    {percentage}% ({formatCurrency(amount)})
                  </span>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: '8px',
                    backgroundColor: '#e5e7eb',
                    borderRadius: '4px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${percentage}%`,
                      backgroundColor: '#8b5cf6',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bad Debt Summary */}
      {(summary.badDebtAmt ?? 0) > 0 && (
        <div style={{ marginTop: '24px', backgroundColor: '#fef2f2', border: '2px solid #dc2626', borderRadius: '8px', padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <div style={{ fontSize: '20px' }}>⚠️</div>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: '#dc2626', margin: 0 }}>หนี้เสีย (Bad Debt)</h3>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', color: '#6b7280' }}>ยอดหนี้เสียรวม</span>
            <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#dc2626' }}>
              {formatCurrency(summary.badDebtAmt ?? 0)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN PAGE COMPONENT
// ============================================================================

export default function FinancePage() {
  const [activeTab, setActiveTab] = useState(0);

  const tabs = [
    { label: 'ศูนย์รับเงิน', component: <CollectionCenter /> },
    { label: 'รายการเคลื่อนไหว', component: <TransactionLedger /> },
    { label: 'สรุปรายได้', component: <RevenueSummary /> },
  ];

  return (
    <div
      style={{
        fontFamily: 'Sarabun, system-ui, sans-serif',
        backgroundColor: '#fff',
        minHeight: '100vh',
        padding: '24px',
      }}
    >
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            borderBottom: '2px solid #e5e7eb',
            marginBottom: '24px',
            flexWrap: 'wrap',
          }}
        >
          {tabs.map((tab, idx) => (
            <button
              key={idx}
              onClick={() => setActiveTab(idx)}
              style={{
                padding: '12px 20px',
                backgroundColor: 'transparent',
                border: 'none',
                borderBottom: activeTab === idx ? '3px solid #3b82f6' : 'none',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: activeTab === idx ? 'bold' : 'normal',
                color: activeTab === idx ? '#3b82f6' : '#666',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div>{tabs[activeTab].component}</div>
      </div>
    </div>
  );
}
