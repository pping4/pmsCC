'use client';

/**
 * /finance — Collection Hub (consolidation Sub-step 1.2)
 *
 * Single operational page for finance/cashier staff at the start of each day:
 *  - "ยอดที่ต้องตามเก็บ" — overdue + due-today + this-week invoice queue with
 *    inline quick-pay (cash / transfer / credit_card)
 *  - Side panels summarising: pending refunds, city-ledger AR overdue, bad
 *    debt outstanding, bookings not yet invoiced
 *  - Top KPI strip with 4 metrics + 1 today's revenue
 *
 * The previous "รายการเคลื่อนไหว" / "สรุปรายได้" tabs moved to /finance/statements
 * in Sub-step 1.3 — replaced here with deep links so staff can drill in.
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { fmtDate, fmtBaht } from '@/lib/date-format';
import { useToast } from '@/components/ui';
import { DataTable, type ColDef } from '@/components/data-table';

// ─── Types ────────────────────────────────────────────────────────────────────

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
  overdue:        CollectionInvoice[];
  dueToday:       CollectionInvoice[];
  dueThisWeek:    CollectionInvoice[];
  upcoming:       CollectionInvoice[];
  notYetInvoiced: { bookingId: string; guestName: string; roomNumber: string; rate: number; nextBillingDate: string; billingDay: number }[];
}

interface RefundsSummary { pendingCount: number; pendingTotal: number }
interface BadDebtSummary { unpaidCount: number; totalOutstanding: number }
interface CitySummary { totalOutstanding: number; overdueOver30: number; suspendedAccounts: number }

const BOOKING_TYPE_LABELS: Record<string, string> = {
  daily:         'รายวัน',
  monthly_short: 'รายเดือนระยะสั้น',
  monthly_long:  'รายเดือนระยะยาว',
  walkin:        'Walk-in',
};

const PAYMENT_LABELS: Record<string, { label: string; icon: string }> = {
  cash:        { label: 'เงินสด',     icon: '💵' },
  transfer:    { label: 'โอนเงิน',     icon: '🏦' },
  credit_card: { label: 'บัตรเครดิต',  icon: '💳' },
};

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KPICard({ title, primary, secondary, icon, accent, href }: {
  title:     string;
  primary:   string;
  secondary?: string;
  icon:      string;
  accent:    string;       // any CSS color (var() or hex)
  href?:     string;       // when provided, the whole card is a link
}) {
  const inner = (
    <div
      className="pms-card pms-transition p-4 flex items-start gap-3"
      style={{
        background: 'var(--surface-card)',
        border: `1px solid ${accent}33`,
        borderLeft: `4px solid ${accent}`,
        cursor: href ? 'pointer' : 'default',
      }}
    >
      <div className="text-2xl leading-none">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{title}</div>
        <div className="text-xl font-semibold font-mono mt-0.5" style={{ color: accent }}>{primary}</div>
        {secondary && <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{secondary}</div>}
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

// ─── Quick-Pay Modal ─────────────────────────────────────────────────────────

function QuickPayModal({ invoice, onClose, onSuccess }: {
  invoice: CollectionInvoice;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  const handlePay = async (method: string) => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pay', paymentMethod: method }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `HTTP ${res.status}`);
      }
      toast.success('บันทึกการชำระเงินสำเร็จ', invoice.invoiceNumber);
      onSuccess();
      onClose();
    } catch (e) {
      toast.error('บันทึกการชำระไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-0 md:p-4"
      onClick={onClose}
    >
      <div
        className="pms-card w-full max-w-md p-5 space-y-3 rounded-t-xl md:rounded-xl"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--border-default)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            {invoice.invoiceNumber}
          </h3>
          <button onClick={onClose} className="text-xl leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
          <div>{invoice.guest.firstName} {invoice.guest.lastName}</div>
          {invoice.room && <div>ห้อง {invoice.room.number}</div>}
        </div>
        <div className="text-2xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
          ฿{fmtBaht(invoice.grandTotal)}
        </div>
        <div className="grid grid-cols-1 gap-2 pt-2">
          {Object.entries(PAYMENT_LABELS).map(([key, { label, icon }]) => (
            <button
              key={key}
              onClick={() => handlePay(key)}
              disabled={loading}
              className="px-4 py-3 rounded-lg border text-sm text-left disabled:opacity-50 hover:bg-gray-50 transition"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)', background: 'var(--surface-card)' }}
            >
              <span className="text-lg mr-2">{icon}</span>{label}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          disabled={loading}
          className="w-full px-3 py-2 rounded-lg border text-sm disabled:opacity-50"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
        >ยกเลิก</button>
      </div>
    </div>
  );
}

// ─── Side panels ─────────────────────────────────────────────────────────────

function SidePanel({ title, icon, children, footer }: {
  title: string;
  icon:  string;
  children: React.ReactNode;
  footer?:  React.ReactNode;
}) {
  return (
    <section
      className="pms-card pms-transition p-4 space-y-2"
      style={{ background: 'var(--surface-card)', border: '1px solid var(--border-light)' }}
    >
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        <span className="mr-1">{icon}</span>{title}
      </h3>
      <div className="text-sm">{children}</div>
      {footer && <div className="pt-1 text-xs">{footer}</div>}
    </section>
  );
}

function RefundsPanel() {
  const [data, setData] = useState<RefundsSummary | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/refunds?status=pending');
        const j   = await res.json();
        const rows: { amount: number }[] = j?.records ?? [];
        setData({
          pendingCount: rows.length,
          pendingTotal: rows.reduce((s, r) => s + Number(r.amount), 0),
        });
      } catch { /* ignore */ }
    })();
  }, []);
  return (
    <SidePanel title="คำขอคืนเงิน (Refunds)" icon="🔄"
      footer={<Link href="/refunds" className="text-blue-600 hover:underline">จัดการ →</Link>}>
      {!data ? (
        <p style={{ color: 'var(--text-muted)' }}>กำลังโหลด…</p>
      ) : data.pendingCount === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>— ไม่มีคำขอรอดำเนินการ —</p>
      ) : (
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono" style={{ color: '#dc2626' }}>{data.pendingCount}</span>
            <span style={{ color: 'var(--text-muted)' }}>คำขอ</span>
          </div>
          <div className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
            ยอดรวม ฿{fmtBaht(data.pendingTotal)}
          </div>
        </div>
      )}
    </SidePanel>
  );
}

