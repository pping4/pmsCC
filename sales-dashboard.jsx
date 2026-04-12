import { useState, useMemo, useRef, useEffect } from "react";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area } from "recharts";
import { Search, Filter, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, X, TrendingUp, TrendingDown, DollarSign, ShoppingCart, Users, Target, BarChart3, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

// ============================================================
// SAMPLE DATA
// ============================================================
const SALES_DATA = [
  { id: 1, salesperson: "Somchai K.", region: "Bangkok", product: "Enterprise Plan", amount: 485000, target: 500000, deals: 12, status: "On Track", month: "Mar", date: "2026-03-15", satisfaction: 92 },
  { id: 2, salesperson: "Nattaya P.", region: "Chiang Mai", product: "Pro Plan", amount: 320000, target: 300000, deals: 18, status: "Exceeded", month: "Mar", date: "2026-03-12", satisfaction: 88 },
  { id: 3, salesperson: "Wichai S.", region: "Bangkok", product: "Enterprise Plan", amount: 670000, target: 600000, deals: 8, status: "Exceeded", month: "Mar", date: "2026-03-10", satisfaction: 95 },
  { id: 4, salesperson: "Ploy R.", region: "Phuket", product: "Starter Plan", amount: 125000, target: 200000, deals: 25, status: "Behind", month: "Mar", date: "2026-03-08", satisfaction: 78 },
  { id: 5, salesperson: "Arthit M.", region: "Pattaya", product: "Pro Plan", amount: 410000, target: 400000, deals: 15, status: "On Track", month: "Mar", date: "2026-03-20", satisfaction: 85 },
  { id: 6, salesperson: "Kannika T.", region: "Bangkok", product: "Enterprise Plan", amount: 550000, target: 500000, deals: 10, status: "Exceeded", month: "Feb", date: "2026-02-28", satisfaction: 91 },
  { id: 7, salesperson: "Prem W.", region: "Chiang Mai", product: "Starter Plan", amount: 95000, target: 150000, deals: 30, status: "Behind", month: "Feb", date: "2026-02-25", satisfaction: 72 },
  { id: 8, salesperson: "Siriporn L.", region: "Khon Kaen", product: "Pro Plan", amount: 280000, target: 250000, deals: 14, status: "Exceeded", month: "Feb", date: "2026-02-20", satisfaction: 89 },
  { id: 9, salesperson: "Tanawat D.", region: "Bangkok", product: "Enterprise Plan", amount: 390000, target: 450000, deals: 7, status: "Behind", month: "Feb", date: "2026-02-18", satisfaction: 82 },
  { id: 10, salesperson: "Natcha B.", region: "Phuket", product: "Pro Plan", amount: 345000, target: 300000, deals: 20, status: "Exceeded", month: "Jan", date: "2026-01-30", satisfaction: 94 },
  { id: 11, salesperson: "Krit A.", region: "Pattaya", product: "Enterprise Plan", amount: 520000, target: 500000, deals: 9, status: "On Track", month: "Jan", date: "2026-01-28", satisfaction: 87 },
  { id: 12, salesperson: "Oranee C.", region: "Khon Kaen", product: "Starter Plan", amount: 110000, target: 120000, deals: 22, status: "On Track", month: "Jan", date: "2026-01-22", satisfaction: 80 },
  { id: 13, salesperson: "Boonmee J.", region: "Bangkok", product: "Pro Plan", amount: 460000, target: 400000, deals: 16, status: "Exceeded", month: "Jan", date: "2026-01-15", satisfaction: 93 },
  { id: 14, salesperson: "Lalita N.", region: "Chiang Mai", product: "Enterprise Plan", amount: 380000, target: 400000, deals: 6, status: "On Track", month: "Jan", date: "2026-01-10", satisfaction: 86 },
  { id: 15, salesperson: "Sumet H.", region: "Phuket", product: "Starter Plan", amount: 140000, target: 180000, deals: 28, status: "Behind", month: "Jan", date: "2026-01-05", satisfaction: 75 },
];

const MONTHLY_TREND = [
  { month: "Oct", revenue: 2800000, target: 3000000 },
  { month: "Nov", revenue: 3200000, target: 3000000 },
  { month: "Dec", revenue: 3600000, target: 3200000 },
  { month: "Jan", revenue: 3450000, target: 3400000 },
  { month: "Feb", revenue: 3100000, target: 3400000 },
  { month: "Mar", revenue: 3800000, target: 3500000 },
];

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899"];

// ============================================================
// GOOGLE SHEET-STYLE COLUMN FILTER DROPDOWN
// ============================================================
function ColumnFilter({ column, data, activeFilters, onFilterChange, onSortChange, currentSort }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const uniqueValues = useMemo(() => {
    const vals = [...new Set(data.map((r) => String(r[column.key])))];
    vals.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return vals;
  }, [data, column.key]);

  const filtered = uniqueValues.filter((v) => v.toLowerCase().includes(search.toLowerCase()));
  const selected = activeFilters[column.key] || new Set(uniqueValues);
  const allSelected = selected.size === uniqueValues.length;

  const toggle = (val) => {
    const next = new Set(selected);
    next.has(val) ? next.delete(val) : next.add(val);
    onFilterChange(column.key, next);
  };

  const toggleAll = () => {
    onFilterChange(column.key, allSelected ? new Set() : new Set(uniqueValues));
  };

  const isFiltered = selected.size < uniqueValues.length;
  const isSorted = currentSort?.key === column.key;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 2 }}>
      <span style={{ fontWeight: 600, fontSize: 12, color: "#374151", userSelect: "none" }}>{column.label}</span>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: isFiltered ? "#eef2ff" : "transparent",
          border: isFiltered ? "1px solid #818cf8" : "1px solid transparent",
          borderRadius: 4, cursor: "pointer", padding: "2px 4px", display: "flex", alignItems: "center", gap: 2,
          color: isFiltered ? "#4f46e5" : "#9ca3af"
        }}
      >
        {isSorted ? (currentSort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} />}
        <ChevronDown size={10} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, zIndex: 1000,
          background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8,
          boxShadow: "0 10px 40px rgba(0,0,0,0.15)", width: 240, marginTop: 4,
          animation: "fadeIn 0.15s ease"
        }}>
          {/* Sort buttons */}
          <div style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", display: "flex", gap: 4 }}>
            <button onClick={() => { onSortChange(column.key, "asc"); setOpen(false); }}
              style={{
                flex: 1, padding: "6px 8px", fontSize: 11, borderRadius: 5, cursor: "pointer",
                border: isSorted && currentSort.dir === "asc" ? "1px solid #818cf8" : "1px solid #e5e7eb",
                background: isSorted && currentSort.dir === "asc" ? "#eef2ff" : "#fff",
                color: isSorted && currentSort.dir === "asc" ? "#4f46e5" : "#6b7280",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4
              }}>
              <ArrowUp size={11} /> A→Z
            </button>
            <button onClick={() => { onSortChange(column.key, "desc"); setOpen(false); }}
              style={{
                flex: 1, padding: "6px 8px", fontSize: 11, borderRadius: 5, cursor: "pointer",
                border: isSorted && currentSort.dir === "desc" ? "1px solid #818cf8" : "1px solid #e5e7eb",
                background: isSorted && currentSort.dir === "desc" ? "#eef2ff" : "#fff",
                color: isSorted && currentSort.dir === "desc" ? "#4f46e5" : "#6b7280",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4
              }}>
              <ArrowDown size={11} /> Z→A
            </button>
          </div>

          {/* Search */}
          <div style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f9fafb", borderRadius: 6, padding: "6px 8px", border: "1px solid #e5e7eb" }}>
              <Search size={13} color="#9ca3af" />
              <input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..." autoFocus
                style={{ border: "none", outline: "none", background: "transparent", fontSize: 12, width: "100%", color: "#374151" }}
              />
              {search && <X size={12} color="#9ca3af" style={{ cursor: "pointer" }} onClick={() => setSearch("")} />}
            </div>
          </div>

          {/* Select All */}
          <div style={{ padding: "6px 10px", borderBottom: "1px solid #f3f4f6" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: "#4f46e5", fontWeight: 600 }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll}
                style={{ accentColor: "#6366f1", width: 14, height: 14 }} />
              Select All ({uniqueValues.length})
            </label>
          </div>

          {/* Checkbox list */}
          <div style={{ maxHeight: 180, overflowY: "auto", padding: "4px 10px" }}>
            {filtered.length === 0 && <div style={{ padding: 12, textAlign: "center", color: "#9ca3af", fontSize: 12 }}>No results</div>}
            {filtered.map((val) => (
              <label key={val} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "5px 4px",
                cursor: "pointer", fontSize: 12, color: "#374151", borderRadius: 4,
              }}>
                <input type="checkbox" checked={selected.has(val)} onChange={() => toggle(val)}
                  style={{ accentColor: "#6366f1", width: 14, height: 14 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{val}</span>
              </label>
            ))}
          </div>

          {/* Clear filter */}
          {isFiltered && (
            <div style={{ padding: "8px 10px", borderTop: "1px solid #f3f4f6" }}>
              <button onClick={() => { onFilterChange(column.key, new Set(uniqueValues)); setOpen(false); }}
                style={{
                  width: "100%", padding: "6px", fontSize: 11, color: "#ef4444", background: "#fef2f2",
                  border: "1px solid #fecaca", borderRadius: 5, cursor: "pointer"
                }}>
                Clear Filter
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// KPI CARD
// ============================================================
function KpiCard({ icon: Icon, title, value, subtitle, trend, trendValue, color, bg }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 12, padding: "20px 18px", border: "1px solid #e5e7eb",
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)", flex: "1 1 0", minWidth: 200
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: 12, color: "#6b7280", margin: 0, fontWeight: 500 }}>{title}</p>
          <p style={{ fontSize: 26, fontWeight: 700, color: "#111827", margin: "6px 0 0" }}>{value}</p>
        </div>
        <div style={{ background: bg, borderRadius: 10, padding: 10 }}>
          <Icon size={20} color={color} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
        {trend === "up"
          ? <TrendingUp size={14} color="#22c55e" />
          : <TrendingDown size={14} color="#ef4444" />}
        <span style={{ fontSize: 12, fontWeight: 600, color: trend === "up" ? "#22c55e" : "#ef4444" }}>{trendValue}</span>
        <span style={{ fontSize: 12, color: "#9ca3af" }}>{subtitle}</span>
      </div>
    </div>
  );
}

