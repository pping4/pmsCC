/**
 * Contracts list page — /contracts
 *
 * Sprint 3B / Module A, Phase 3 T9.
 *
 * Renders a GoogleSheetTable (per CLAUDE.md §5) of all contracts with KPI
 * cards summarising active count, those expiring in 30 days, draft count,
 * and the total monthly rent value of active contracts.
 *
 * Data fetch: client-side `GET /api/contracts?limit=500`. The route enforces
 * auth (NextAuth session) and the service returns a tailored `select`
 * projection — no raw Prisma objects reach the client.
 *
 * Per-row click → `/contracts/[id]` detail page.
 *
 * The "+ สร้างสัญญาใหม่" button is a placeholder: contracts are only ever
 * created from a monthly booking (BOOKING_NOT_MONTHLY rule in service), so
 * the button emits a toast instructing the user to start from a booking.
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileSignature,
  AlertTriangle,
  FileEdit,
  DollarSign,
} from 'lucide-react';
import type { ContractStatus } from '@prisma/client';
import { fmtDate, fmtBaht } from '@/lib/date-format';
import { useToast } from '@/components/ui';
import {
  GoogleSheetTable,
  type ColDef,
} from './components/GoogleSheetTable';
import { BulkRenewalDialog } from './components/BulkRenewalDialog';

// ─── Row shape (mirrors ContractListRow from the service) ────────────────────
// Dates arrive as ISO strings over JSON; we parse lazily inside renderers.
interface ApiContractRow {
  id:                  string;
  contractNumber:      string;
  status:              ContractStatus;
  startDate:           string;
  endDate:             string;
  monthlyRoomRent:     number;
  monthlyFurnitureRent: number;
  guestId:             string;
  guestName:           string;
  bookingId:           string;
  roomNumber:          string | null;
  daysUntilExpiry:     number;
}

/** Flat row actually fed to GoogleSheetTable (string-friendly for filters). */
interface ContractRow {
  id:               string;
  contractNumber:   string;
  status:           ContractStatus;
  statusLabel:      string;
  guestName:        string;
  roomNumber:       string;
  startDate:        Date;
  endDate:          Date;
  monthlyRoomRent:  number;
  daysUntilExpiry:  number;
}

// ─── Status presentation ────────────────────────────────────────────────────

const STATUS_META: Record<ContractStatus, { label: string; fg: string; bg: string }> = {
  draft:      { label: 'ร่าง',       fg: '#4b5563', bg: '#f3f4f6' }, // gray
  active:     { label: 'ใช้งาน',      fg: '#16a34a', bg: '#dcfce7' }, // green
  expired:    { label: 'หมดอายุ',    fg: '#c2410c', bg: '#ffedd5' }, // orange
  terminated: { label: 'ยกเลิก',     fg: '#b91c1c', bg: '#fee2e2' }, // red
  renewed:    { label: 'ต่อสัญญาแล้ว', fg: '#1d4ed8', bg: '#dbeafe' }, // blue
};

function StatusBadge({ status }: { status: ContractStatus }) {
  const m = STATUS_META[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 10px', borderRadius: 12,
      fontSize: 11, fontWeight: 700,
      background: m.bg, color: m.fg,
    }}>
      {m.label}
    </span>
  );
}

// ─── KPI card ───────────────────────────────────────────────────────────────

interface KpiCardProps {
  icon:    React.ReactNode;
  iconBg:  string;
  title:   string;
  value:   string | number;
  subtitle?: string;
}