function BadDebtPanel() {
  const [data, setData] = useState<BadDebtSummary | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/bad-debt');
        const j   = await res.json();
        setData({
          unpaidCount:      j?.summary?.unpaidCount ?? 0,
          totalOutstanding: j?.summary?.totalOutstanding ?? 0,
        });
      } catch { /* ignore */ }
    })();
  }, []);
  return (
    <SidePanel title="หนี้เสีย (Bad Debt)" icon="⚠️"
      footer={<Link href="/bad-debt" className="text-blue-600 hover:underline">รายการทั้งหมด →</Link>}>
      {!data ? (
        <p style={{ color: 'var(--text-muted)' }}>กำลังโหลด…</p>
      ) : data.unpaidCount === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>— ไม่มีหนี้เสียค้าง —</p>
      ) : (
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono" style={{ color: '#b45309' }}>{data.unpaidCount}</span>
            <span style={{ color: 'var(--text-muted)' }}>รายการค้าง</span>
          </div>
          <div className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
            ยอดรวม ฿{fmtBaht(data.totalOutstanding)}
          </div>
        </div>
      )}
    </SidePanel>
  );
}

function CityLedgerPanel() {
  const [data, setData] = useState<CitySummary | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/city-ledger/summary');
        const j   = await res.json();
        setData({
          totalOutstanding:  Number(j?.totalOutstanding  ?? 0),
          overdueOver30:     Number(j?.overdueOver30     ?? 0),
          suspendedAccounts: Number(j?.suspendedAccounts ?? 0),
        });
      } catch { /* ignore */ }
    })();
  }, []);
  return (
    <SidePanel title="City Ledger / AR องค์กร" icon="🏢"
      footer={<Link href="/city-ledger" className="text-blue-600 hover:underline">บัญชีทั้งหมด →</Link>}>
      {!data ? (
        <p style={{ color: 'var(--text-muted)' }}>กำลังโหลด…</p>
      ) : data.totalOutstanding === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>— ไม่มียอดค้าง —</p>
      ) : (
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
              ฿{fmtBaht(data.totalOutstanding)}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>คงค้างรวม</span>
          </div>
          {data.overdueOver30 > 0 && (
            <div className="text-sm font-mono" style={{ color: '#dc2626' }}>
              เกิน 30 วัน: ฿{fmtBaht(data.overdueOver30)}
            </div>
          )}
          {data.suspendedAccounts > 0 && (
            <div className="text-xs" style={{ color: '#b45309' }}>
              ⚠️ {data.suspendedAccounts} บัญชีถูกระงับ
            </div>
          )}
        </div>
      )}
    </SidePanel>
  );
}