// ============================================================
// MINI PROGRESS BAR (in table)
// ============================================================
function MiniProgress({ value, max, color }) {
  const pct = Math.min((value / max) * 100, 100);
  const barColor = pct >= 100 ? "#22c55e" : pct >= 75 ? "#6366f1" : pct >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color || barColor, borderRadius: 3, transition: "width 0.5s ease" }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: color || barColor, minWidth: 36, textAlign: "right" }}>{pct.toFixed(0)}%</span>
    </div>
  );
}

// ============================================================
// SATISFACTION METER (gauge-like)
// ============================================================
function SatisfactionMeter({ value }) {
  const color = value >= 90 ? "#22c55e" : value >= 80 ? "#6366f1" : value >= 70 ? "#f59e0b" : "#ef4444";
  const segments = 5;
  const filled = Math.round((value / 100) * segments);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <div style={{ display: "flex", gap: 2 }}>
        {Array.from({ length: segments }).map((_, i) => (
          <div key={i} style={{
            width: 8, height: 16, borderRadius: 2,
            background: i < filled ? color : "#e5e7eb",
            transition: "background 0.3s ease"
          }} />
        ))}
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color, marginLeft: 4 }}>{value}%</span>
    </div>
  );
}

// ============================================================
// STATUS INDICATOR
// ============================================================
function StatusIndicator({ status }) {
  const cfg = {
    Exceeded: { color: "#22c55e", bg: "#f0fdf4", icon: CheckCircle2, label: "Exceeded" },
    "On Track": { color: "#6366f1", bg: "#eef2ff", icon: Target, label: "On Track" },
    Behind: { color: "#ef4444", bg: "#fef2f2", icon: AlertTriangle, label: "Behind" },
  }[status] || { color: "#6b7280", bg: "#f9fafb", icon: XCircle, label: status };

  const Icon = cfg.icon;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: cfg.bg, color: cfg.color
    }}>
      <Icon size={12} /> {cfg.label}
    </span>
  );
}

