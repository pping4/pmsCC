'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, Cell, PieChart, Pie, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import {
  Package2, Wrench, ShoppingBag, EyeOff, DollarSign,
  TrendingUp, TrendingDown,
} from 'lucide-react';
import { DataTable, type ColDef } from '@/components/data-table';
import { calcTax } from '@/lib/tax';
import { fmtBaht } from '@/lib/date-format';
import { useToast } from '@/components/ui';

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  code: string;
  name: string;
  description: string | null;
  unit: string | null;
  price: number;
  taxType: 'included' | 'excluded' | 'no_tax';
  category: 'service' | 'product';
  active: boolean;
  sortOrder: number;
}

/** Flat row passed to GoogleSheetTable — string display fields for filter checkboxes */
interface ProductRow {
  id: string;
  code: string;
  name: string;
  description: string;
  unit: string;
  categoryLabel: string;   // 'บริการ' | 'สินค้า'
  price: number;
  taxTypeLabel: string;    // Thai label
  totalPrice: number;
  activeLabel: string;     // 'ใช้งาน' | 'ปิดใช้งาน'
  // raw values needed for render/action
  category: 'service' | 'product';
  taxType: 'included' | 'excluded' | 'no_tax';
  active: boolean;
  sortOrder: number;
}

type FilterTab = 'all' | 'service' | 'product' | 'inactive';

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

const TAX_LABELS: Record<string, string> = {
  included: 'รวม VAT 7%',
  excluded: 'แยก VAT 7%',
  no_tax:   'ไม่มีภาษี',
};

const TAX_COLORS: Record<string, string> = {
  included: '#22c55e',
  excluded: '#f59e0b',
  no_tax:   '#6b7280',
};

const PIE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

const UNIT_SUGGESTIONS = ['ครั้ง', 'ชิ้น', 'ชั่วโมง', 'คืน', 'กล่อง'];

const INITIAL_FORM = {
  name:        '',
  description: '',
  unit:        'ครั้ง',
  price:       0,
  taxType:     'included' as Product['taxType'],
  category:    'service' as Product['category'],
  sortOrder:   0,
};

// ─────────────────────────────────────────────────────────────────────────────
//  Mini components
// ─────────────────────────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: 'service' | 'product' }) {
  return (
    <span style={{
      display: 'inline-flex', padding: '3px 10px', borderRadius: 12,
      fontSize: 11, fontWeight: 600,
      background: category === 'service' ? '#eff6ff' : '#f0fdf4',
      color:      category === 'service' ? '#3b82f6' : '#22c55e',
    }}>
      {category === 'service' ? '⚙️ บริการ' : '📦 สินค้า'}
    </span>
  );
}

function TaxBadge({ taxType }: { taxType: string }) {
  const color = TAX_COLORS[taxType] ?? '#6b7280';
  return (
    <span style={{
      display: 'inline-flex', padding: '3px 10px', borderRadius: 12,
      fontSize: 11, fontWeight: 600,
      color, background: color + '18',
    }}>
      {TAX_LABELS[taxType] ?? taxType}
    </span>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', padding: '3px 10px', borderRadius: 12,
      fontSize: 11, fontWeight: 600,
      background: active ? '#dcfce7' : '#f3f4f6',
      color:      active ? '#16a34a' : '#9ca3af',
    }}>
      {active ? '✓ ใช้งาน' : '✕ ปิดใช้'}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  KPI Card
// ─────────────────────────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode;
  title: string;
  value: string | number;
  subtitle?: string;
  iconBg: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
}

