'use client';

import { useState, useMemo } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, AreaChart, Area, Line,
} from 'recharts';
import {
  Search, X, TrendingUp, TrendingDown,
  DollarSign, ShoppingCart, Users, Target,
  BarChart3, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import GoogleSheetTable, { type ColumnDef } from './components/GoogleSheetTable';

// ─────────────────────────────────────────────────────────────────────────────
//  Types & Sample Data
// ─────────────────────────────────────────────────────────────────────────────

interface SalesRow {
  id: number;
  salesperson: string;
  region: string;
  product: string;
  amount: number;
  target: number;
  deals: number;
  status: string;
  month: string;
  date: string;
  satisfaction: number;
}

const SALES_DATA: SalesRow[] = [
  { id: 1, salesperson: 'สมชาย กล้าหาญ', region: 'กรุงเทพฯ', product: 'Enterprise Plan', amount: 485000, target: 500000, deals: 12, status: 'On Track', month: 'มี.ค.', date: '2026-03-15', satisfaction: 92 },
  { id: 2, salesperson: 'ณัฐยา ประดิษฐ์', region: 'เชียงใหม่', product: 'Pro Plan', amount: 320000, target: 300000, deals: 18, status: 'Exceeded', month: 'มี.ค.', date: '2026-03-12', satisfaction: 88 },
  { id: 3, salesperson: 'วิชัย สุขสมบูรณ์', region: 'กรุงเทพฯ', product: 'Enterprise Plan', amount: 670000, target: 600000, deals: 8, status: 'Exceeded', month: 'มี.ค.', date: '2026-03-10', satisfaction: 95 },
  { id: 4, salesperson: 'พลอย รุ่งเรือง', region: 'ภูเก็ต', product: 'Starter Plan', amount: 125000, target: 200000, deals: 25, status: 'Behind', month: 'มี.ค.', date: '2026-03-08', satisfaction: 78 },
  { id: 5, salesperson: 'อาทิตย์ มั่นคง', region: 'พัทยา', product: 'Pro Plan', amount: 410000, target: 400000, deals: 15, status: 'On Track', month: 'มี.ค.', date: '2026-03-20', satisfaction: 85 },
  { id: 6, salesperson: 'กรรณิการ์ ทวีสุข', region: 'กรุงเทพฯ', product: 'Enterprise Plan', amount: 550000, target: 500000, deals: 10, status: 'Exceeded', month: 'ก.พ.', date: '2026-02-28', satisfaction: 91 },
  { id: 7, salesperson: 'เปรม วงศ์สกุล', region: 'เชียงใหม่', product: 'Starter Plan', amount: 95000, target: 150000, deals: 30, status: 'Behind', month: 'ก.พ.', date: '2026-02-25', satisfaction: 72 },
  { id: 8, salesperson: 'ศิริพร ลิขิต', region: 'ขอนแก่น', product: 'Pro Plan', amount: 280000, target: 250000, deals: 14, status: 'Exceeded', month: 'ก.พ.', date: '2026-02-20', satisfaction: 89 },
  { id: 9, salesperson: 'ธนวัฒน์ ดวงดี', region: 'กรุงเทพฯ', product: 'Enterprise Plan', amount: 390000, target: 450000, deals: 7, status: 'Behind', month: 'ก.พ.', date: '2026-02-18', satisfaction: 82 },
  { id: 10, salesperson: 'ณัชชา บุญเรือง', region: 'ภูเก็ต', product: 'Pro Plan', amount: 345000, target: 300000, deals: 20, status: 'Exceeded', month: 'ม.ค.', date: '2026-01-30', satisfaction: 94 },
  { id: 11, salesperson: 'กฤษณ์ อารีย์', region: 'พัทยา', product: 'Enterprise Plan', amount: 520000, target: 500000, deals: 9, status: 'On Track', month: 'ม.ค.', date: '2026-01-28', satisfaction: 87 },
  { id: 12, salesperson: 'อรณี ชัยวงศ์', region: 'ขอนแก่น', product: 'Starter Plan', amount: 110000, target: 120000, deals: 22, status: 'On Track', month: 'ม.ค.', date: '2026-01-22', satisfaction: 80 },
  { id: 13, salesperson: 'บุญมี จรัส', region: 'กรุงเทพฯ', product: 'Pro Plan', amount: 460000, target: 400000, deals: 16, status: 'Exceeded', month: 'ม.ค.', date: '2026-01-15', satisfaction: 93 },
  { id: 14, salesperson: 'ลลิตา นิมิต', region: 'เชียงใหม่', product: 'Enterprise Plan', amount: 380000, target: 400000, deals: 6, status: 'On Track', month: 'ม.ค.', date: '2026-01-10', satisfaction: 86 },
  { id: 15, salesperson: 'สุเมธ หิรัญ', region: 'ภูเก็ต', product: 'Starter Plan', amount: 140000, target: 180000, deals: 28, status: 'Behind', month: 'ม.ค.', date: '2026-01-05', satisfaction: 75 },
];

const MONTHLY_TREND = [
  { month: 'ต.ค.', revenue: 2800000, target: 3000000 },
  { month: 'พ.ย.', revenue: 3200000, target: 3000000 },
  { month: 'ธ.ค.', revenue: 3600000, target: 3200000 },
  { month: 'ม.ค.', revenue: 3450000, target: 3400000 },
  { month: 'ก.พ.', revenue: 3100000, target: 3400000 },
  { month: 'มี.ค.', revenue: 3800000, target: 3500000 },
];

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];

