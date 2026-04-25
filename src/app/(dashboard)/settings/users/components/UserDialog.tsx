/**
 * UserDialog — create / edit a user + permission matrix.
 *
 * Props:
 *   mode='create' → POST /api/admin/users
 *   mode='edit'   → PATCH /api/admin/users/[id]
 *
 * The dialog owns the form state locally. On success it calls `onSaved()`
 * which the parent uses to refetch the list. Keeps everything client-side —
 * no server actions in this module (REST only, per project style).
 */

'use client';

import { useEffect, useState } from 'react';
import type { UserRole } from '@prisma/client';
import { useToast } from '@/components/ui';
import { PermissionMatrix, type OverridesValue } from './PermissionMatrix';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  permissionOverrides: unknown;
}

interface Props {
  mode: 'create' | 'edit';
  user?: UserRow; // required when mode='edit'
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'admin', label: 'Admin — ผู้ดูแลระบบ' },
  { value: 'manager', label: 'Manager — ผู้จัดการ' },
  { value: 'cashier', label: 'Cashier — แคชเชียร์' },
  { value: 'front', label: 'Front — พนักงานต้อนรับ' },
  { value: 'housekeeping', label: 'Housekeeping — แม่บ้าน' },
  { value: 'maintenance', label: 'Maintenance — ช่าง' },
  { value: 'staff', label: '(legacy) Staff — เทียบเท่า Front' },
  { value: 'customer', label: 'Customer — ลูกค้า (reserved)' },
];

function normaliseOverrides(raw: unknown): OverridesValue {
  if (!raw || typeof raw !== 'object') return { add: [], remove: [] };
  const obj = raw as { add?: unknown; remove?: unknown };
  const add = Array.isArray(obj.add) ? (obj.add.filter((x) => typeof x === 'string') as string[]) : [];
  const remove = Array.isArray(obj.remove) ? (obj.remove.filter((x) => typeof x === 'string') as string[]) : [];
  return { add, remove };
}

export function UserDialog({ mode, user, open, onClose, onSaved }: Props) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('front');
  const [active, setActive] = useState(true);
  const [overrides, setOverrides] = useState<OverridesValue>({ add: [], remove: [] });
  const [saving, setSaving] = useState(false);

  // Reset form whenever dialog reopens with a new user
  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && user) {
      setName(user.name);
      setEmail(user.email);
      setPassword('');
      setRole(user.role);
      setActive(user.active);
      setOverrides(normaliseOverrides(user.permissionOverrides));
    } else {
      setName('');
      setEmail('');
      setPassword('');
      setRole('front');
      setActive(true);
      setOverrides({ add: [], remove: [] });
    }
  }, [open, mode, user]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);

    try {
      const url =
        mode === 'create' ? '/api/admin/users' : `/api/admin/users/${user!.id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';

      const body: Record<string, unknown> = {
        name,
        role,
        active,
        permissionOverrides: overrides,
      };
      if (mode === 'create') {
        body.email = email;
        body.password = password;
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      toast.success(mode === 'create' ? 'สร้างผู้ใช้เรียบร้อย' : 'บันทึกเรียบร้อย');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(
        mode === 'create' ? 'สร้างผู้ใช้ไม่สำเร็จ' : 'บันทึกไม่สำเร็จ',
        err instanceof Error ? err.message : undefined,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 20,
      }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface-card)',
          borderRadius: 12,
          width: '100%',
          maxWidth: 900,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
        }}
      >
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid var(--border-default)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            {mode === 'create' ? 'สร้างผู้ใช้ใหม่' : `แก้ไขผู้ใช้: ${user?.name ?? ''}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 20,
              cursor: 'pointer',
              color: 'var(--text-muted)',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 24, overflow: 'auto', flex: 1 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 16,
              marginBottom: 20,
            }}
          >
            <div>
              <label style={fieldLabel}>ชื่อ *</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={input}
                maxLength={191}
              />
            </div>
            <div>
              <label style={fieldLabel}>อีเมล *</label>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={mode === 'edit'}
                style={{
                  ...input,
                  background: mode === 'edit' ? 'var(--surface-muted)' : undefined,
                  cursor: mode === 'edit' ? 'not-allowed' : 'text',
                }}
                maxLength={191}
              />
              {mode === 'edit' && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  อีเมลเปลี่ยนไม่ได้หลังสร้างแล้ว (globally unique)
                </div>
              )}
            </div>
            {mode === 'create' && (
              <div>
                <label style={fieldLabel}>รหัสผ่าน * (≥ 8 ตัว)</label>
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={input}
                  minLength={8}
                  maxLength={128}
                />
              </div>
            )}
            <div>
              <label style={fieldLabel}>Role *</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                style={input}
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 22 }}>
              <input
                type="checkbox"
                id="active-chk"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              <label htmlFor="active-chk" style={{ fontSize: 13 }}>
                เปิดใช้งาน (active)
              </label>
            </div>
          </div>

          <div
            style={{
              marginBottom: 12,
              fontWeight: 700,
              fontSize: 13,
              color: 'var(--text-secondary)',
            }}
          >
            สิทธิ์การใช้งาน (Permission overrides)
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              marginBottom: 8,
            }}
          >
            <span style={{ background: '#fef3c7', padding: '1px 6px', borderRadius: 3 }}>
              สีเหลือง
            </span>{' '}
            = แตกต่างจาก default ของ role • ติ๊กออกเพื่อลด default • ติ๊กเพิ่มเพื่อให้สิทธิ์พิเศษ
          </div>

          <PermissionMatrix role={role} value={overrides} onChange={setOverrides} />
        </div>

        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid var(--border-default)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={btnGhost}
          >
            ยกเลิก
          </button>
          <button type="submit" disabled={saving} style={btnPrimary}>
            {saving ? 'กำลังบันทึก…' : mode === 'create' ? 'สร้างผู้ใช้' : 'บันทึก'}
          </button>
        </div>
      </form>
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-secondary)',
};
const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--surface-card)',
  color: 'var(--text-primary)',
};
const btnGhost: React.CSSProperties = {
  padding: '8px 14px',
  background: 'transparent',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  background: '#1d4ed8',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};
