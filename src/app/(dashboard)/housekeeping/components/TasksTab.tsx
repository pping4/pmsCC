'use client';

/**
 * TasksTab — Sprint 2b rebuild.
 *
 * Table-first: every column uses the shared DataTable (project's
 * GoogleSheetTable) so filter/sort/group works uniformly. Adds KPI cards +
 * a daily/monthly donut chart per Sprint 2b UX spec.
 *
 * Columns: Task# · Room · Floor · TaskType · Source · Channel · Status ·
 * Priority · Fee · AssignedTo · Scheduled · AgeHrs · Actions.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { HOUSEKEEPING_STATUSES } from '@/lib/constants';
import { fmtDate, fmtDateTime, fmtBaht } from '@/lib/date-format';
import { useToast } from '@/components/ui';
import { DataTable, type ColDef } from '@/components/data-table';
import {
  Clock, Activity, AlertTriangle, DollarSign, CalendarCheck,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip, Legend,
} from 'recharts';

// ─── Types ─────────────────────────────────────────────────────────────────

interface HousekeepingTask {
  id: string;
  taskNumber: string;
  taskType: string;
  status: string;
  priority: string;
  scheduledAt: string;
  completedAt: string | null;
  assignedTo: string | null;
  notes: string | null;
  createdAt: string;
  chargeable: boolean;
  fee: number | string | null;
  requestSource: string;
  requestChannel: string | null;
  requestedAt: string | null;
  requestedBy: string | null;
  declinedAt: string | null;
  declinedBy: string | null;
  declineChannel: string | null;
  declineNotes: string | null;
  bookingId: string | null;
  scheduleId: string | null;
  folioLineItemId: string | null;
  room: {
    id: string;
    number: string;
    floor: number;
    roomType: { name: string; code?: string };
  };
  maidTeam?: { id: string; name: string } | null;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  auto_checkout:        { label: 'เช็คเอาท์อัตโนมัติ', color: '#6b7280' },
  daily_auto:           { label: 'รายวัน (อัตโนมัติ)',  color: '#10b981' },
  guest_request:        { label: 'แขกขอ',              color: '#0284c7' },
  monthly_scheduled:    { label: 'รายเดือน (นัด)',      color: '#7c3aed' },
  recurring_auto:       { label: 'รอบประจำ',           color: '#8b5cf6' },
  manual:               { label: 'Manual',             color: '#475569' },
  maintenance_followup: { label: 'ต่อเนื่องซ่อม',       color: '#f59e0b' },
};

const CHANNEL_ICONS: Record<string, string> = {
  door_sign:   '🏷️',
  phone:       '📞',
  guest_app:   '📱',
  front_desk:  '🛎️',
  system:      '🤖',
};

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  pending:     { label: 'รอทำ',        color: '#f59e0b', bg: '#fef3c7' },
  in_progress: { label: 'กำลังทำ',     color: '#3b82f6', bg: '#dbeafe' },
  completed:   { label: 'เสร็จแล้ว',    color: '#22c55e', bg: '#dcfce7' },
  inspected:   { label: 'ตรวจแล้ว',    color: '#8b5cf6', bg: '#ede9fe' },
  cancelled:   { label: 'ยกเลิก',      color: '#64748b', bg: '#f1f5f9' },
};

const KPI_COLORS = ['#f59e0b', '#3b82f6', '#ef4444', '#10b981', '#8b5cf6'];

// ─── KPI Card ──────────────────────────────────────────────────────────────

function KpiCard({
  icon, title, value, subtitle, iconBg,
}: {
  icon: React.ReactNode; title: string; value: string | number;
  subtitle?: string; iconBg: string;
}) {
  return (
    <div className="pms-card pms-transition" style={{
      borderRadius: 12, padding: '16px 18px',
      border: '1px solid var(--border-default)',
      flex: '1 1 180px', minWidth: 170,
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {title}
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>
          {value}
        </div>
        {subtitle && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-faint)' }}>
            {subtitle}
          </div>
        )}
      </div>
      <div style={{
        width: 42, height: 42, borderRadius: 10,
        background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        {icon}
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────

export default function TasksTab() {
  const toast = useToast();
  const [tasks, setTasks] = useState<HousekeepingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/housekeeping`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTasks(await res.json());
    } catch (e) {
      toast.error('โหลดตารางงานไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const updateStatus = async (id: string, newStatus: string) => {
    if (updatingId) return;
    setUpdatingId(id);
    try {
      const res = await fetch(`/api/housekeeping/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchTasks();
      toast.success('อัปเดตสถานะสำเร็จ');
    } catch (e) {
      toast.error('อัปเดตสถานะไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setUpdatingId(null);
    }
  };

  // ── Filters ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (filterStatus === 'all') return tasks;
    return tasks.filter(t => t.status === filterStatus);
  }, [tasks, filterStatus]);

  // ── KPI stats ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const now = Date.now();
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const pending    = tasks.filter(t => t.status === 'pending').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const overdue    = tasks.filter(t =>
      t.status === 'pending' && new Date(t.scheduledAt).getTime() < today.getTime()
    ).length;

    // today
    const todayTasks = tasks.filter(t => {
      const d = new Date(t.scheduledAt); d.setHours(0, 0, 0, 0);
      return d.getTime() === today.getTime();
    });
    const dailyCount = todayTasks.filter(t =>
      t.requestSource === 'daily_auto' || t.requestSource === 'auto_checkout'
    ).length;
    const monthlyCount = todayTasks.filter(t =>
      t.requestSource === 'monthly_scheduled' || t.requestSource === 'recurring_auto'
    ).length;
    const guestCount = todayTasks.filter(t => t.requestSource === 'guest_request').length;

    // fees
    const feePaid    = tasks.filter(t => t.chargeable && (t.status === 'completed' || t.status === 'inspected'))
      .reduce((s, t) => s + Number(t.fee ?? 0), 0);
    const feePending = tasks.filter(t => t.chargeable && (t.status === 'pending' || t.status === 'in_progress'))
      .reduce((s, t) => s + Number(t.fee ?? 0), 0);

    return { pending, inProgress, overdue, dailyCount, monthlyCount, guestCount, feePaid, feePending, todayTotal: todayTasks.length };
  }, [tasks]);

  const todayPieData = useMemo(() => [
    { name: 'รายวัน / เช็คเอาท์', value: stats.dailyCount,   fill: KPI_COLORS[3] },
    { name: 'รายเดือน / รอบ',    value: stats.monthlyCount, fill: KPI_COLORS[4] },
    { name: 'แขกขอเพิ่ม',         value: stats.guestCount,   fill: KPI_COLORS[1] },
  ].filter(d => d.value > 0), [stats]);

  // ── Columns ───────────────────────────────────────────────────────────────
  type ColKey =
    | 'taskNumber' | 'room' | 'floor' | 'taskType' | 'source' | 'channel'
    | 'status' | 'priority' | 'fee' | 'assigned' | 'scheduled' | 'age' | 'actions';

  const columns: ColDef<HousekeepingTask, ColKey>[] = useMemo(() => [
    {
      key: 'taskNumber', label: 'Task #', minW: 90,
      getValue: t => t.taskNumber,
      render: t => <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>{t.taskNumber}</span>,
    },
    {
      key: 'room', label: 'ห้อง', minW: 80,
      getValue: t => String(t.room.number).padStart(6, '0'),
      getLabel: t => t.room.number,
      render: t => <strong>{t.room.number}</strong>,
    },
    {
      key: 'floor', label: 'ชั้น', minW: 60, align: 'center',
      getValue: t => String(t.room.floor).padStart(3, '0'),
      getLabel: t => String(t.room.floor),
      render: t => <span>{t.room.floor}</span>,
    },
    {
      key: 'taskType', label: 'ประเภทงาน', minW: 140,
      getValue: t => t.taskType,
      render: t => <span style={{ fontSize: 12 }}>{t.taskType}</span>,
    },
    {
      key: 'source', label: 'ที่มา', minW: 130,
      getValue: t => SOURCE_LABELS[t.requestSource]?.label ?? t.requestSource,
      render: t => {
        const s = SOURCE_LABELS[t.requestSource] ?? { label: t.requestSource, color: '#64748b' };
        return (
          <span style={{
            display: 'inline-flex', padding: '3px 10px', borderRadius: 12,
            fontSize: 11, fontWeight: 600,
            color: s.color, background: s.color + '18',
          }}>
            {s.label}
          </span>
        );
      },
    },
    {
      key: 'channel', label: 'ช่องทาง', minW: 90, align: 'center',
      getValue: t => t.requestChannel ?? '-',
      render: t => t.requestChannel
        ? <span title={t.requestChannel} style={{ fontSize: 18 }}>{CHANNEL_ICONS[t.requestChannel] ?? '·'}</span>
        : <span style={{ color: 'var(--text-faint)' }}>—</span>,
    },
    {
      key: 'status', label: 'สถานะ', minW: 100,
      getValue: t => STATUS_STYLES[t.status]?.label ?? t.status,
      render: t => {
        const s = STATUS_STYLES[t.status] ?? { label: t.status, color: '#64748b', bg: '#f1f5f9' };
        return (
          <span style={{
            display: 'inline-flex', padding: '3px 10px', borderRadius: 12,
            fontSize: 11, fontWeight: 600, color: s.color, background: s.bg,
          }}>
            {s.label}
          </span>
        );
      },
    },
    {
      key: 'priority', label: 'ความสำคัญ', minW: 90,
      getValue: t => t.priority,
      render: t => {
        if (t.priority === 'urgent') return <span style={{ color: '#dc2626', fontWeight: 700, fontSize: 12 }}>🔥 urgent</span>;
        if (t.priority === 'high')   return <span style={{ color: '#ef4444', fontWeight: 600, fontSize: 12 }}>⚡ สูง</span>;
        if (t.priority === 'low')    return <span style={{ color: '#6b7280', fontSize: 12 }}>ต่ำ</span>;
        return <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>ปกติ</span>;
      },
    },
    {
      key: 'fee', label: 'ค่าบริการ', minW: 110, align: 'right', noFilter: true,
      getValue: t => t.chargeable ? String(Math.round(Number(t.fee ?? 0) * 100)).padStart(12, '0') : '0',
      getLabel: t => t.chargeable && t.fee ? `฿${fmtBaht(Number(t.fee))}` : '—',
      aggregate: 'sum',
      aggValue: t => Number(t.fee ?? 0),
      render: t => t.chargeable && t.fee
        ? <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#0284c7' }}>฿{fmtBaht(Number(t.fee))}</span>
        : <span style={{ color: 'var(--text-faint)' }}>—</span>,
    },
    {
      key: 'assigned', label: 'ผู้รับผิดชอบ', minW: 130,
      getValue: t => t.maidTeam?.name ?? t.assignedTo ?? '-ยังไม่มอบหมาย-',
      render: t => t.maidTeam
        ? <span style={{ fontSize: 12 }}>👥 {t.maidTeam.name}</span>
        : t.assignedTo
          ? <span style={{ fontSize: 12 }}>👤 {t.assignedTo}</span>
          : <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>—</span>,
    },
    {
      key: 'scheduled', label: 'กำหนด', minW: 140,
      getValue: t => (t.scheduledAt ?? '').slice(0, 10),
      getLabel: t => fmtDate(t.scheduledAt),
      render: t => <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDate(t.scheduledAt)}</span>,
    },
    {
      key: 'age', label: 'อายุงาน (ชม.)', minW: 90, align: 'right', noFilter: true,
      getValue: t => {
        const hrs = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60));
        return String(hrs).padStart(6, '0');
      },
      getLabel: t => {
        const hrs = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60));
        return `${hrs}h`;
      },
      render: t => {
        const hrs = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60));
        const color = hrs > 24 ? '#dc2626' : hrs > 8 ? '#f59e0b' : 'var(--text-muted)';
        return <span style={{ fontSize: 12, fontFamily: 'monospace', color }}>{hrs}h</span>;
      },
    },
    {
      key: 'actions', label: 'จัดการ', align: 'center', minW: 160, noFilter: true,
      getValue: () => '',
      render: t => (
        <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
          {t.status === 'pending' && (
            <button onClick={(e) => { e.stopPropagation(); updateStatus(t.id, 'in_progress'); }}
              style={{ padding: '3px 10px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
              ▶ เริ่ม
            </button>
          )}
          {t.status === 'in_progress' && (
            <button onClick={(e) => { e.stopPropagation(); updateStatus(t.id, 'completed'); }}
              style={{ padding: '3px 10px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
              ✓ เสร็จ
            </button>
          )}
          {t.status === 'completed' && (
            <button onClick={(e) => { e.stopPropagation(); updateStatus(t.id, 'inspected'); }}
              style={{ padding: '3px 10px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 11, cursor: 'pointer', color: '#7c3aed', fontWeight: 600 }}>
              ✅ ตรวจ
            </button>
          )}
          {t.status === 'inspected' && <span style={{ fontSize: 11, color: '#8b5cf6', fontWeight: 700 }}>✅ สมบูรณ์</span>}
          {t.status === 'cancelled' && (
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}
                  title={t.declineNotes ?? undefined}>
              🚫 {t.declineChannel ? (CHANNEL_ICONS[t.declineChannel] ?? '') : ''}
            </span>
          )}
        </div>
      ),
    },
  ], [updatingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Status tabs ────────────────────────────────────────────────────────────
  const statusTabs = [
    { id: 'all',         label: 'ทั้งหมด',     color: '#374151' },
    { id: 'pending',     label: 'รอทำ',        color: '#f59e0b' },
    { id: 'in_progress', label: 'กำลังทำ',     color: '#3b82f6' },
    { id: 'completed',   label: 'เสร็จแล้ว',    color: '#22c55e' },
    { id: 'inspected',   label: 'ตรวจแล้ว',    color: '#8b5cf6' },
    { id: 'cancelled',   label: 'ยกเลิก',      color: '#64748b' },
  ];

  const statusCounts = tasks.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <KpiCard
          icon={<Clock size={20} color="#f59e0b" />} iconBg="#fef3c7"
          title="รอทำ" value={stats.pending} subtitle="pending tasks"
        />
        <KpiCard
          icon={<Activity size={20} color="#3b82f6" />} iconBg="#dbeafe"
          title="กำลังทำ" value={stats.inProgress} subtitle="in-progress"
        />
        <KpiCard
          icon={<AlertTriangle size={20} color="#dc2626" />} iconBg="#fee2e2"
          title="เกินกำหนด" value={stats.overdue} subtitle="overdue"
        />
        <KpiCard
          icon={<DollarSign size={20} color="#10b981" />} iconBg="#d1fae5"
          title="ค่าบริการ"
          value={`฿${fmtBaht(stats.feePaid)}`}
          subtitle={`ค้างเก็บ ฿${fmtBaht(stats.feePending)}`}
        />
        <KpiCard
          icon={<CalendarCheck size={20} color="#7c3aed" />} iconBg="#ede9fe"
          title="วันนี้ต้องทำ" value={stats.todayTotal}
          subtitle={`รายวัน ${stats.dailyCount} / เดือน ${stats.monthlyCount}`}
        />
      </div>

      {/* Donut — today breakdown */}
      {todayPieData.length > 0 && (
        <div className="pms-card pms-transition" style={{
          borderRadius: 12, padding: 18, border: '1px solid var(--border-default)',
          display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
            งานวันนี้แบ่งตามที่มา
          </div>
          <div style={{ flex: '1 1 300px', minWidth: 260, height: 140 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={todayPieData} dataKey="value" nameKey="name"
                     cx="50%" cy="50%" innerRadius={32} outerRadius={55} paddingAngle={3}>
                  {todayPieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <RTooltip formatter={(v) => [`${v} งาน`]} />
                <Legend verticalAlign="middle" align="right" layout="vertical" iconSize={10} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--surface-muted)', borderRadius: 10, padding: 3, overflowX: 'auto' }}>
        {statusTabs.map(t => (
          <button key={t.id} onClick={() => setFilterStatus(t.id)}
            className="pms-transition"
            style={{
              padding: '7px 14px', borderRadius: 8, border: 'none',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: filterStatus === t.id ? 'var(--surface-card)' : 'transparent',
              color:      filterStatus === t.id ? t.color : 'var(--text-muted)',
              whiteSpace: 'nowrap',
              boxShadow:  filterStatus === t.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}>
            {t.label}{t.id !== 'all' && statusCounts[t.id] ? ` (${statusCounts[t.id]})` : ''}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-faint)' }}>กำลังโหลด...</div>
      ) : (
        <DataTable<HousekeepingTask, ColKey>
          tableKey={`housekeeping.tasks.${filterStatus}`}
          syncUrl
          exportFilename={`pms_housekeeping_${filterStatus}`}
          exportSheetName="ตารางงานแม่บ้าน"
          rows={filtered}
          columns={columns}
          rowKey={t => t.id}
          defaultSort={{ col: 'scheduled', dir: 'desc' }}
          dateRange={{
            col: 'scheduled',
            getDate: t => t.scheduledAt ? new Date(t.scheduledAt) : null,
            label: 'วันที่กำหนด',
          }}
          groupByCols={['status', 'source', 'floor', 'assigned', 'taskType']}
          emptyText="ไม่มีงานแม่บ้าน"
          summaryLabel={(f, total) => (
            <>🧹 {f}{f !== total ? `/${total}` : ''} งาน · ช่วงเวลาที่แสดงตาม {fmtDateTime(new Date())}</>
          )}
        />
      )}
    </div>
  );
}