const fmt = (n: number) => new Intl.NumberFormat('th-TH').format(n);

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, title, value, subtitle, trend, trendValue, iconColor, iconBg }: {
  icon: typeof DollarSign;
  title: string;
  value: string | number;
  subtitle: string;
  trend: 'up' | 'down';
  trendValue: string;
  iconColor: string;
  iconBg: string;
}) {
  return (
    <div
      className="pms-card pms-transition"
      style={{
        borderRadius: 12, padding: '20px 18px',
        border: '1px solid var(--border-default)',
        flex: '1 1 220px', minWidth: 200,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, fontWeight: 500 }}>{title}</p>
          <p style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', margin: '6px 0 0' }}>{value}</p>
        </div>
        <div style={{ background: iconBg, borderRadius: 10, padding: 10 }}>
          <Icon size={20} color={iconColor} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
        {trend === 'up'
          ? <TrendingUp size={14} color="var(--success)" />
          : <TrendingDown size={14} color="var(--danger)" />}
        <span style={{ fontSize: 12, fontWeight: 600, color: trend === 'up' ? 'var(--success)' : 'var(--danger)' }}>
          {trendValue}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{subtitle}</span>
      </div>
    </div>
  );
}

/** Mini progress bar rendered inside a table cell */
function MiniProgress({ value, max }: { value: number; max: number }) {
  const pct = Math.min((value / max) * 100, 120);
  const barColor = pct >= 100 ? 'var(--success)' : pct >= 75 ? 'var(--primary-light)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--surface-muted)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width 0.5s ease' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: barColor, minWidth: 36, textAlign: 'right' }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

/** Satisfaction meter — segmented gauge */
function SatisfactionMeter({ value }: { value: number }) {
  const color = value >= 90 ? 'var(--success)' : value >= 80 ? 'var(--primary-light)' : value >= 70 ? 'var(--warning)' : 'var(--danger)';
  const segments = 5;
  const filled = Math.round((value / 100) * segments);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ display: 'flex', gap: 2 }}>
        {Array.from({ length: segments }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 8, height: 16, borderRadius: 2,
              background: i < filled ? color : 'var(--surface-muted)',
              transition: 'background 0.3s ease',
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color, marginLeft: 4 }}>{value}%</span>
    </div>
  );
}

