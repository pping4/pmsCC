/**
 * /settings/users — User management (admin only)
 * ------------------------------------------------
 * Sprint 4A / A-T6 + A-T7 (combined page + create/edit dialog).
 *
 * Lists all users (active + inactive) with KPI cards, search, and per-row
 * actions (edit, reset password, deactivate/reactivate). The permission
 * matrix dialog handles both create and edit flows.
 *
 * Access: `admin.manage_users` permission (the API enforces; the client
 * gates the menu link via `useEffectivePermissions` from A-T9). If a
 * non-admin lands here directly, the API will 403 and the page shows the
 * error state.
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UserRole } from '@prisma/client';
import { Users, UserCheck, UserX, ShieldCheck } from 'lucide-react';
import { fmtDateTime } from '@/lib/date-format';
import { useToast } from '@/components/ui';
import { UserDialog } from './components/UserDialog';

interface ApiUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  permissionOverrides: unknown;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const ROLE_META: Record<UserRole, { label: string; bg: string; fg: string }> = {
  admin: { label: 'Admin', bg: '#fee2e2', fg: '#b91c1c' },
  manager: { label: 'Manager', bg: '#fef3c7', fg: '#b45309' },
  cashier: { label: 'Cashier', bg: '#dcfce7', fg: '#15803d' },
  front: { label: 'Front', bg: '#dbeafe', fg: '#1d4ed8' },
  housekeeping: { label: 'Housekeeping', bg: '#ede9fe', fg: '#6d28d9' },
  maintenance: { label: 'Maintenance', bg: '#ffedd5', fg: '#c2410c' },
  staff: { label: 'Staff (legacy)', bg: '#f3f4f6', fg: '#4b5563' },
  customer: { label: 'Customer', bg: '#f3e8ff', fg: '#7e22ce' },
};

export default function UsersPage() {
  const toast = useToast();
  const [rows, setRows] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [showInactive, setShowInactive] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [editTarget, setEditTarget] = useState<ApiUser | null>(null);

  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  // ── Fetch ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (roleFilter) params.set('role', roleFilter);
    if (!showInactive) params.set('active', 'true');
    if (search.trim()) params.set('search', search.trim());

    fetch(`/api/admin/users?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<{ items: ApiUser[]; total: number }>;
      })
      .then((data) => {
        if (cancelled) return;
        setRows(Array.isArray(data.items) ? data.items : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'โหลดรายชื่อผู้ใช้ไม่สำเร็จ');
        setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [roleFilter, showInactive, search, reloadTick]);

  // ── KPI stats ─────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((u) => u.active).length;
    const inactive = total - active;
    const admins = rows.filter((u) => u.active && u.role === 'admin').length;
    return { total, active, inactive, admins };
  }, [rows]);

  // ── Actions ───────────────────────────────────────────────────────────
  const openCreate = () => {
    setDialogMode('create');
    setEditTarget(null);
    setDialogOpen(true);
  };
  const openEdit = (u: ApiUser) => {
    setDialogMode('edit');
    setEditTarget(u);
    setDialogOpen(true);
  };

  async function handleDeactivate(u: ApiUser) {
    if (!confirm(`ปิดใช้งาน "${u.name}" ใช่หรือไม่?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast.success('ปิดใช้งานผู้ใช้เรียบร้อย');
      reload();
    } catch (err) {
      toast.error('ปิดใช้งานไม่สำเร็จ', err instanceof Error ? err.message : undefined);
    }
  }

  async function handleReactivate(u: ApiUser) {
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast.success('เปิดใช้งานผู้ใช้เรียบร้อย');
      reload();
    } catch (err) {
      toast.error('เปิดใช้งานไม่สำเร็จ', err instanceof Error ? err.message : undefined);
    }
  }

  async function handleResetPassword(u: ApiUser) {
    const pw = prompt(`รีเซ็ตรหัสผ่านของ ${u.name}\nกรอกรหัสผ่านใหม่ (≥ 8 ตัว):`);
    if (!pw) return;
    if (pw.length < 8) {
      toast.error('รหัสผ่านต้องอย่างน้อย 8 ตัว');
      return;
    }
    try {
      const res = await fetch(`/api/admin/users/${u.id}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: pw }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast.success('รีเซ็ตรหัสผ่านเรียบร้อย');
    } catch (err) {
      toast.error('รีเซ็ตรหัสผ่านไม่สำเร็จ', err instanceof Error ? err.message : undefined);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>
            จัดการผู้ใช้
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            เพิ่ม / แก้ไข / จัดสิทธิ์ผู้ใช้ระบบ
          </div>
        </div>
        <button
          onClick={openCreate}
          style={{
            padding: '10px 18px',
            background: '#1d4ed8',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          + สร้างผู้ใช้
        </button>
      </div>

      {/* KPI row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <KpiCard icon={<Users size={20} color="#1d4ed8" />} iconBg="#dbeafe" title="ผู้ใช้ทั้งหมด" value={kpis.total} />
        <KpiCard icon={<UserCheck size={20} color="#15803d" />} iconBg="#dcfce7" title="ใช้งานอยู่" value={kpis.active} />
        <KpiCard icon={<UserX size={20} color="#b91c1c" />} iconBg="#fee2e2" title="ปิดใช้งาน" value={kpis.inactive} />
        <KpiCard icon={<ShieldCheck size={20} color="#b45309" />} iconBg="#fef3c7" title="Admin" value={kpis.admins} />
      </div>

      {/* Filters */}
      <div
        className="pms-card pms-transition"
        style={{
          padding: 12,
          border: '1px solid var(--border-default)',
          borderRadius: 10,
          marginBottom: 12,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <input
          placeholder="ค้นหาชื่อหรืออีเมล…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: '1 1 260px',
            padding: '8px 10px',
            border: '1px solid var(--border-default)',
            borderRadius: 6,
            fontSize: 13,
          }}
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as UserRole | '')}
          style={{
            padding: '8px 10px',
            border: '1px solid var(--border-default)',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          <option value="">ทุก role</option>
          {Object.entries(ROLE_META).map(([k, m]) => (
            <option key={k} value={k}>
              {m.label}
            </option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          แสดงผู้ที่ปิดใช้งาน
        </label>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          {rows.length} รายการ
        </div>
      </div>

      {/* Table */}
      <div
        className="pms-card pms-transition"
        style={{
          border: '1px solid var(--border-default)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {error && (
          <div
            style={{
              padding: 16,
              background: '#fef2f2',
              color: '#b91c1c',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
            กำลังโหลด…
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
            ไม่พบข้อมูล
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-subtle)' }}>
                <th style={th}>ชื่อ</th>
                <th style={th}>อีเมล</th>
                <th style={th}>Role</th>
                <th style={th}>สถานะ</th>
                <th style={th}>เข้าใช้ครั้งล่าสุด</th>
                <th style={{ ...th, textAlign: 'right' }}>การดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u, i) => {
                const meta = ROLE_META[u.role];
                return (
                  <tr
                    key={u.id}
                    style={{
                      background: i % 2 === 0 ? 'var(--surface-card)' : 'var(--surface-subtle)',
                      opacity: u.active ? 1 : 0.5,
                    }}
                  >
                    <td style={td}>{u.name}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{u.email}</td>
                    <td style={td}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 10,
                          background: meta.bg,
                          color: meta.fg,
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td style={td}>
                      {u.active ? (
                        <span style={{ color: '#15803d', fontSize: 12, fontWeight: 600 }}>
                          ● ใช้งาน
                        </span>
                      ) : (
                        <span style={{ color: '#b91c1c', fontSize: 12, fontWeight: 600 }}>
                          ● ปิดใช้งาน
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, fontSize: 12, color: 'var(--text-muted)' }}>
                      {u.lastLoginAt ? fmtDateTime(new Date(u.lastLoginAt)) : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button onClick={() => openEdit(u)} style={btnRow}>
                        แก้ไข
                      </button>
                      <button onClick={() => handleResetPassword(u)} style={btnRow}>
                        รีเซ็ตรหัสผ่าน
                      </button>
                      {u.active ? (
                        <button
                          onClick={() => handleDeactivate(u)}
                          style={{ ...btnRow, color: '#b91c1c' }}
                        >
                          ปิดใช้งาน
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReactivate(u)}
                          style={{ ...btnRow, color: '#15803d' }}
                        >
                          เปิดใช้งาน
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <UserDialog
        mode={dialogMode}
        user={editTarget ?? undefined}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={reload}
      />
    </div>
  );
}

// ─── Small UI bits ─────────────────────────────────────────────────────

function KpiCard({ icon, iconBg, title, value }: {
  icon: React.ReactNode; iconBg: string; title: string; value: number;
}) {
  return (
    <div
      className="pms-card pms-transition"
      style={{
        borderRadius: 12,
        padding: '14px 16px',
        border: '1px solid var(--border-default)',
        flex: '1 1 180px',
        minWidth: 160,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            fontWeight: 600,
            marginBottom: 4,
            textTransform: 'uppercase',
            letterSpacing: 0.3,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>
          {value}
        </div>
      </div>
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: iconBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.3,
  color: 'var(--text-secondary)',
  fontWeight: 700,
  borderBottom: '1px solid var(--border-default)',
};
const td: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--border-light)',
  verticalAlign: 'middle',
};
const btnRow: React.CSSProperties = {
  padding: '4px 10px',
  marginLeft: 4,
  background: 'transparent',
  border: '1px solid var(--border-default)',
  borderRadius: 4,
  fontSize: 11,
  cursor: 'pointer',
  color: 'var(--text-primary)',
};