function KpiCard({ icon, iconBg, title, value, subtitle }: KpiCardProps) {
  return (
    <div
      className="pms-card pms-transition"
      style={{
        borderRadius: 12, padding: '18px 20px',
        border: '1px solid var(--border-default)',
        flex: '1 1 200px', minWidth: 180,
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'flex-start', gap: 12,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: 11, color: 'var(--text-muted)', fontWeight: 600,
          marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5,
        }}>
          {title}
        </div>
        <div style={{
          fontSize: 26, fontWeight: 800,
          color: 'var(--text-primary)', lineHeight: 1,
        }}>
          {value}
        </div>
        {subtitle && (
          <div style={{
            marginTop: 6, fontSize: 11, color: 'var(--text-faint)',
          }}>
            {subtitle}
          </div>
        )}
      </div>
      <div style={{
        width: 44, height: 44, borderRadius: 10,
        background: iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        {icon}
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function ContractsPage() {
  const router   = useRouter();
  const toast    = useToast();
  const [rows, setRows]       = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);
  /** Bumped on a successful bulk-renewal run to trigger a refetch. */
  const [reloadTick, setReloadTick] = useState(0);

  // ── Fetch ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/contracts?limit=500')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ApiContractRow[]>;
      })
      .then(data => {
        if (cancelled) return;
        const mapped: ContractRow[] = (Array.isArray(data) ? data : []).map(r => ({
          id:              r.id,
          contractNumber:  r.contractNumber,
          status:          r.status,
          statusLabel:     STATUS_META[r.status]?.label ?? r.status,
          guestName:       r.guestName,
          roomNumber:      r.roomNumber ?? '—',
          startDate:       new Date(r.startDate),
          endDate:         new Date(r.endDate),
          monthlyRoomRent: Number(r.monthlyRoomRent),
          daysUntilExpiry: r.daysUntilExpiry,
        }));
        setRows(mapped);
      })
      .catch(err => {
        if (cancelled) return;
        toast.error(
          'โหลดรายการสัญญาไม่สำเร็จ',
          err instanceof Error ? err.message : undefined,
        );
        setRows([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [toast, reloadTick]);

  // Id → contractNumber map, handed to the bulk-renewal dialog so the result
  // grid can show human-friendly labels instead of raw UUIDs.
  const contractLabelMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const r of rows) map[r.id] = r.contractNumber;
    return map;
  }, [rows]);

  // ── KPI stats ────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const active    = rows.filter(r => r.status === 'active');
    const drafts    = rows.filter(r => r.status === 'draft');
    const expiring  = active.filter(r =>
      r.daysUntilExpiry >= 0 && r.daysUntilExpiry <= 30,
    );
    const totalRent = active.reduce((s, r) => s + r.monthlyRoomRent, 0);
    return {
      activeCount:   active.length,
      expiringCount: expiring.length,
      draftCount:    drafts.length,
      totalRent,
    };
  }, [rows]);

  // ── Columns ──────────────────────────────────────────────────────────────
  type ColKey =
    | 'contractNumber' | 'guestName' | 'roomNumber'
    | 'statusLabel' | 'startDate' | 'endDate'
    | 'monthlyRoomRent' | 'daysUntilExpiry';

  const columns: ColDef<ContractRow, ColKey>[] = useMemo(() => [
    {
      key: 'contractNumber', label: 'เลขสัญญา', minW: 140,
      getValue: r => r.contractNumber,
      render: r => (
        <span style={{
          fontFamily: 'monospace', fontWeight: 700, fontSize: 12,
          color: 'var(--text-primary)',
        }}>
          {r.contractNumber}
        </span>
      ),
    },
    {
      key: 'guestName', label: 'ลูกค้า', minW: 180,
      getValue: r => r.guestName,
      render: r => (
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {r.guestName}
        </span>
      ),
    },
    {
      key: 'roomNumber', label: 'ห้อง', minW: 80,
      getValue: r => r.roomNumber,
      render: r => (
        <span style={{
          fontFamily: 'monospace', fontWeight: 700,
          color: 'var(--text-secondary)',
        }}>
          {r.roomNumber}
        </span>
      ),
    },
    {
      key: 'statusLabel', label: 'สถานะ', minW: 110,
      getValue: r => r.statusLabel,
      render: r => <StatusBadge status={r.status} />,
    },
    {
      key: 'startDate', label: 'เริ่มต้น', minW: 110,
      // Pad to sortable ISO string; raw Date → fmtDate() in render.
      getValue: r => fmtDate(r.startDate),
      getLabel: r => fmtDate(r.startDate),
      render: r => (
        <span style={{ color: 'var(--text-secondary)' }}>
          {fmtDate(r.startDate)}
        </span>
      ),
    },
    {
      key: 'endDate', label: 'สิ้นสุด', minW: 110,
      getValue: r => fmtDate(r.endDate),
      getLabel: r => fmtDate(r.endDate),
      render: r => {
        const warn = r.status === 'active' && r.daysUntilExpiry >= 0 && r.daysUntilExpiry <= 30;
        return (
          <span style={{
            color: warn ? '#c2410c' : 'var(--text-secondary)',
            fontWeight: warn ? 700 : 400,
          }}>
            {fmtDate(r.endDate)}
            {warn && (
              <span style={{ fontSize: 10, marginLeft: 6 }}>
                ({r.daysUntilExpiry}d)
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'monthlyRoomRent', label: 'ค่าเช่า/เดือน', minW: 120,
      align: 'right', noFilter: true,
      // Padded string for numeric sort; label shows formatted value.
      getValue: r => String(Math.round(r.monthlyRoomRent * 100)).padStart(12, '0'),
      getLabel: r => fmtBaht(r.monthlyRoomRent),
      aggregate: 'sum',
      aggValue: r => r.monthlyRoomRent,
      render: r => (
        <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>
          {fmtBaht(r.monthlyRoomRent)}
        </span>
      ),
    },
    {
      key: 'daysUntilExpiry', label: 'เหลือ (วัน)', minW: 100,
      align: 'right', noFilter: true,
      // Negative for expired → still sorts correctly via signed padding.
      getValue: r => String(r.daysUntilExpiry + 1_000_000).padStart(8, '0'),
      getLabel: r => String(r.daysUntilExpiry),
      render: r => {
        if (r.status !== 'active') {
          return <span style={{ color: 'var(--text-faint)' }}>—</span>;
        }
        const d = r.daysUntilExpiry;
        const color = d < 0 ? '#b91c1c' : d <= 30 ? '#c2410c' : 'var(--text-secondary)';
        return (
          <span style={{ color, fontWeight: 600, fontFamily: 'monospace' }}>
            {d < 0 ? `${d}` : d}
          </span>
        );
      },
    },
  ], []);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleCreateClick = () => {
    toast.info(
      'สร้างสัญญาใหม่',
      'เลือก booking ก่อนแล้วกด สร้างสัญญา จากหน้า booking detail',
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 10,
      }}>
        <div>
          <h1 style={{
            margin: 0, fontSize: 22, fontWeight: 800,
            color: 'var(--text-primary)',
          }}>
            สัญญาเช่า
          </h1>
          <p style={{
            margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)',
          }}>
            {rows.length} ฉบับทั้งหมด
            {kpis.expiringCount > 0 && ` · ${kpis.expiringCount} ฉบับใกล้หมดอายุ`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/*
            TODO(T22): gate "ต่อสัญญาแบบกลุ่ม" to admin/manager role once the
            session role is reliably exposed to this client component. For now
            we rely on the API route (POST requireRole admin|manager) as the
            authoritative gate — staff will see a 403 toast if they try.
          */}
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            style={{
              padding: '9px 18px', background: 'var(--surface-card)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ต่อสัญญาแบบกลุ่ม
          </button>
          <button
            type="button"
            onClick={handleCreateClick}
            style={{
              padding: '9px 18px', background: '#1e40af', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            + สร้างสัญญาใหม่
          </button>
        </div>
      </div>

      {/* ── KPI cards ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <KpiCard
          icon={<FileSignature size={20} color="#16a34a" />}
          iconBg="#f0fdf4"
          title="สัญญาที่ใช้งาน"
          value={kpis.activeCount}
          subtitle="active contracts"
        />
        <KpiCard
          icon={<AlertTriangle size={20} color="#c2410c" />}
          iconBg="#ffedd5"
          title="ใกล้หมดอายุ (30 วัน)"
          value={kpis.expiringCount}
          subtitle="ต้องต่อสัญญา / ต่อรอง"
        />
        <KpiCard
          icon={<FileEdit size={20} color="#6b7280" />}
          iconBg="#f3f4f6"
          title="ร่าง (draft)"
          value={kpis.draftCount}
          subtitle="ยังไม่ลงนาม"
        />
        <KpiCard
          icon={<DollarSign size={20} color="#f59e0b" />}
          iconBg="#fffbeb"
          title="ค่าเช่ารวม/เดือน"
          value={fmtBaht(kpis.totalRent)}
          subtitle="สัญญาที่ใช้งาน"
        />
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{
          textAlign: 'center', padding: 60, color: 'var(--text-faint)',
        }}>
          กำลังโหลด...
        </div>
      ) : (
        <GoogleSheetTable<ContractRow, ColKey>
          tableKey="contracts.list"
          syncUrl
          exportFilename="pms_contracts"
          exportSheetName="สัญญาเช่า"
          rows={rows}
          columns={columns}
          rowKey={r => r.id}
          defaultSort={{ col: 'startDate', dir: 'desc' }}
          groupByCols={['statusLabel']}
          onRowClick={r => router.push(`/contracts/${r.id}`)}
          emptyText="ยังไม่มีสัญญาในระบบ"
          summaryLabel={(f, t) => <>📄 สัญญา — {f}{f !== t ? `/${t}` : ''} ฉบับ</>}
        />
      )}

      {/* ── Bulk renewal dialog (T20) ──────────────────────────────────────── */}
      <BulkRenewalDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        idToLabel={contractLabelMap}
        onSuccess={() => {
          // Refetch the list so newly billed contracts reflect fresh dates.
          setReloadTick(n => n + 1);
        }}
      />
    </div>
  );
}
