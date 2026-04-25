/**
 * PermissionMatrix — checkbox grid for permissionOverrides editing.
 *
 * Given the target user's `role` and current `permissionOverrides`, renders
 * every cataloged permission grouped by category. Each checkbox shows 3 states:
 *
 *   - "default on"     (grey tick, cannot be unticked without an explicit
 *                       remove-override)
 *   - "default on + kept"  (same as default)
 *   - "default off + added" (blue tick from override.add)
 *   - "default on - removed" (red slash from override.remove — Option A)
 *
 * Value shape matches `User.permissionOverrides`: `{ add: string[], remove: string[] }`.
 * Parent owns the state; this component just diffs user intent vs role defaults
 * and hands back the minimal override object.
 */

'use client';

import { useMemo } from 'react';
import type { UserRole } from '@prisma/client';
import {
  PERMISSION_CATALOG,
  ROLE_DEFAULTS,
  type UserRoleName,
} from '@/lib/rbac/permissions';

export interface OverridesValue {
  add: string[];
  remove: string[];
}

interface Props {
  role: UserRole;
  value: OverridesValue;
  onChange: (v: OverridesValue) => void;
  readOnly?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  reservation: 'จองห้อง / Reservation',
  cashier: 'แคชเชียร์ / Cashier',
  housekeeping: 'แม่บ้าน / Housekeeping',
  maintenance: 'ช่าง / Maintenance',
  finance: 'การเงิน / Finance',
  contracts: 'สัญญา / Contracts',
  admin: 'แอดมิน / Admin',
  customer: 'ลูกค้า / Customer (Phase II)',
};

const PERMISSION_LABELS: Record<string, string> = {
  'reservation.view': 'ดูรายการจอง',
  'reservation.create': 'สร้างการจอง',
  'reservation.edit': 'แก้ไขการจอง',
  'reservation.cancel': 'ยกเลิกการจอง',
  'reservation.checkin': 'Check-in',
  'reservation.checkout': 'Check-out',
  'reservation.change_room': 'เปลี่ยนห้อง',
  'reservation.waive_fee': 'ยกเว้นค่าธรรมเนียม',
  'cashier.open_shift': 'เปิดกะเคาน์เตอร์',
  'cashier.close_shift': 'ปิดกะเคาน์เตอร์',
  'cashier.record_payment': 'รับชำระเงิน',
  'cashier.refund': 'คืนเงิน',
  'cashier.handover': 'ส่งกะ',
  'cashier.view_other_shifts': 'ดูกะของผู้ใช้อื่น',
  'housekeeping.view': 'ดูห้องแม่บ้าน',
  'housekeeping.assign': 'มอบหมายงานทำความสะอาด',
  'housekeeping.update_status': 'อัพเดทสถานะห้อง',
  'housekeeping.inspect': 'ตรวจรับห้อง',
  'maintenance.view': 'ดูงานซ่อม',
  'maintenance.create_ticket': 'แจ้งซ่อม',
  'maintenance.assign': 'มอบหมายงานซ่อม',
  'maintenance.close_ticket': 'ปิดงานซ่อม',
  'finance.view_reports': 'ดูรายงานการเงิน',
  'finance.post_invoice': 'ออก invoice',
  'finance.approve_refund': 'อนุมัติคืนเงิน',
  'finance.manage_fiscal_period': 'ปิดงวดบัญชี',
  'finance.export': 'ส่งออกข้อมูลการเงิน',
  'contracts.view': 'ดูสัญญา',
  'contracts.create': 'สร้างสัญญา',
  'contracts.sign': 'ลงนามสัญญา',
  'contracts.terminate': 'ยกเลิกสัญญาก่อนกำหนด',
  'contracts.renew': 'ต่อสัญญา',
  'contracts.bulk_renew': 'ต่อสัญญาเป็นกลุ่ม',
  'admin.manage_users': 'จัดการผู้ใช้',
  'admin.manage_roles': 'จัดการ role',
  'admin.manage_settings': 'แก้ไขตั้งค่าระบบ',
  'admin.force_close_shift': 'บังคับปิดกะของผู้อื่น',
};