function NotYetInvoicedPanel({ data }: { data: CollectionData['notYetInvoiced'] }) {
  const [generating, setGenerating] = useState(false);
  const toast = useToast();
  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/billing/generate-monthly', { method: 'POST' });
      const j   = await res.json();
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      toast.success('สร้าง Invoice สำเร็จ', `${j?.created ?? 0} รายการ`);
      window.location.reload();
    } catch (e) {
      toast.error('สร้าง Invoice ไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setGenerating(false);
    }
  };
  return (
    <SidePanel title="ยังไม่ออก Invoice" icon="📅"
      footer={data.length > 0
        ? <button onClick={handleGenerate} disabled={generating}
            className="text-blue-600 hover:underline disabled:opacity-50">
            {generating ? 'กำลังสร้าง…' : 'สร้าง Invoice รายเดือน →'}
          </button>
        : null}>
      {data.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>— ทุก booking ออก invoice แล้ว —</p>
      ) : (
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono" style={{ color: '#2563eb' }}>{data.length}</span>
            <span style={{ color: 'var(--text-muted)' }}>booking รอออกบิล</span>
          </div>
          <div className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
            ยอดรวม ฿{fmtBaht(data.reduce((s, r) => s + r.rate, 0))}/เดือน
          </div>
        </div>
      )}
    </SidePanel>
  );
}

// ─── Collection Queue (main panel) ───────────────────────────────────────────

type Tier = 'overdue' | 'dueToday' | 'dueThisWeek' | 'upcoming';

