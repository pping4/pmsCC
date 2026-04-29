/**
 * /finance/statements — All financial reports in one place (consolidation 1.3)
 *
 * 5 tabs:
 *   1. งบกำไรขาดทุน (P&L)        — ledger-derived
 *   2. งบดุล (Balance Sheet)      — ledger-derived
 *   3. รายได้ตามช่วงเวลา           — daily bars + by-method + by-booking-type
 *   4. รายการเคลื่อนไหว (Tx)       — transaction ledger w/ running balance
 *   5. รายงาน VAT (ภ.พ.30)        — VAT sales report w/ CSV export
 *
 * URL state: ?tab=pl|bs|revenue|tx|vat plus per-tab range params, so the
 * Collection Hub deep-link `/finance/statements?period=today` lands on
 * the Revenue tab with the right range.
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { fmtBaht, fmtDate, fmtDateTime, toDateStr } from '@/lib/date-format';

type TabKey = 'pl' | 'bs' | 'revenue' | 'tx' | 'vat';

type Period = 'today' | 'week' | 'month' | '30days';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'pl',       label: '📊 งบกำไรขาดทุน (P&L)' },
  { key: 'bs',       label: '📋 งบดุล (Balance Sheet)' },
  { key: 'revenue',  label: '📈 รายได้ตามช่วงเวลา' },
  { key: 'tx',       label: '📒 รายการเคลื่อนไหว' },
  { key: 'vat',      label: '🧾 รายงาน VAT (ภ.พ.30)' },
];

// ─── Types ────────────────────────────────────────────────────────────────

type Kind = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

interface AccountRow {
  id: string; code: string; name: string; kind: Kind; subKind: string; balance: number;
}

interface PLData {
  type: 'pl';
  window: { from: string; to: string };
  revenue: AccountRow[]; expense: AccountRow[];
  /**
   * Refunds netted into revenue, surfaced as a visibility line.
   * count > 0 → render "หัก: คืนเงิน ฿X (N รายการ)" under revenue.
   */
  refunds?: { total: number; count: number };
  totals: { revenue: number; expense: number; netIncome: number };
}

interface BSData {
  type: 'bs';
  asOf: string;
  assets: AccountRow[]; liabilities: AccountRow[]; equity: AccountRow[];
  retainedEarnings: number;
  totals: { assets: number; liabilities: number; equity: number; balanceCheck: number };
}

interface FinanceTx {
  id: string;
  invoiceNumber: string;
  paidAt: string;
  guestName: string;
  roomNumber: string | null;
  bookingId: string | null;       // 5.2: drill to folio
  folioId: string | null;
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
    totalRevenue: number; totalNet: number; totalTax: number;
    transactionCount: number; avgPerTransaction: number;
    outstanding: number; overdueAmt: number; badDebtAmt?: number;
    todayRevenue: number; todayCount: number;
  };
  byPaymentMethod: Record<string, number>;
  byDay: { date: string; revenue: number; count: number; tax: number }[];
  transactions: FinanceTx[];
}

interface VatItem {
  invoiceId: string; invoiceNumber: string; issueDate: string;
  customerName: string; customerTaxId: string;
  subtotal: number; serviceCharge: number; taxableBase: number;
  vatAmount: number; grandTotal: number; vatInclusive: boolean;
}
interface VatTotals {
  subtotal: number; serviceCharge: number; taxableBase: number;
  vatAmount: number; grandTotal: number;
}

const PAYMENT_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  cash:        { label: 'เงินสด',     icon: '💵', color: '#16a34a' },
  transfer:    { label: 'โอนเงิน',     icon: '🏦', color: '#2563eb' },
  credit_card: { label: 'บัตรเครดิต', icon: '💳', color: '#7c3aed' },
  promptpay:   { label: 'พร้อมเพย์',   icon: '📱', color: '#0891b2' },
  ota_collect: { label: 'OTA',        icon: '🌐', color: '#db2777' },
};

function defaultPLRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: toDateStr(from), to: toDateStr(now) };
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function StatementsPage() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Map ?tab=... + ?period=... → initial tab. The Collection Hub deep-link
  // uses ?period=today which we route to the Revenue tab.
  const initialTab: TabKey = (() => {
    const t = searchParams.get('tab');
    if (t && TABS.some((x) => x.key === t)) return t as TabKey;
    if (searchParams.get('period')) return 'revenue';
    return 'pl';
  })();
  const [tab, setTab] = useState<TabKey>(initialTab);

  const switchTab = useCallback((next: TabKey) => {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/finance/statements?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  if (status === 'loading') return <div style={{ padding: 24 }}>กำลังโหลด…</div>;

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>📈 งบการเงิน / รายงาน</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
          งบกำไรขาดทุน · งบดุล · รายได้ · รายการเคลื่อนไหว · ภ.พ.30 — คำนวณจาก ledger อัตโนมัติ
        </p>
      </header>

      <nav role="tablist" style={{
        display: 'flex', gap: 4, borderBottom: '1px solid var(--border-default)',
        marginBottom: 16, flexWrap: 'wrap',
      }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => switchTab(t.key)}
            style={{
              padding: '10px 16px', border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--primary-light)' : '2px solid transparent',
              marginBottom: -1,
              background: 'transparent',
              color: tab === t.key ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: tab === t.key ? 600 : 400,
              cursor: 'pointer', fontSize: 14,
            }}
          >{t.label}</button>
        ))}
      </nav>

      {tab === 'pl'      && <PLTab />}
      {tab === 'bs'      && <BSTab />}
      {tab === 'revenue' && <RevenueTab initialPeriod={(searchParams.get('period') as Period) || 'month'} />}
      {tab === 'tx'      && <TransactionsTab initialPeriod={(searchParams.get('period') as Period) || 'month'} />}
      {tab === 'vat'     && <VatTab />}
    </div>
  );
}

// ─── Tab 1 — P&L ──────────────────────────────────────────────────────────