/** Status indicator badge */
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { color: string; bg: string; icon: typeof CheckCircle2; label: string }> = {
    Exceeded:   { color: 'var(--success)', bg: '#f0fdf4', icon: CheckCircle2, label: 'เกินเป้า' },
    'On Track': { color: 'var(--primary-light)', bg: '#eff6ff', icon: Target, label: 'ตามเป้า' },
    Behind:     { color: 'var(--danger)', bg: '#fef2f2', icon: AlertTriangle, label: 'ต่ำกว่าเป้า' },
  };
  const c = cfg[status] || cfg['On Track'];
  const Icon = c.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.color,
    }}>
      <Icon size={12} /> {c.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Page Component
// ─────────────────────────────────────────────────────────────────────────────

export default function SalesPage() {
  // ── Aggregates ────────────────────────────────────────────────────────────
  const totalRevenue = SALES_DATA.reduce((s, r) => s + r.amount, 0);
  const totalTarget = SALES_DATA.reduce((s, r) => s + r.target, 0);
  const totalDeals = SALES_DATA.reduce((s, r) => s + r.deals, 0);
  const avgSatisfaction = (SALES_DATA.reduce((s, r) => s + r.satisfaction, 0) / SALES_DATA.length).toFixed(1);

  // ── Chart data ────────────────────────────────────────────────────────────
  const regionData = useMemo(() => {
    const map: Record<string, number> = {};
    SALES_DATA.forEach((r) => { map[r.region] = (map[r.region] || 0) + r.amount; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, []);

  const productData = useMemo(() => {
    const map: Record<string, number> = {};
    SALES_DATA.forEach((r) => { map[r.product] = (map[r.product] || 0) + r.amount; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, []);

  // ── Column definitions ────────────────────────────────────────────────────
  const columns: ColumnDef<SalesRow>[] = [
    {
      key: 'salesperson', label: 'พนักงานขาย', minWidth: 140,
      render: (_, v) => <span style={{ fontWeight: 600 }}>{String(v)}</span>,
    },
    { key: 'region', label: 'ภูมิภาค' },
    {
      key: 'product', label: 'แผน', minWidth: 130,
      render: (_, v) => {
        const plan = String(v);
        const colorMap: Record<string, { bg: string; color: string }> = {
          'Enterprise Plan': { bg: '#eff6ff', color: '#1e40af' },
          'Pro Plan':        { bg: '#ecfeff', color: '#0891b2' },
          'Starter Plan':    { bg: '#f0fdf4', color: '#16a34a' },
        };
        const c = colorMap[plan] || { bg: 'var(--surface-muted)', color: 'var(--text-secondary)' };
        return (
          <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: c.bg, color: c.color }}>
            {plan}
          </span>
        );
      },
    },
    {
      key: 'amount', label: 'ยอดขาย (฿)', align: 'right', minWidth: 120,
      render: (_, v) => <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>฿{fmt(v as number)}</span>,
    },
    {
      key: 'target', label: 'เป้าหมาย (฿)', align: 'right', minWidth: 120,
      render: (_, v) => <span style={{ color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>฿{fmt(v as number)}</span>,
    },
    {
      key: 'deals', label: 'ดีล', align: 'center',
      render: (_, v) => {
        const n = v as number;
        const bg = n >= 20 ? '#f0fdf4' : n >= 10 ? '#eff6ff' : '#fffbeb';
        const color = n >= 20 ? 'var(--success)' : n >= 10 ? 'var(--primary-light)' : 'var(--warning)';
        return (
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: '50%', background: bg, color, fontSize: 12, fontWeight: 700,
          }}>
            {n}
          </span>
        );
      },
    },
    {
      key: 'status', label: 'สถานะ',
      render: (_, v) => <StatusBadge status={String(v)} />,
    },
    { key: 'month', label: 'เดือน' },
    {
      key: 'satisfaction', label: 'ความพึงพอใจ', minWidth: 130,
      render: (_, v) => <SatisfactionMeter value={v as number} />,
    },
  ];

  return (
    <div style={{ padding: '0 0 40px' }}>
      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <BarChart3 size={24} color="var(--primary-light)" />
            Sales Dashboard
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: '4px 0 0' }}>
            ภาพรวมยอดขาย — ตารางพร้อมระบบ filter/sort/search แบบ Google Sheet
          </p>
        </div>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <KpiCard icon={DollarSign} title="ยอดขายรวม" value={`฿${fmt(totalRevenue)}`} subtitle="เทียบช่วงก่อน" trend="up" trendValue="+12.5%" iconColor="var(--primary-light)" iconBg="var(--accent-blue-bg)" />
        <KpiCard icon={Target} title="ถึงเป้าหมาย" value={`${((totalRevenue / totalTarget) * 100).toFixed(1)}%`} subtitle="เป้ารวม" trend={totalRevenue >= totalTarget ? 'up' : 'down'} trendValue={totalRevenue >= totalTarget ? 'ตามเป้า' : 'ต่ำกว่าเป้า'} iconColor="var(--success)" iconBg="#f0fdf4" />
        <KpiCard icon={ShoppingCart} title="ดีลทั้งหมด" value={totalDeals} subtitle="ปิดดีลแล้ว" trend="up" trendValue="+8.3%" iconColor="var(--warning)" iconBg="#fffbeb" />
        <KpiCard icon={Users} title="ความพึงพอใจเฉลี่ย" value={`${avgSatisfaction}%`} subtitle="คะแนนลูกค้า" trend={Number(avgSatisfaction) >= 85 ? 'up' : 'down'} trendValue={Number(avgSatisfaction) >= 85 ? 'ดีเยี่ยม' : 'ต้องปรับปรุง'} iconColor="#06b6d4" iconBg="#ecfeff" />
      </div>

      {/* ── Charts Row ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 24 }}>
        {/* Revenue Trend */}
        <div className="pms-card pms-transition" style={{ borderRadius: 12, padding: 20, border: '1px solid var(--border-default)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 16px' }}>
            แนวโน้มยอดขาย vs เป้าหมาย
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={MONTHLY_TREND}>
              <defs>
                <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-faint)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-faint)' }} tickFormatter={(v: number) => `${(v / 1e6).toFixed(1)}M`} />
              <Tooltip formatter={(v) => `฿${fmt(Number(v))}`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="revenue" name="ยอดขาย" stroke="#3b82f6" strokeWidth={2.5} fill="url(#gRev)" />
              <Line type="monotone" dataKey="target" name="เป้าหมาย" stroke="#ef4444" strokeWidth={2} strokeDasharray="6 3" dot={false} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Product Revenue Bar */}
        <div className="pms-card pms-transition" style={{ borderRadius: 12, padding: 20, border: '1px solid var(--border-default)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 16px' }}>
            ยอดขายตามแผน
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={productData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
              <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-faint)' }} tickFormatter={(v: number) => `${(v / 1e6).toFixed(1)}M`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={100} />
              <Tooltip formatter={(v) => `฿${fmt(Number(v))}`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="value" name="ยอดขาย" radius={[0, 6, 6, 0]}>
                {productData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Region Pie */}
        <div className="pms-card pms-transition" style={{ borderRadius: 12, padding: 20, border: '1px solid var(--border-default)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 16px' }}>
            ยอดขายตามภูมิภาค
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={regionData} cx="50%" cy="50%" innerRadius={50} outerRadius={78} dataKey="value" paddingAngle={3} stroke="none">
                {regionData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => `฿${fmt(Number(v))}`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Individual Target Progress ─────────────────────────────────────── */}
      <div className="pms-card pms-transition" style={{ borderRadius: 12, padding: 20, border: '1px solid var(--border-default)', marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 14px' }}>
          ความคืบหน้ารายบุคคล
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {SALES_DATA.slice(0, 8).map((r) => {
            const pct = (r.amount / r.target) * 100;
            const avatarBg = r.status === 'Exceeded' ? '#f0fdf4' : r.status === 'On Track' ? '#eff6ff' : '#fef2f2';
            const avatarColor = r.status === 'Exceeded' ? 'var(--success)' : r.status === 'On Track' ? 'var(--primary-light)' : 'var(--danger)';
            return (
              <div
                key={r.id}
                className="pms-transition"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', background: 'var(--surface-subtle)',
                  borderRadius: 8, border: '1px solid var(--border-light)',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%', background: avatarBg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700, color: avatarColor, flexShrink: 0,
                }}>
                  {r.salesperson.charAt(0)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.salesperson}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>
                      ฿{fmt(r.amount)} / ฿{fmt(r.target)}
                    </span>
                  </div>
                  <MiniProgress value={r.amount} max={r.target} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Data Table with Google Sheet-style Filters ─────────────────────── */}
      <GoogleSheetTable<SalesRow>
        data={SALES_DATA}
        columns={columns}
        rowKey="id"
        title="ข้อมูลยอดขาย"
        extraColumns={[
          {
            label: 'ถึงเป้า %',
            minWidth: 140,
            render: (row) => <MiniProgress value={row.amount} max={row.target} />,
          },
        ]}
      />
    </div>
  );
}