// ============================================================
// MAIN DASHBOARD
// ============================================================
export default function SalesDashboard() {
  const [globalSearch, setGlobalSearch] = useState("");
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState(null);
  const [activeTab, setActiveTab] = useState("table");

  const columns = [
    { key: "salesperson", label: "Salesperson" },
    { key: "region", label: "Region" },
    { key: "product", label: "Product" },
    { key: "amount", label: "Revenue (฿)" },
    { key: "target", label: "Target (฿)" },
    { key: "deals", label: "Deals" },
    { key: "status", label: "Status" },
    { key: "month", label: "Month" },
    { key: "satisfaction", label: "Satisfaction" },
  ];

  // Filter + Sort + Search logic
  const processedData = useMemo(() => {
    let result = [...SALES_DATA];

    // Global search
    if (globalSearch) {
      const q = globalSearch.toLowerCase();
      result = result.filter((r) =>
        Object.values(r).some((v) => String(v).toLowerCase().includes(q))
      );
    }

    // Column filters
    Object.keys(filters).forEach((key) => {
      const selected = filters[key];
      if (selected && selected.size < new Set(SALES_DATA.map((r) => String(r[key]))).size) {
        result = result.filter((r) => selected.has(String(r[key])));
      }
    });

    // Sort
    if (sort) {
      result.sort((a, b) => {
        const av = a[sort.key], bv = b[sort.key];
        const cmp = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [globalSearch, filters, sort]);

  // Aggregates
  const totalRevenue = processedData.reduce((s, r) => s + r.amount, 0);
  const totalTarget = processedData.reduce((s, r) => s + r.target, 0);
  const totalDeals = processedData.reduce((s, r) => s + r.deals, 0);
  const avgSatisfaction = processedData.length ? (processedData.reduce((s, r) => s + r.satisfaction, 0) / processedData.length).toFixed(1) : 0;

  // Region pie
  const regionData = useMemo(() => {
    const map = {};
    processedData.forEach((r) => { map[r.region] = (map[r.region] || 0) + r.amount; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [processedData]);

  // Product bar
  const productData = useMemo(() => {
    const map = {};
    processedData.forEach((r) => { map[r.product] = (map[r.product] || 0) + r.amount; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [processedData]);

  const handleFilterChange = (key, selected) => setFilters((prev) => ({ ...prev, [key]: selected }));
  const handleSortChange = (key, dir) => setSort({ key, dir });
  const activeFilterCount = Object.values(filters).filter((s) => s && s.size < new Set(SALES_DATA.map((r) => String(r[Object.keys(filters).find((k) => filters[k] === s)]))).size).length;

  const clearAllFilters = () => { setFilters({}); setSort(null); setGlobalSearch(""); };

  const fmt = (n) => new Intl.NumberFormat("th-TH").format(n);

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: "#f8fafc", minHeight: "100vh", padding: 24 }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }
        table { border-collapse: collapse; }
      `}</style>

      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#111827", margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <BarChart3 size={26} color="#6366f1" /> Sales Dashboard
          </h1>
          <p style={{ fontSize: 13, color: "#9ca3af", margin: "4px 0 0" }}>Real-time sales performance with Google Sheet-style filtering</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {(activeFilterCount > 0 || sort || globalSearch) && (
            <button onClick={clearAllFilters} style={{
              padding: "8px 14px", fontSize: 12, borderRadius: 8, cursor: "pointer",
              background: "#fef2f2", border: "1px solid #fecaca", color: "#ef4444", fontWeight: 600,
              display: "flex", alignItems: "center", gap: 5
            }}>
              <X size={13} /> Clear All
            </button>
          )}
          <div style={{
            display: "flex", alignItems: "center", gap: 6, background: "#fff",
            borderRadius: 10, padding: "8px 14px", border: "1px solid #e5e7eb", minWidth: 260,
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)"
          }}>
            <Search size={15} color="#9ca3af" />
            <input
              value={globalSearch} onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Search all columns..."
              style={{ border: "none", outline: "none", background: "transparent", fontSize: 13, width: "100%", color: "#374151" }}
            />
            {globalSearch && <X size={14} color="#9ca3af" style={{ cursor: "pointer" }} onClick={() => setGlobalSearch("")} />}
          </div>
        </div>
      </div>

      {/* KPI CARDS */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <KpiCard icon={DollarSign} title="Total Revenue" value={`฿${fmt(totalRevenue)}`} subtitle="vs last period" trend="up" trendValue="+12.5%" color="#6366f1" bg="#eef2ff" />
        <KpiCard icon={Target} title="Target Achievement" value={`${((totalRevenue / totalTarget) * 100).toFixed(1)}%`} subtitle="overall target" trend={totalRevenue >= totalTarget ? "up" : "down"} trendValue={totalRevenue >= totalTarget ? "On Track" : "Behind"} color="#22c55e" bg="#f0fdf4" />
        <KpiCard icon={ShoppingCart} title="Total Deals" value={totalDeals} subtitle="closed deals" trend="up" trendValue="+8.3%" color="#f59e0b" bg="#fffbeb" />
        <KpiCard icon={Users} title="Avg. Satisfaction" value={`${avgSatisfaction}%`} subtitle="customer score" trend={avgSatisfaction >= 85 ? "up" : "down"} trendValue={avgSatisfaction >= 85 ? "Great" : "Needs Work"} color="#06b6d4" bg="#ecfeff" />
      </div>

      {/* CHART SECTION */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Revenue Trend */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#374151", margin: "0 0 16px" }}>Revenue Trend vs Target</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={MONTHLY_TREND}>
              <defs>
                <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9ca3af" }} />
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <Tooltip formatter={(v) => `฿${fmt(v)}`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2.5} fill="url(#gRev)" />
              <Line type="monotone" dataKey="target" stroke="#ef4444" strokeWidth={2} strokeDasharray="6 3" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Product Revenue Bar */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#374151", margin: "0 0 16px" }}>By Product</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={productData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis type="number" tick={{ fontSize: 10, fill: "#9ca3af" }} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#6b7280" }} width={80} />
              <Tooltip formatter={(v) => `฿${fmt(v)}`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                {productData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Region Pie */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, border: "1px solid #e5e7eb", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#374151", margin: "0 0 16px" }}>By Region</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={regionData} cx="50%" cy="50%" innerRadius={45} outerRadius={72} dataKey="value" paddingAngle={3} stroke="none">
                {regionData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => `฿${fmt(v)}`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* TARGET PROGRESS OVERVIEW */}
      <div style={{ background: "#fff", borderRadius: 12, padding: 20, border: "1px solid #e5e7eb", marginBottom: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#374151", margin: "0 0 14px" }}>Individual Target Progress</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {processedData.slice(0, 8).map((r) => (
            <div key={r.id} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
              background: "#f9fafb", borderRadius: 8, border: "1px solid #f3f4f6"
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%",
                background: r.status === "Exceeded" ? "#f0fdf4" : r.status === "On Track" ? "#eef2ff" : "#fef2f2",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, fontWeight: 700,
                color: r.status === "Exceeded" ? "#22c55e" : r.status === "On Track" ? "#6366f1" : "#ef4444"
              }}>
                {r.salesperson.charAt(0)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{r.salesperson}</span>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>฿{fmt(r.amount)} / ฿{fmt(r.target)}</span>
                </div>
                <MiniProgress value={r.amount} max={r.target} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* DATA TABLE with Google Sheet-style filters */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Filter size={15} color="#6366f1" />
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#374151", margin: 0 }}>Sales Data</h3>
            <span style={{ fontSize: 11, color: "#9ca3af", background: "#f3f4f6", padding: "2px 8px", borderRadius: 10 }}>
              {processedData.length} of {SALES_DATA.length} rows
            </span>
          </div>
          <p style={{ fontSize: 11, color: "#9ca3af", margin: 0 }}>Click column headers to filter & sort</p>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                {columns.map((col) => (
                  <th key={col.key} style={{ padding: "10px 14px", textAlign: "left", borderBottom: "2px solid #e5e7eb", whiteSpace: "nowrap" }}>
                    <ColumnFilter
                      column={col}
                      data={SALES_DATA}
                      activeFilters={filters}
                      onFilterChange={handleFilterChange}
                      onSortChange={handleSortChange}
                      currentSort={sort}
                    />
                  </th>
                ))}
                <th style={{ padding: "10px 14px", textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: "#374151" }}>Progress</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {processedData.length === 0 && (
                <tr><td colSpan={columns.length + 1} style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>
                  No data matches your filters. Try adjusting your criteria.
                </td></tr>
              )}
              {processedData.map((row, i) => (
                <tr key={row.id} style={{
                  background: i % 2 === 0 ? "#fff" : "#fafbfc",
                  transition: "background 0.15s"
                }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#f0f4ff"}
                  onMouseLeave={(e) => e.currentTarget.style.background = i % 2 === 0 ? "#fff" : "#fafbfc"}
                >
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontWeight: 600, color: "#374151" }}>
                    {row.salesperson}
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", color: "#6b7280" }}>{row.region}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6" }}>
                    <span style={{
                      padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                      background: row.product === "Enterprise Plan" ? "#eef2ff" : row.product === "Pro Plan" ? "#ecfeff" : "#f0fdf4",
                      color: row.product === "Enterprise Plan" ? "#4f46e5" : row.product === "Pro Plan" ? "#0891b2" : "#16a34a"
                    }}>
                      {row.product}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontWeight: 600, color: "#374151", fontVariantNumeric: "tabular-nums" }}>
                    ฿{fmt(row.amount)}
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", color: "#9ca3af", fontVariantNumeric: "tabular-nums" }}>
                    ฿{fmt(row.target)}
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", textAlign: "center" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 28, height: 28, borderRadius: "50%",
                      background: row.deals >= 20 ? "#f0fdf4" : row.deals >= 10 ? "#eef2ff" : "#fffbeb",
                      color: row.deals >= 20 ? "#22c55e" : row.deals >= 10 ? "#6366f1" : "#f59e0b",
                      fontSize: 12, fontWeight: 700
                    }}>
                      {row.deals}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6" }}>
                    <StatusIndicator status={row.status} />
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", color: "#6b7280" }}>{row.month}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6" }}>
                    <SatisfactionMeter value={row.satisfaction} />
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6", minWidth: 140 }}>
                    <MiniProgress value={row.amount} max={row.target} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 16, textAlign: "center", fontSize: 11, color: "#d1d5db" }}>
        Sales Dashboard — Powered by filter-sort-chart-google-sheet skill
      </div>
    </div>
  );
}