function PLTab() {
  const [range, setRange] = useState(defaultPLRange);
  const [data,  setData]  = useState<PLData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ type: 'pl', from: range.from, to: range.to });
      const res = await fetch(`/api/reports/financial?${qs}`);
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, [range.from, range.to]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <FilterBar>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>ช่วงวันที่</span>
        <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} style={inputSx} />
        <span style={{ color: 'var(--text-muted)' }}>→</span>
        <input type="date" value={range.to}   onChange={(e) => setRange({ ...range, to:   e.target.value })} style={inputSx} />
        <button onClick={load} style={{ ...inputSx, cursor: 'pointer', background: 'var(--surface-muted)' }}>คำนวณ</button>
      </FilterBar>
      {loading && <Loading />}
      {data && (
        <>
          <Section title="รายได้ (Revenue)" rows={data.revenue} total={data.totals.revenue} color="#166534" bg="#f0fdf4" />
          {/* Visibility line: refunds processed in this period.  Already
              netted into the revenue total above (DR Revenue / CR Cash) but
              cashiers couldn't see them — surface count + amount so the
              manager can confirm refunds happened and reconcile. */}
          {data.refunds && data.refunds.count > 0 && (
            <div className="pms-card pms-transition" style={{
              padding: 12, marginTop: 8,
              borderLeft: '4px solid #f59e0b',
              background: '#fffbeb',
              fontSize: 13, color: '#78350f',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span><strong>หัก: คืนเงินที่ดำเนินการแล้ว</strong> ({data.refunds.count} รายการ)</span>
                <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>−฿{fmtBaht(data.refunds.total)}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>
                เงินที่คืนให้ลูกค้าในช่วงนี้ — ยอดนี้ <em>ลด</em> รายได้รวมข้างบนแล้ว
              </div>
            </div>
          )}
          <Section title="ค่าใช้จ่าย (Expense)" rows={data.expense} total={data.totals.expense} color="#991b1b" bg="#fee2e2" />
          <div className="pms-card pms-transition" style={{
            padding: 16, marginTop: 12,
            background: data.totals.netIncome >= 0
              ? 'linear-gradient(135deg, #166534 0%, #16a34a 100%)'
              : 'linear-gradient(135deg, #991b1b 0%, #dc2626 100%)',
            color: '#fff',
          }}>
            <div style={{ fontSize: 13, opacity: 0.9 }}>กำไร(ขาดทุน)สุทธิ</div>
            <div style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              ฿{fmtBaht(data.totals.netIncome)}
            </div>
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>
              {fmtDate(new Date(range.from))} – {fmtDate(new Date(range.to))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── Tab 2 — Balance Sheet ────────────────────────────────────────────────

function BSTab() {
  const [asOf, setAsOf] = useState(() => toDateStr(new Date()));
  const [data, setData] = useState<BSData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ type: 'bs', asOf });
      const res = await fetch(`/api/reports/financial?${qs}`);
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, [asOf]);
  useEffect(() => { load(); }, [load]);

  if (!data && !loading) return null;
  if (!data) return <Loading />;

  const balanced = Math.abs(data.totals.balanceCheck) < 0.01;
  return (
    <>
      <FilterBar>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>ณ วันที่</span>
        <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={inputSx} />
        <button onClick={load} style={{ ...inputSx, cursor: 'pointer', background: 'var(--surface-muted)' }}>คำนวณ</button>
      </FilterBar>
      <Section title="สินทรัพย์ (Assets)" rows={data.assets} total={data.totals.assets} color="#1e40af" bg="#eff6ff" />
      <Section title="หนี้สิน (Liabilities)" rows={data.liabilities} total={data.totals.liabilities} color="#92400e" bg="#fef3c7" />
      <Section
        title="ส่วนของเจ้าของ (Equity)"
        rows={data.equity}
        total={data.totals.equity}
        color="#6b21a8" bg="#faf5ff"
        extraFooter={
          <div style={{ ...footRowSx, fontStyle: 'italic', color: 'var(--text-muted)' }}>
            <span>กำไรสะสม (คำนวณจากรายได้ − ค่าใช้จ่าย)</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>฿{fmtBaht(data.retainedEarnings)}</span>
          </div>
        }
      />
      <div className="pms-card pms-transition" style={{
        padding: 16, marginTop: 12,
        background: balanced ? '#f0fdf4' : '#fee2e2',
        color: balanced ? '#166534' : '#991b1b',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>
            {balanced ? '✓ สมการบัญชีสมดุล' : '⚠ บัญชีไม่สมดุล — ตรวจสอบการโพสต์'}
          </span>
          <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
            สินทรัพย์ ฿{fmtBaht(data.totals.assets)} = หนี้สิน ฿{fmtBaht(data.totals.liabilities)} + ส่วนของเจ้าของ ฿{fmtBaht(data.totals.equity)}
          </span>
        </div>
        {!balanced && (
          <div style={{ fontSize: 12, marginTop: 6 }}>ส่วนต่าง: ฿{fmtBaht(data.totals.balanceCheck)}</div>
        )}
      </div>
    </>
  );
}

// ─── Tab 3 — Revenue Breakdown ────────────────────────────────────────────

function RevenueTab({ initialPeriod }: { initialPeriod: Period }) {
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/finance?period=${period}`)
      .then((r) => r.ok ? r.json() : null)
      .then(setData)
      .finally(() => setLoading(false));
  }, [period]);

  const maxByDay = useMemo(() => {
    if (!data) return 0;
    return Math.max(...data.byDay.map((d) => d.revenue), 1);
  }, [data]);

  const totalByMethod = useMemo(() => {
    if (!data) return 0;
    return Object.values(data.byPaymentMethod).reduce((s, v) => s + v, 0) || 1;
  }, [data]);

  return (
    <>
      <FilterBar>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>ช่วงเวลา</span>
        {(['today', 'week', 'month', '30days'] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            style={{
              ...inputSx,
              cursor: 'pointer',
              background: period === p ? 'var(--primary-light)' : 'var(--surface-muted)',
              color: period === p ? '#fff' : 'var(--text-primary)',
              fontWeight: period === p ? 600 : 400,
            }}
          >
            {p === 'today' ? 'วันนี้' : p === 'week' ? '7 วัน' : p === 'month' ? 'เดือนนี้' : '30 วัน'}
          </button>
        ))}
      </FilterBar>

      {loading && <Loading />}
      {data && (
        <>
          {/* KPIs */}
          <div style={{
            display: 'grid', gap: 10,
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            marginBottom: 12,
          }}>
            <Kpi label="รายรับรวม" value={`฿${fmtBaht(data.summary.totalRevenue)}`} accent="#16a34a" />
            <Kpi label="วันนี้"    value={`฿${fmtBaht(data.summary.todayRevenue)}`} accent="#2563eb" sub={`${data.summary.todayCount} รายการ`} />
            <Kpi label="ค้างชำระ" value={`฿${fmtBaht(data.summary.outstanding)}`} accent="#dc2626" sub={data.summary.overdueAmt > 0 ? `เกินกำหนด ฿${fmtBaht(data.summary.overdueAmt)}` : undefined} />
            <Kpi label="เฉลี่ย/รายการ" value={`฿${fmtBaht(data.summary.avgPerTransaction)}`} sub={`รวม ${data.summary.transactionCount} รายการ`} />
          </div>

          {/* Daily bar chart */}
          <Section
            title="รายได้รายวัน"
            color="#0c4a6e" bg="#e0f2fe"
            customBody={
              data.byDay.length === 0 ? (
                <div style={{ padding: '12px 10px', fontSize: 13, color: 'var(--text-muted)' }}>ไม่มีข้อมูลในช่วงนี้</div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 200, padding: '8px 4px' }}>
                  {data.byDay.map((d) => {
                    const h = Math.max(2, Math.round((d.revenue / maxByDay) * 180));
                    return (
                      <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }} title={`${d.date}: ฿${fmtBaht(d.revenue)} (${d.count} รายการ)`}>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {d.revenue > 0 ? fmtBaht(d.revenue).split('.')[0] : ''}
                        </div>
                        <div style={{ width: '100%', height: h, background: '#0ea5e9', borderRadius: '2px 2px 0 0', minHeight: 2 }} />
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                          {d.date.slice(5)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            }
          />

          {/* By payment method */}
          <Section
            title="แยกตามช่องทางชำระ"
            color="#0c4a6e" bg="#e0f2fe"
            customBody={
              <div style={{ padding: 8 }}>
                {Object.keys(data.byPaymentMethod).length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>ไม่มีข้อมูล</div>
                ) : (
                  Object.entries(data.byPaymentMethod).sort(([,a],[,b]) => b - a).map(([method, amount]) => {
                    const pct = (amount / totalByMethod) * 100;
                    const meta = PAYMENT_LABELS[method] ?? { label: method, icon: '💰', color: '#6b7280' };
                    return (
                      <div key={method} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                          <span>{meta.icon} {meta.label}</span>
                          <span style={{ fontVariantNumeric: 'tabular-nums', color: meta.color, fontWeight: 600 }}>
                            ฿{fmtBaht(amount)} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({pct.toFixed(1)}%)</span>
                          </span>
                        </div>
                        <div style={{ height: 6, background: 'var(--surface-muted)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: meta.color }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            }
          />

          {data.summary.badDebtAmt && data.summary.badDebtAmt > 0 && (
            <div className="pms-card" style={{ padding: 12, marginTop: 12, background: '#fef3c7', borderLeft: '4px solid #d97706' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#92400e' }}>
                ⚠️ มีหนี้เสียบันทึกในช่วงนี้ ฿{fmtBaht(data.summary.badDebtAmt)}
              </div>
              <div style={{ fontSize: 12, color: '#78350f', marginTop: 2 }}>
                ดูรายละเอียดได้ที่หน้า <a href="/bad-debt" style={{ textDecoration: 'underline' }}>หนี้เสีย / Bad Debt</a>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ─── Tab 4 — Transactions Ledger ──────────────────────────────────────────

function TransactionsTab({ initialPeriod }: { initialPeriod: Period }) {
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    fetch(`/api/finance?period=${period}`)
      .then((r) => r.ok ? r.json() : null)
      .then(setData)
      .finally(() => setLoading(false));
  }, [period]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <>
      <FilterBar>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>ช่วงเวลา</span>
        {(['today', 'week', 'month', '30days'] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            style={{
              ...inputSx, cursor: 'pointer',
              background: period === p ? 'var(--primary-light)' : 'var(--surface-muted)',
              color: period === p ? '#fff' : 'var(--text-primary)',
              fontWeight: period === p ? 600 : 400,
            }}
          >
            {p === 'today' ? 'วันนี้' : p === 'week' ? '7 วัน' : p === 'month' ? 'เดือนนี้' : '30 วัน'}
          </button>
        ))}
      </FilterBar>

      {loading && <Loading />}

      {data && (
        <div className="pms-card pms-transition" style={{ padding: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface-subtle)', textAlign: 'left' }}>
                <th style={thSx}></th>
                <th style={thSx}>วันที่</th>
                <th style={thSx}>เลขใบ</th>
                <th style={thSx}>ลูกค้า</th>
                <th style={thSx}>ห้อง</th>
                <th style={thSx}>วิธี</th>
                <th style={{ ...thSx, textAlign: 'right' }}>มูลค่า</th>
                <th style={{ ...thSx, textAlign: 'right' }}>VAT</th>
                <th style={{ ...thSx, textAlign: 'right' }}>รวม</th>
                <th style={{ ...thSx, textAlign: 'right' }}>คงเหลือสะสม</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((t, idx) => {
                const meta = t.paymentMethod ? PAYMENT_LABELS[t.paymentMethod] : null;
                const open = expanded.has(t.id);
                return (
                  <>
                    <tr
                      key={t.id}
                      onClick={() => toggle(t.id)}
                      style={{
                        background: t.badDebt
                          ? '#fef2f2'
                          : idx % 2 ? 'var(--surface-subtle)' : 'var(--surface-card)',
                        cursor: 'pointer',
                      }}
                    >
                      <td style={tdSx}>{open ? '▼' : '▸'}</td>
                      <td style={tdSx}>{fmtDateTime(t.paidAt)}</td>
                      <td style={{ ...tdSx, fontFamily: 'monospace' }}>
                        {t.bookingId ? (
                          <a
                            href={`/billing/folio?bookingId=${t.bookingId}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: '#2563eb', textDecoration: 'underline' }}
                            title="ดู folio"
                          >{t.invoiceNumber}</a>
                        ) : (
                          t.invoiceNumber
                        )}
                      </td>
                      <td style={tdSx}>
                        {t.guestName}
                        {t.badDebt && <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', background: '#fee2e2', color: '#991b1b', borderRadius: 999 }}>หนี้เสีย</span>}
                      </td>
                      <td style={tdSx}>{t.roomNumber ?? '—'}</td>
                      <td style={tdSx}>{meta ? `${meta.icon} ${meta.label}` : '—'}</td>
                      <td style={{ ...tdSx, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtBaht(t.subtotal)}</td>
                      <td style={{ ...tdSx, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtBaht(t.taxTotal)}</td>
                      <td style={{ ...tdSx, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtBaht(t.grandTotal)}</td>
                      <td style={{ ...tdSx, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>{fmtBaht(t.runningBalance)}</td>
                    </tr>
                    {open && (
                      <tr key={t.id + '-items'} style={{ background: idx % 2 ? 'var(--surface-subtle)' : 'var(--surface-card)' }}>
                        <td colSpan={10} style={{ padding: '8px 16px 12px 36px' }}>
                          <table style={{ width: '100%', fontSize: 12 }}>
                            <tbody>
                              {t.items.map((it, i) => (
                                <tr key={i}>
                                  <td style={{ padding: '2px 8px', color: 'var(--text-secondary)' }}>{it.description}</td>
                                  <td style={{ padding: '2px 8px', color: 'var(--text-muted)', fontSize: 11 }}>{it.taxType}</td>
                                  <td style={{ padding: '2px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>฿{fmtBaht(it.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {t.notes && (
                            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>📝 {t.notes}</div>
                          )}
                          {t.badDebtNote && (
                            <div style={{ marginTop: 4, fontSize: 12, color: '#991b1b' }}>⚠️ {t.badDebtNote}</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {data.transactions.length === 0 && (
                <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>ไม่มีรายการในช่วงนี้</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ─── Tab 5 — VAT (ภ.พ.30) ─────────────────────────────────────────────────

function VatTab() {
  const today = toDateStr(new Date());
  const firstOfMonth = today.slice(0, 8) + '01';
  const [from, setFrom] = useState(firstOfMonth);
  const [to,   setTo]   = useState(today);
  const [items,  setItems]  = useState<VatItem[]>([]);
  const [totals, setTotals] = useState<VatTotals | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/reports/vat-sales?from=${from}&to=${to}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setItems(j.items); setTotals(j.totals);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
    } finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const downloadCsv = () => window.open(`/api/reports/vat-sales?from=${from}&to=${to}&format=csv`, '_blank');

  return (
    <>
      <FilterBar>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>ตั้งแต่</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inputSx} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>ถึง</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inputSx} />
        </label>
        <button onClick={load} disabled={loading} style={{ ...inputSx, cursor: 'pointer', background: '#2563eb', color: 'white', borderColor: '#1d4ed8' }}>
          {loading ? 'กำลังโหลด…' : 'ค้นหา'}
        </button>
        <button onClick={downloadCsv} disabled={loading || items.length === 0} style={{ ...inputSx, cursor: 'pointer', background: 'var(--surface-muted)' }}>
          📥 ส่งออก CSV
        </button>
      </FilterBar>

      {err && (
        <div className="pms-card" style={{ padding: 12, marginBottom: 12, background: '#fee2e2', color: '#991b1b' }}>{err}</div>
      )}

      {totals && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
          <Kpi label="ฐานภาษี (Taxable)" value={`฿${fmtBaht(totals.taxableBase)}`} />
          <Kpi label="VAT รวม"          value={`฿${fmtBaht(totals.vatAmount)}`}    accent="#2563eb" />
          <Kpi label="ค่าบริการ"        value={`฿${fmtBaht(totals.serviceCharge)}`} />
          <Kpi label="รวมทั้งสิ้น"      value={`฿${fmtBaht(totals.grandTotal)}`} />
          <Kpi label="จำนวนใบ"          value={String(items.length)} />
        </div>
      )}

      <div className="pms-card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface-subtle)', textAlign: 'left' }}>
              <th style={thSx}>วันที่</th>
              <th style={thSx}>เลขใบกำกับ</th>
              <th style={thSx}>ลูกค้า</th>
              <th style={thSx}>เลขผู้เสียภาษี</th>
              <th style={{ ...thSx, textAlign: 'right' }}>มูลค่าสินค้า</th>
              <th style={{ ...thSx, textAlign: 'right' }}>ค่าบริการ</th>
              <th style={{ ...thSx, textAlign: 'right' }}>ฐานภาษี</th>
              <th style={{ ...thSx, textAlign: 'right' }}>VAT</th>
              <th style={{ ...thSx, textAlign: 'right' }}>รวม</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, idx) => (
              <tr key={i.invoiceId} style={{ background: idx % 2 ? 'var(--surface-subtle)' : 'var(--surface-card)' }}>
                <td style={tdSx}>{i.issueDate}</td>
                <td style={{ ...tdSx, fontFamily: 'monospace' }}>{i.invoiceNumber}</td>
                <td style={tdSx}>{i.customerName}</td>
                <td style={tdSx}>{i.customerTaxId}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(i.subtotal)}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(i.serviceCharge)}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(i.taxableBase)}</td>
                <td style={{ ...tdSx, textAlign: 'right', color: '#2563eb', fontWeight: 600 }}>{fmtBaht(i.vatAmount)}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(i.grandTotal)}</td>
              </tr>
            ))}
            {items.length === 0 && !loading && (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>ไม่มีข้อมูลในช่วงนี้</td></tr>
            )}
          </tbody>
          {totals && items.length > 0 && (
            <tfoot>
              <tr style={{ background: 'var(--surface-muted)', fontWeight: 600 }}>
                <td style={tdSx} colSpan={4}>รวม {items.length} รายการ</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(totals.subtotal)}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(totals.serviceCharge)}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(totals.taxableBase)}</td>
                <td style={{ ...tdSx, textAlign: 'right', color: '#2563eb' }}>{fmtBaht(totals.vatAmount)}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(totals.grandTotal)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

// ─── Shared subcomponents ─────────────────────────────────────────────────

function Section({
  title, rows, total, color, bg, extraFooter, customBody,
}: {
  title: string; rows?: AccountRow[]; total?: number;
  color: string; bg: string;
  extraFooter?: React.ReactNode;
  customBody?: React.ReactNode;
}) {
  return (
    <section className="pms-card pms-transition" style={{ padding: 16, marginBottom: 12 }}>
      <h2 style={{
        padding: '6px 10px', marginBottom: 10, borderRadius: 4,
        background: bg, color, fontSize: 14, fontWeight: 600,
      }}>{title}</h2>
      {customBody ? (
        customBody
      ) : (rows && rows.length === 0) ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 10px' }}>ไม่มีรายการ</div>
      ) : rows ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} style={{ background: i % 2 ? 'var(--surface-subtle)' : 'var(--surface-card)' }}>
                <td style={{ ...tdSx, width: 110, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{r.code}</td>
                <td style={tdSx}>{r.name}</td>
                <td style={{ ...tdSx, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtBaht(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {extraFooter}
      {total !== undefined && (
        <div style={{ ...footRowSx, fontWeight: 600, borderTop: '1px solid var(--border-default)', marginTop: 8, paddingTop: 8 }}>
          <span>รวม</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>฿{fmtBaht(total)}</span>
        </div>
      )}
    </section>
  );
}

function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="pms-card pms-transition" style={{
      padding: 12, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
    }}>{children}</div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="pms-card" style={{ padding: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent ?? 'var(--text-primary)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Loading() {
  return <div style={{ color: 'var(--text-secondary)', padding: 12 }}>กำลังคำนวณ…</div>;
}

const tdSx: React.CSSProperties = {
  padding: '6px 10px', borderBottom: '1px solid var(--border-light)',
};
const thSx: React.CSSProperties = {
  padding: '8px 10px', fontSize: 12, borderBottom: '1px solid var(--border-default)',
};
const inputSx: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 13, background: 'var(--surface-card)', color: 'var(--text-primary)',
};
const footRowSx: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', padding: '4px 10px', fontSize: 13,
};