function KpiCard({ icon, title, value, subtitle, iconBg, trend, trendValue }: KpiCardProps) {
  return (
    <div className="pms-card pms-transition" style={{
      borderRadius: 12, padding: '18px 20px',
      border: '1px solid var(--border-default)',
      flex: '1 1 180px', minWidth: 160,
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {title}
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
          {value}
        </div>
        {(subtitle || trendValue) && (
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            {trend === 'up'   && <TrendingUp size={12} color="var(--success)" />}
            {trend === 'down' && <TrendingDown size={12} color="var(--danger)" />}
            {trendValue && <span style={{ color: trend === 'up' ? 'var(--success)' : trend === 'down' ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>{trendValue}</span>}
            {subtitle && <span style={{ color: 'var(--text-faint)' }}>{subtitle}</span>}
          </div>
        )}
      </div>
      <div style={{
        width: 44, height: 44, borderRadius: 10,
        background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        {icon}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px',
  border: '1px solid var(--border-default)',
  background: 'var(--surface-card)',
  color: 'var(--text-primary)',
  borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text-secondary)', marginBottom: 5,
};

// ─────────────────────────────────────────────────────────────────────────────
//  Page
// ─────────────────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const toast = useToast();
  const [products, setProducts]         = useState<Product[]>([]);
  const [loading, setLoading]           = useState(true);
  const [activeTab, setActiveTab]       = useState<FilterTab>('all');
  const [showForm, setShowForm]         = useState(false);
  const [editProduct, setEditProduct]   = useState<Product | null>(null);
  const [saving, setSaving]             = useState(false);
  const [form, setForm]                 = useState(INITIAL_FORM);
  const [showCharts, setShowCharts]     = useState(true);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchProducts = () => {
    setLoading(true);
    fetch('/api/products?includeInactive=true')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: Product[]) => { setProducts(Array.isArray(data) ? data : []); })
      .catch(err => { toast.error('โหลดสินค้าไม่สำเร็จ', err instanceof Error ? err.message : undefined); setProducts([]); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchProducts(); }, []);

  // ── Tab counts ─────────────────────────────────────────────────────────────
  const counts = useMemo(() => ({
    all:      products.length,
    service:  products.filter(p => p.category === 'service' && p.active).length,
    product:  products.filter(p => p.category === 'product' && p.active).length,
    inactive: products.filter(p => !p.active).length,
  }), [products]);

  // ── KPI stats ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const active = products.filter(p => p.active);
    const avgPrice = active.length
      ? active.reduce((s, p) => s + Number(p.price), 0) / active.length
      : 0;
    const maxPrice = active.length
      ? Math.max(...active.map(p => Number(p.price)))
      : 0;
    return { totalActive: active.length, avgPrice, maxPrice };
  }, [products]);

  // ── Chart data ─────────────────────────────────────────────────────────────
  const pieData = useMemo(() => {
    const active = products.filter(p => p.active);
    const svc = active.filter(p => p.category === 'service').length;
    const prd = active.filter(p => p.category === 'product').length;
    return [
      { name: 'บริการ', value: svc },
      { name: 'สินค้า', value: prd },
    ].filter(d => d.value > 0);
  }, [products]);

  const barData = useMemo(() => {
    return [...products]
      .filter(p => p.active)
      .sort((a, b) => Number(b.price) - Number(a.price))
      .slice(0, 8)
      .map(p => ({
        name:  p.name.length > 14 ? p.name.slice(0, 13) + '…' : p.name,
        price: Number(p.price),
        total: calcTax(Number(p.price), p.taxType).total,
      }));
  }, [products]);

  // ── Flat rows for GoogleSheetTable ─────────────────────────────────────────
  const allRows = useMemo<ProductRow[]>(() =>
    products.map(p => ({
      id:            p.id,
      code:          p.code,
      name:          p.name,
      description:   p.description ?? '',
      unit:          p.unit ?? '-',
      categoryLabel: p.category === 'service' ? 'บริการ' : 'สินค้า',
      price:         Number(p.price),
      taxTypeLabel:  TAX_LABELS[p.taxType] ?? p.taxType,
      totalPrice:    calcTax(Number(p.price), p.taxType).total,
      activeLabel:   p.active ? 'ใช้งาน' : 'ปิดใช้งาน',
      category:      p.category,
      taxType:       p.taxType,
      active:        p.active,
      sortOrder:     p.sortOrder,
    })),
  [products]);

  // ── Filter by tab before handing to GoogleSheetTable ──────────────────────
  const tableRows = useMemo<ProductRow[]>(() => {
    switch (activeTab) {
      case 'service':  return allRows.filter(r => r.category === 'service' && r.active);
      case 'product':  return allRows.filter(r => r.category === 'product' && r.active);
      case 'inactive': return allRows.filter(r => !r.active);
      default:         return allRows;
    }
  }, [allRows, activeTab]);

  // ── Column definitions ─────────────────────────────────────────────────────
  type ColKey =
    | 'code' | 'name' | 'unit' | 'categoryLabel'
    | 'price' | 'taxTypeLabel' | 'totalPrice' | 'activeLabel' | 'actions';

  // `products` is state — capture the latest in a ref for action column.
  // Columns are memoized on [products], so closures always see current list.
  const columns: ColDef<ProductRow, ColKey>[] = useMemo(() => [
    {
      key: 'code', label: 'รหัส', minW: 90,
      getValue: r => r.code,
      render: (row) => (
        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11, color: 'var(--text-secondary)', opacity: row.active ? 1 : 0.5 }}>
          {row.code}
        </span>
      ),
    },
    {
      key: 'name', label: 'ชื่อ / รายละเอียด', minW: 180,
      getValue: r => r.name,
      render: (row) => (
        <div>
          <span style={{ fontWeight: 600, textDecoration: row.active ? 'none' : 'line-through', color: row.active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            {row.name}
          </span>
          {row.description && (
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{row.description}</div>
          )}
        </div>
      ),
    },
    {
      key: 'unit', label: 'หน่วย', minW: 70,
      getValue: r => r.unit,
      render: (row) => (
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.unit}</span>
      ),
    },
    {
      key: 'categoryLabel', label: 'หมวด', minW: 90,
      getValue: r => r.categoryLabel,
      render: (row) => <CategoryBadge category={row.category} />,
    },
    {
      key: 'price', label: 'ราคา', align: 'right', minW: 100, noFilter: true,
      // pad to 12 digits (cents) for correct string-numeric sort
      getValue: r => String(Math.round(r.price * 100)).padStart(12, '0'),
      getLabel: r => `฿${fmtBaht(r.price)}`,
      aggregate: 'sum',
      aggValue:  r => r.price,
      render: (row) => (
        <span style={{ fontFamily: 'monospace', opacity: row.active ? 1 : 0.5 }}>
          ฿{fmtBaht(row.price)}
        </span>
      ),
    },
    {
      key: 'taxTypeLabel', label: 'ภาษี', minW: 110,
      getValue: r => r.taxTypeLabel,
      render: (row) => <TaxBadge taxType={row.taxType} />,
    },
    {
      key: 'totalPrice', label: 'รวม VAT', align: 'right', minW: 110, noFilter: true,
      getValue: r => String(Math.round(r.totalPrice * 100)).padStart(12, '0'),
      getLabel: r => `฿${fmtBaht(r.totalPrice)}`,
      aggregate: 'sum',
      aggValue:  r => r.totalPrice,
      render: (row) => (
        <span style={{ fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
          ฿{fmtBaht(row.totalPrice)}
        </span>
      ),
    },
    {
      key: 'activeLabel', label: 'สถานะ', minW: 90,
      getValue: r => r.activeLabel,
      render: (row) => <ActiveBadge active={row.active} />,
    },
    {
      key: 'actions', label: 'จัดการ', minW: 150, noFilter: true,
      getValue: () => '',
      render: (row) => {
        const p = products.find(x => x.id === row.id);
        if (!p) return null;
        return (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={(e) => { e.stopPropagation(); openEdit(p); }}
              className="pms-transition"
              style={{ padding: '5px 10px', background: 'var(--surface-muted)', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600, color: 'var(--text-secondary)' }}
            >
              แก้ไข
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); toggleActive(p.id); }}
              className="pms-transition"
              title={p.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
              style={{
                padding: '5px 10px',
                background: p.active ? '#fef3c7' : '#dcfce7',
                border: `1px solid ${p.active ? '#fcd34d' : '#86efac'}`,
                borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600,
                color: p.active ? '#92400e' : '#14532d',
              }}
            >
              {p.active ? 'ปิด' : 'เปิด'}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); deleteProduct(p.id, p.name); }}
              title="ลบ"
              style={{ padding: '5px 8px', background: '#fff1f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600, color: '#b91c1c' }}
            >
              ✕
            </button>
          </div>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [products]);

  // ── Action helpers ─────────────────────────────────────────────────────────
  const openAdd = () => { setForm(INITIAL_FORM); setEditProduct(null); setShowForm(true); };

  const openEdit = (p: Product) => {
    setForm({
      name:        p.name,
      description: p.description ?? '',
      unit:        p.unit ?? 'ครั้ง',
      price:       Number(p.price),
      taxType:     p.taxType,
      category:    p.category,
      sortOrder:   p.sortOrder,
    });
    setEditProduct(p);
    setShowForm(true);
  };

  const save = async () => {
    if (saving) return;
    if (!form.name.trim()) { toast.warning('กรุณาระบุชื่อสินค้า/บริการ'); return; }
    setSaving(true);
    try {
      const payload = {
        name:        form.name.trim(),
        description: form.description.trim() || undefined,
        unit:        form.unit.trim() || undefined,
        price:       Number(form.price),
        taxType:     form.taxType,
        category:    form.category,
        sortOrder:   form.sortOrder,
      };
      if (editProduct) {
        const res = await fetch(`/api/products/${editProduct.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || err?.message || `HTTP ${res.status}`);
        }
        const updated: Product = await res.json();
        setProducts(prev => prev.map(x => x.id === editProduct.id ? updated : x));
        toast.success('แก้ไขสินค้าสำเร็จ');
      } else {
        const res = await fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || err?.message || `HTTP ${res.status}`);
        }
        const created: Product = await res.json();
        setProducts(prev => [...prev, created]);
        toast.success('สร้างสินค้าสำเร็จ');
      }
      setShowForm(false);
      setEditProduct(null);
    } catch (e) {
      toast.error('บันทึกสินค้าไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally { setSaving(false); }
  };

  const toggleActive = async (id: string) => {
    try {
      const res = await fetch(`/api/products/${id}`, { method: 'PATCH' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated: Product = await res.json();
      setProducts(prev => prev.map(x => x.id === id ? updated : x));
      toast.success(updated.active ? 'เปิดใช้งานสำเร็จ' : 'ปิดใช้งานสำเร็จ');
    } catch (e) {
      toast.error('เปลี่ยนสถานะไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    }
  };

  const deleteProduct = async (id: string, name: string) => {
    if (!confirm(`ยืนยันการลบ "${name}"?`)) return;
    try {
      const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProducts(prev => prev.filter(x => x.id !== id));
      toast.success('ลบสำเร็จ');
    } catch (e) {
      toast.error('ลบไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    }
  };

  // ── Tax preview (modal) ────────────────────────────────────────────────────
  const taxPreview = form.price > 0 ? calcTax(form.price, form.taxType) : null;

  // ── Tabs ───────────────────────────────────────────────────────────────────
  const tabs: { id: FilterTab; label: string }[] = [
    { id: 'all',      label: 'ทั้งหมด' },
    { id: 'service',  label: '⚙️ บริการ' },
    { id: 'product',  label: '📦 สินค้า' },
    { id: 'inactive', label: '✕ ปิดใช้งาน' },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>สินค้า &amp; บริการ</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            {stats.totalActive} รายการที่ใช้งาน · {counts.inactive > 0 && `${counts.inactive} ปิดใช้งาน`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setShowCharts(v => !v)}
            className="pms-transition"
            style={{ padding: '7px 14px', background: 'var(--surface-muted)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--text-secondary)' }}
          >
            {showCharts ? '📊 ซ่อนกราฟ' : '📊 แสดงกราฟ'}
          </button>
          <button
            onClick={openAdd}
            style={{ padding: '9px 18px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            + เพิ่มสินค้า/บริการ
          </button>
        </div>
      </div>

      {/* ── KPI Cards ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <KpiCard icon={<Package2 size={20} color="#3b82f6" />} iconBg="#eff6ff"
          title="รายการทั้งหมด" value={stats.totalActive} subtitle="รายการที่ใช้งาน" />
        <KpiCard icon={<Wrench size={20} color="#8b5cf6" />} iconBg="#f5f3ff"
          title="บริการ" value={counts.service} subtitle="รายการบริการ" />
        <KpiCard icon={<ShoppingBag size={20} color="#22c55e" />} iconBg="#f0fdf4"
          title="สินค้า" value={counts.product} subtitle="รายการสินค้า" />
        <KpiCard icon={<DollarSign size={20} color="#f59e0b" />} iconBg="#fffbeb"
          title="ราคาเฉลี่ย" value={`฿${fmtBaht(stats.avgPrice)}`} subtitle="(active)" />
        {counts.inactive > 0 && (
          <KpiCard icon={<EyeOff size={20} color="#ef4444" />} iconBg="#fef2f2"
            title="ปิดใช้งาน" value={counts.inactive} subtitle="รายการ" trend="down" />
        )}
      </div>

      {/* ── Charts ───────────────────────────────────────────────────────────── */}
      {showCharts && (pieData.length > 0 || barData.length > 0) && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>

          {/* Pie: category breakdown */}
          {pieData.length > 0 && (
            <div className="pms-card pms-transition" style={{ flex: '0 0 260px', borderRadius: 12, padding: 20, border: '1px solid var(--border-default)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>สัดส่วนหมวดหมู่</div>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={pieData} dataKey="value" nameKey="name"
                    cx="50%" cy="50%" innerRadius={48} outerRadius={72}
                    paddingAngle={4}
                    label={({ name, percent }) => `${name} ${Math.round((percent ?? 0) * 100)}%`}
                    labelLine={false}
                  >
                    {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => [`${v} รายการ`]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Bar: top items by price */}
          {barData.length > 0 && (
            <div className="pms-card pms-transition" style={{ flex: '1 1 360px', minWidth: 300, borderRadius: 12, padding: 20, border: '1px solid var(--border-default)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
                ราคาสูงสุด Top {barData.length}
              </div>
              <ResponsiveContainer width="100%" height={Math.max(180, barData.length * 28)}>
                <BarChart data={barData} layout="vertical" margin={{ left: 8, right: 48, top: 0, bottom: 0 }}>
                  <Bar dataKey="price" name="ราคา (ก่อน VAT)" radius={[0, 6, 6, 0]}>
                    {barData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Bar>
                  <Tooltip formatter={(v) => [`฿${fmtBaht(Number(v))}`]} />
                </BarChart>
              </ResponsiveContainer>
              {/* Manual y-axis labels */}
              <div style={{ marginTop: 8 }}>
                {barData.map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>฿{fmtBaht(d.price)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Filter Tabs ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="pms-transition"
            style={{
              padding: '7px 14px', borderRadius: 20, border: '1.5px solid',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              borderColor: activeTab === tab.id ? '#1e40af' : 'var(--border-default)',
              background:  activeTab === tab.id ? '#1e40af' : 'var(--surface-card)',
              color:       activeTab === tab.id ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {tab.label} ({counts[tab.id]})
          </button>
        ))}
      </div>

      {/* ── Data Table (shared) ───────────────────────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-faint)' }}>กำลังโหลด...</div>
      ) : (() => {
        const title =
          activeTab === 'all'      ? 'สินค้า & บริการทั้งหมด' :
          activeTab === 'service'  ? 'รายการบริการ' :
          activeTab === 'product'  ? 'รายการสินค้า' :
                                     'รายการที่ปิดใช้งาน';
        return (
          <DataTable<ProductRow, ColKey>
            tableKey={`products.${activeTab}`}
            syncUrl
            exportFilename={`pms_products_${activeTab}`}
            exportSheetName={title}
            rows={tableRows}
            columns={columns}
            rowKey={r => r.id}
            defaultSort={{ col: 'code', dir: 'asc' }}
            groupByCols={['categoryLabel', 'taxTypeLabel', 'activeLabel']}
            emptyText="ไม่พบรายการ"
            summaryLabel={(f, t) => (
              <>📦 {title} — {f}{f !== t ? `/${t}` : ''} รายการ</>
            )}
          />
        );
      })()}

      {/* ── Modal Form ───────────────────────────────────────────────────────── */}
      {showForm && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowForm(false)}
        >
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }} />
          <div
            style={{ position: 'relative', background: 'var(--surface-card)', color: 'var(--text-primary)', borderRadius: 16, width: '100%', maxWidth: 460, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{editProduct ? 'แก้ไข' : 'เพิ่ม'} สินค้า/บริการ</h3>
              <button onClick={() => setShowForm(false)} style={{ background: 'var(--surface-muted)', border: '1px solid var(--border-default)', cursor: 'pointer', padding: '6px 10px', borderRadius: 8, color: 'var(--text-primary)' }}>✕</button>
            </div>

            {editProduct && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>รหัสสินค้า</label>
                <input value={editProduct.code} readOnly style={{ ...inputStyle, background: 'var(--surface-muted)', color: 'var(--text-muted)', fontFamily: 'monospace', fontWeight: 700 }} />
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>ชื่อ*</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="ชื่อสินค้า/บริการ" style={inputStyle} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>รายละเอียด (ไม่บังคับ)</label>
              <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="คำอธิบายเพิ่มเติม..." rows={2} maxLength={500} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>หน่วย</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                {UNIT_SUGGESTIONS.map(u => (
                  <button key={u} type="button" onClick={() => setForm(p => ({ ...p, unit: u }))}
                    className="pms-transition"
                    style={{ padding: '4px 10px', borderRadius: 14, border: '1.5px solid', fontSize: 12, fontWeight: 600, cursor: 'pointer', borderColor: form.unit === u ? '#1e40af' : 'var(--border-default)', background: form.unit === u ? '#eff6ff' : 'var(--surface-card)', color: form.unit === u ? '#1e40af' : 'var(--text-secondary)' }}>
                    {u}
                  </button>
                ))}
              </div>
              <input value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))} placeholder="หรือพิมพ์เอง เช่น แพ็ก" maxLength={20} style={inputStyle} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>ราคา (฿)</label>
              <input type="number" min={0} step={0.01} value={form.price} onChange={e => setForm(p => ({ ...p, price: Number(e.target.value) }))} style={inputStyle} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>หมวดหมู่</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value as Product['category'] }))} style={inputStyle}>
                <option value="service">⚙️ บริการ</option>
                <option value="product">📦 สินค้า</option>
              </select>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>การคิดภาษี</label>
              <select value={form.taxType} onChange={e => setForm(p => ({ ...p, taxType: e.target.value as Product['taxType'] }))} style={inputStyle}>
                <option value="included">รวม VAT 7%</option>
                <option value="excluded">แยก VAT 7%</option>
                <option value="no_tax">ไม่มีภาษี</option>
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>ลำดับการแสดง</label>
              <input type="number" min={0} value={form.sortOrder} onChange={e => setForm(p => ({ ...p, sortOrder: Number(e.target.value) }))} style={inputStyle} />
            </div>

            {taxPreview && (
              <div style={{ background: '#f0f9ff', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, lineHeight: 1.7, borderLeft: '3px solid #3b82f6' }}>
                <strong>ตัวอย่างภาษี</strong><br />
                ราคาสุทธิ: <strong>฿{fmtBaht(taxPreview.net)}</strong> &nbsp;|&nbsp;
                VAT: <strong>฿{fmtBaht(taxPreview.tax)}</strong> &nbsp;|&nbsp;
                รวม: <strong style={{ color: '#1e40af' }}>฿{fmtBaht(taxPreview.total)}</strong>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: 11, background: 'var(--surface-muted)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: 'var(--text-primary)' }}>
                ยกเลิก
              </button>
              <button onClick={save} disabled={saving || !form.name.trim()} style={{ flex: 1, padding: 11, background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: (saving || !form.name.trim()) ? 0.7 : 1 }}>
                {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