function CollectionQueue({ data, onPaid }: {
  data:   CollectionData;
  onPaid: () => void;
}) {
  const [tier,   setTier]   = useState<Tier>('overdue');
  const [active, setActive] = useState<CollectionInvoice | null>(null);

  const rows: CollectionInvoice[] = (
    tier === 'overdue'     ? data.overdue :
    tier === 'dueToday'    ? data.dueToday :
    tier === 'dueThisWeek' ? data.dueThisWeek :
                             data.upcoming
  );

  type ColKey = 'invoiceNumber' | 'guest' | 'room' | 'bookingType' | 'amount' | 'dueDate' | 'overdue' | 'actions';
  const cols: ColDef<CollectionInvoice, ColKey>[] = [
    {
      key: 'invoiceNumber', label: 'เลขที่', minW: 130,
      getValue: r => r.invoiceNumber,
      render:   r => <span className="font-mono text-blue-600">{r.invoiceNumber}</span>,
    },
    {
      key: 'guest', label: 'ลูกค้า', minW: 150,
      getValue: r => `${r.guest.firstName} ${r.guest.lastName}`,
      render:   r => <span style={{ color: 'var(--text-primary)' }}>{r.guest.firstName} {r.guest.lastName}</span>,
    },
    {
      key: 'room', label: 'ห้อง', minW: 80,
      getValue: r => r.room?.number ?? '',
      render:   r => <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{r.room?.number ?? '—'}</span>,
    },
    {
      key: 'bookingType', label: 'ประเภท', minW: 110,
      getValue: r => r.bookingType ?? '',
      getLabel: r => r.bookingType ? (BOOKING_TYPE_LABELS[r.bookingType] ?? r.bookingType) : '—',
      render:   r => r.bookingType ? <span className="text-xs">{BOOKING_TYPE_LABELS[r.bookingType] ?? r.bookingType}</span> : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      key: 'amount', label: 'ยอด', align: 'right', minW: 110,
      getValue:  r => String(Math.round(r.grandTotal * 100)).padStart(12, '0'),
      getLabel:  r => `฿${fmtBaht(r.grandTotal)}`,
      aggregate: 'sum',
      aggValue:  r => r.grandTotal,
      render:    r => <span className="font-mono" style={{ color: 'var(--text-primary)' }}>฿{fmtBaht(r.grandTotal)}</span>,
    },
    {
      key: 'dueDate', label: 'ครบกำหนด', minW: 110,
      getValue: r => r.dueDate.slice(0, 10),
      getLabel: r => fmtDate(r.dueDate),
      render:   r => <span className="font-mono text-xs">{fmtDate(r.dueDate)}</span>,
    },
    {
      key: 'overdue', label: 'ค้าง (วัน)', align: 'right', minW: 90,
      getValue: r => String(Math.max(0, r.daysOverdue)).padStart(4, '0'),
      getLabel: r => r.daysOverdue > 0 ? `${r.daysOverdue} วัน` : '—',
      render:   r => r.daysOverdue > 0
        ? <span className="font-mono" style={{ color: r.daysOverdue >= 7 ? '#dc2626' : '#b45309' }}>{r.daysOverdue} วัน</span>
        : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      key: 'actions', label: '', align: 'center', minW: 100,
      getValue: () => '',
      render: r => (
        <button
          onClick={() => setActive(r)}
          className="px-3 py-1 rounded text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white"
        >รับชำระ</button>
      ),
    },
  ];

  return (
    <section
      className="pms-card pms-transition p-4 space-y-3"
      style={{ background: 'var(--surface-card)', border: '1px solid var(--border-light)' }}
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          📋 รายการต้องตามเก็บ
        </h2>
        <div className="flex gap-1 flex-wrap">
          {([
            ['overdue',     `เกินกำหนด (${data.summary.overdueCount})`],
            ['dueToday',    `วันนี้ (${data.summary.dueTodayCount})`],
            ['dueThisWeek', `สัปดาห์นี้ (${data.summary.weekCount})`],
            ['upcoming',    `ที่จะมาถึง (${data.upcoming.length})`],
          ] as [Tier, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTier(key)}
              className={`px-3 py-1 rounded text-xs font-medium border ${
                tier === key ? 'bg-blue-600 text-white border-blue-600' : ''
              }`}
              style={tier === key ? {} : { borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
            >{label}</button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>
          — ไม่มีรายการในกลุ่มนี้ —
        </p>
      ) : (
        <DataTable
          rows={rows}
          columns={cols}
          rowKey={r => r.id}
          defaultSort={{ col: 'overdue', dir: 'desc' }}
        />
      )}

      {active && (
        <QuickPayModal
          invoice={active}
          onClose={() => setActive(null)}
          onSuccess={onPaid}
        />
      )}
    </section>
  );
}

// ─── Today's Cash-In summary (small KPI panel) ───────────────────────────────

interface TodaySnapshot { todayRevenue: number; todayCount: number }

function useTodaySnapshot(): TodaySnapshot | null {
  const [data, setData] = useState<TodaySnapshot | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/finance?period=today');
        const j   = await res.json();
        setData({
          todayRevenue: Number(j?.summary?.todayRevenue ?? j?.summary?.totalRevenue ?? 0),
          todayCount:   Number(j?.summary?.todayCount ?? j?.summary?.transactionCount ?? 0),
        });
      } catch { /* ignore */ }
    })();
  }, []);
  return data;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FinancePage() {
  const [data,    setData]    = useState<CollectionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const today = useTodaySnapshot();

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/collection');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>กำลังโหลด…</p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <p className="text-sm text-red-600">{error ?? 'ไม่พบข้อมูล'}</p>
      </div>
    );
  }

  const collectableTotal = data.summary.overdueAmount + data.summary.dueTodayAmount;
  const collectableCount = data.summary.overdueCount + data.summary.dueTodayCount;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            💰 ศูนย์การเงิน
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            รายการที่ต้องตามเก็บ + คำขอคืนเงิน + บัญชีองค์กร — ภาพรวมประจำวันสำหรับการเงิน/แคชเชียร์
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/finance/statements" className="px-3 py-1.5 rounded-lg border text-sm"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
            📊 งบการเงิน / รายงาน
          </Link>
          <Link href="/finance/money-overview" className="px-3 py-1.5 rounded-lg border text-sm"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
            💵 ภาพรวมเงิน
          </Link>
        </div>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          icon="🔴"
          title="ค้างเก็บรวม (เกินกำหนด + วันนี้)"
          primary={`฿${fmtBaht(collectableTotal)}`}
          secondary={`${collectableCount} รายการ`}
          accent="#dc2626"
        />
        <KPICard
          icon="📅"
          title="สัปดาห์นี้"
          primary={`฿${fmtBaht(data.summary.weekAmount)}`}
          secondary={`${data.summary.weekCount} รายการ`}
          accent="#b45309"
        />
        <KPICard
          icon="✅"
          title="รับเงินวันนี้"
          primary={`฿${fmtBaht(today?.todayRevenue ?? 0)}`}
          secondary={`${today?.todayCount ?? 0} รายการ`}
          accent="#16a34a"
          href="/finance/statements?period=today"
        />
        <KPICard
          icon="📋"
          title="ที่จะมาถึง + รอออกบิล"
          primary={`${data.upcoming.length + data.summary.notYetInvoicedCount}`}
          secondary={`฿${fmtBaht(data.summary.upcomingAmount)} กำลังจะถึง`}
          accent="#2563eb"
        />
      </div>

      {/* Main + side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <CollectionQueue data={data} onPaid={reload} />
        </div>
        <aside className="space-y-3">
          <RefundsPanel />
          <CityLedgerPanel />
          <BadDebtPanel />
          <NotYetInvoicedPanel data={data.notYetInvoiced} />
        </aside>
      </div>

      {/* Cross-link to month picker for monthly automations */}
      <footer className="pt-3 text-xs flex flex-wrap gap-3" style={{ color: 'var(--text-muted)' }}>
        <Link href="/billing-cycle" className="text-blue-600 hover:underline">📆 รอบบิล / ค่าปรับ →</Link>
        <Link href="/billing/folio" className="text-blue-600 hover:underline">📒 Guest Folio →</Link>
        <Link href="/accounting/tax-invoices" className="text-blue-600 hover:underline">🧾 ใบกำกับภาษี →</Link>
      </footer>
    </div>
  );
}