export function PermissionMatrix({ role, value, onChange, readOnly }: Props) {
  const defaults = useMemo<Set<string>>(() => {
    const arr = ROLE_DEFAULTS[role as UserRoleName] ?? [];
    // admin = '*' wildcard — show all as "on, locked"
    return new Set(arr);
  }, [role]);
  const isWildcard = defaults.has('*');

  const addSet = useMemo(() => new Set(value.add), [value.add]);
  const removeSet = useMemo(() => new Set(value.remove), [value.remove]);

  /**
   * A permission is currently "on" if:
   *   - wildcard admin, OR
   *   - it's a role default AND not in remove, OR
   *   - it's NOT a role default but IS in add
   */
  function isChecked(perm: string): boolean {
    if (isWildcard) return true;
    const inDefault = defaults.has(perm);
    if (inDefault) return !removeSet.has(perm);
    return addSet.has(perm);
  }

  function toggle(perm: string) {
    if (readOnly || isWildcard) return;

    const inDefault = defaults.has(perm);
    const currentlyOn = isChecked(perm);

    const nextAdd = new Set(addSet);
    const nextRemove = new Set(removeSet);

    if (currentlyOn) {
      // Turning OFF
      if (inDefault) {
        nextRemove.add(perm);
      } else {
        nextAdd.delete(perm);
      }
    } else {
      // Turning ON
      if (inDefault) {
        nextRemove.delete(perm); // was removed by override — un-remove
      } else {
        nextAdd.add(perm);
      }
    }

    onChange({ add: [...nextAdd], remove: [...nextRemove] });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isWildcard && (
        <div
          style={{
            padding: '8px 12px',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            color: '#1d4ed8',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          ⭐ Role นี้ถือ <b>wildcard (*)</b> — มีสิทธิ์ทุกอย่างโดยอัตโนมัติ (admin); override ไม่มีผล
        </div>
      )}

      {(Object.keys(PERMISSION_CATALOG) as Array<keyof typeof PERMISSION_CATALOG>).map(
        (cat) => {
          const perms = PERMISSION_CATALOG[cat];
          if (perms.length === 0) return null;
          return (
            <div key={cat} style={{ border: '1px solid var(--border-light)', borderRadius: 8 }}>
              <div
                style={{
                  padding: '8px 12px',
                  background: 'var(--surface-subtle)',
                  fontWeight: 700,
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  borderBottom: '1px solid var(--border-light)',
                }}
              >
                {CATEGORY_LABELS[cat] ?? cat}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: 4,
                  padding: 8,
                }}
              >
                {perms.map((perm) => {
                  const checked = isChecked(perm);
                  const inDefault = defaults.has(perm);
                  const modified =
                    !isWildcard &&
                    ((inDefault && removeSet.has(perm)) ||
                      (!inDefault && addSet.has(perm)));
                  return (
                    <label
                      key={perm}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 8px',
                        borderRadius: 4,
                        cursor: readOnly || isWildcard ? 'default' : 'pointer',
                        background: modified ? '#fef3c7' : 'transparent',
                        fontSize: 12,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={readOnly || isWildcard}
                        onChange={() => toggle(perm)}
                        style={{ cursor: readOnly || isWildcard ? 'default' : 'pointer' }}
                      />
                      <span
                        style={{
                          color: checked
                            ? 'var(--text-primary)'
                            : 'var(--text-muted)',
                          textDecoration:
                            inDefault && removeSet.has(perm) ? 'line-through' : 'none',
                          flex: 1,
                        }}
                      >
                        {PERMISSION_LABELS[perm] ?? perm}
                      </span>
                      {inDefault && (
                        <span style={{ fontSize: 9, color: '#6b7280' }}>
                          default
                        </span>
                      )}
                      {!inDefault && addSet.has(perm) && (
                        <span style={{ fontSize: 9, color: '#1d4ed8', fontWeight: 700 }}>
                          +ADD
                        </span>
                      )}
                      {inDefault && removeSet.has(perm) && (
                        <span style={{ fontSize: 9, color: '#b91c1c', fontWeight: 700 }}>
                          −REMOVE
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        },
      )}
    </div>
  );
}
