/**
 * /settings/roles — Roles reference page (read-only for now).
 *
 * Sprint 4A / A-T8.
 *
 * This page documents the 8 built-in roles and the permissions granted by
 * default to each one. It is **read-only** — custom roles / role editing are
 * out of scope for Phase I (listed in §G of the plan as future work).
 *
 * Purpose:
 *   - Help admins pick the right role when creating a user
 *   - Show the baseline that `permissionOverrides` layers on top of
 *   - Keep ROLE_DEFAULTS as a single source of truth (imported directly
 *     from the lib so there's no drift between UI and resolver)
 */

'use client';

import { useMemo } from 'react';
import type { UserRole } from '@prisma/client';
import {
  PERMISSION_CATALOG,
  ROLE_DEFAULTS,
  type UserRoleName,
} from '@/lib/rbac/permissions';

const ROLES: Array<{
  key: UserRole;
  label: string;
  description: string;
  bg: string;
  fg: string;
}> = [
  {
    key: 'admin',
    label: 'Admin',
    description: 'ผู้ดูแลระบบ — มีสิทธิ์ทุกอย่าง (wildcard *)',
    bg: '#fee2e2',
    fg: '#b91c1c',
  },
  {
    key: 'manager',
    label: 'Manager',
    description: 'ผู้จัดการ — ดูแลการดำเนินงานประจำวัน ยกเว้นการจัดการผู้ใช้',
    bg: '#fef3c7',
    fg: '#b45309',
  },
  {
    key: 'cashier',
    label: 'Cashier',
    description: 'แคชเชียร์ — เปิด/ปิดกะ รับชำระ คืนเงิน ดูรายงานการเงิน',
    bg: '#dcfce7',
    fg: '#15803d',
  },
  {
    key: 'front',
    label: 'Front',
    description: 'พนักงานต้อนรับ — จัดการการจอง check-in/out เปลี่ยนห้อง',
    bg: '#dbeafe',
    fg: '#1d4ed8',
  },
  {
    key: 'housekeeping',
    label: 'Housekeeping',
    description: 'แม่บ้าน — ดูสถานะห้อง อัพเดท รับมอบหมาย แจ้งซ่อมได้',
    bg: '#ede9fe',
    fg: '#6d28d9',
  },
  {
    key: 'maintenance',
    label: 'Maintenance',
    description: 'ช่าง — รับงานซ่อม มอบหมาย ปิดงาน',
    bg: '#ffedd5',
    fg: '#c2410c',
  },
  {
    key: 'staff',
    label: 'Staff (legacy)',
    description: 'เทียบเท่า Front — คงไว้เพื่อ compatibility กับผู้ใช้เดิม',
    bg: '#f3f4f6',
    fg: '#4b5563',
  },
  {
    key: 'customer',
    label: 'Customer',
    description: 'ลูกค้า — ไม่มีสิทธิ์เข้า admin portal (reserved สำหรับ Phase II)',
    bg: '#f3e8ff',
    fg: '#7e22ce',
  },
];

const ALL_PERMISSIONS = Object.values(PERMISSION_CATALOG).flat();

const PERMISSION_LABELS: Record<string, string> = {
  'reservation.view': 'ดูรายการจอง',
  'reservation.create': 'สร้างการจอง',
  'reservation.edit': 'แก้ไขการจอง',
  'reservation.cancel': 'ยกเลิกการจอง',
  'reservation.checkin': 'Check-in',
  'reservation.checkout': 'Check-out',
  'reservation.change_room': 'เปลี่ยนห้อง',
  'reservation.waive_fee': 'ยกเว้นค่าธรรมเนียม',
  'cashier.open_shift': 'เปิดกะ',
  'cashier.close_shift': 'ปิดกะ',
  'cashier.record_payment': 'รับชำระ',
  'cashier.refund': 'คืนเงิน',
  'cashier.handover': 'ส่งกะ',
  'cashier.view_other_shifts': 'ดูกะของคนอื่น',
  'housekeeping.view': 'ดูห้องแม่บ้าน',
  'housekeeping.assign': 'มอบหมายทำความสะอาด',
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
  'finance.export': 'Export การเงิน',
  'contracts.view': 'ดูสัญญา',
  'contracts.create': 'สร้างสัญญา',
  'contracts.sign': 'ลงนามสัญญา',
  'contracts.terminate': 'ยกเลิกก่อนกำหนด',
  'contracts.renew': 'ต่อสัญญา',
  'contracts.bulk_renew': 'ต่อสัญญากลุ่ม',
  'admin.manage_users': 'จัดการผู้ใช้',
  'admin.manage_roles': 'จัดการ role',
  'admin.manage_settings': 'แก้ไขตั้งค่าระบบ',
  'admin.force_close_shift': 'บังคับปิดกะของผู้อื่น',
};

export default function RolesPage() {
  const roleDefaults = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const r of ROLES) {
      const arr = ROLE_DEFAULTS[r.key as UserRoleName] ?? [];
      map[r.key] = new Set(arr);
    }
    return map;
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>
          Role reference
        </h1>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          สิทธิ์เริ่มต้นของแต่ละ role — ใช้เป็นอ้างอิงตอนสร้างผู้ใช้หรือตรวจสอบ
          permission. ปรับ add / remove ต่อ user ได้ในหน้า{' '}
          <a href="/settings/users" style={{ color: '#1d4ed8' }}>จัดการผู้ใช้</a>.
        </div>
      </div>

      {/* Role summary cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        {ROLES.map((r) => {
          const perms = roleDefaults[r.key];
          const count = perms.has('*') ? '∞ (ทุกอย่าง)' : `${perms.size} สิทธิ์`;
          return (
            <div
              key={r.key}
              className="pms-card pms-transition"
              style={{
                padding: 14,
                border: '1px solid var(--border-default)',
                borderRadius: 10,
              }}
            >
              <div
                style={{
                  display: 'inline-block',
                  padding: '2px 10px',
                  borderRadius: 10,
                  background: r.bg,
                  color: r.fg,
                  fontSize: 11,
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                {r.label}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                {r.description}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                {count}
              </div>
            </div>
          );
        })}
      </div>

      {/* Matrix */}
      <div
        className="pms-card pms-transition"
        style={{
          border: '1px solid var(--border-default)',
          borderRadius: 10,
          overflow: 'auto',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 12,
            minWidth: 960,
          }}
        >
          <thead>
            <tr style={{ background: 'var(--surface-subtle)' }}>
              <th
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  position: 'sticky',
                  left: 0,
                  background: 'var(--surface-subtle)',
                  borderBottom: '1px solid var(--border-default)',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                  minWidth: 240,
                }}
              >
                Permission
              </th>
              {ROLES.map((r) => (
                <th
                  key={r.key}
                  style={{
                    padding: '10px 8px',
                    textAlign: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    color: r.fg,
                    background: r.bg,
                    borderBottom: '1px solid var(--border-default)',
                    minWidth: 80,
                  }}
                >
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(Object.keys(PERMISSION_CATALOG) as Array<keyof typeof PERMISSION_CATALOG>).map(
              (cat) => {
                const perms = PERMISSION_CATALOG[cat];
                if (perms.length === 0) return null;
                return (
                  <>
                    <tr key={`cat-${cat}`}>
                      <td
                        colSpan={1 + ROLES.length}
                        style={{
                          padding: '8px 12px',
                          fontWeight: 700,
                          fontSize: 11,
                          color: 'var(--text-secondary)',
                          background: 'var(--surface-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: 0.3,
                        }}
                      >
                        {cat}
                      </td>
                    </tr>
                    {perms.map((p) => (
                      <tr key={p}>
                        <td
                          style={{
                            padding: '8px 12px',
                            position: 'sticky',
                            left: 0,
                            background: 'var(--surface-card)',
                            borderBottom: '1px solid var(--border-light)',
                            color: 'var(--text-primary)',
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>{PERMISSION_LABELS[p] ?? p}</div>
                          <div
                            style={{
                              fontFamily: 'monospace',
                              fontSize: 10,
                              color: 'var(--text-muted)',
                            }}
                          >
                            {p}
                          </div>
                        </td>
                        {ROLES.map((r) => {
                          const has = roleDefaults[r.key].has('*') || roleDefaults[r.key].has(p);
                          return (
                            <td
                              key={r.key}
                              style={{
                                textAlign: 'center',
                                padding: '8px 4px',
                                borderBottom: '1px solid var(--border-light)',
                                color: has ? '#15803d' : 'var(--text-faint)',
                                fontSize: 14,
                              }}
                            >
                              {has ? '✓' : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </>
                );
              },
            )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          marginTop: 16,
          padding: 12,
          border: '1px dashed var(--border-default)',
          borderRadius: 8,
          fontSize: 12,
          color: 'var(--text-muted)',
          background: 'var(--surface-muted)',
        }}
      >
        💡 <b>หมายเหตุ:</b> หน้านี้เป็น <i>read-only reference</i>. การสร้าง role แบบกำหนดเอง
        (custom role) อยู่ใน out-of-scope ของ Phase I. ถ้าผู้ใช้แต่ละคนต้องการสิทธิ์ต่างจาก
        default ให้ใช้ช่อง <b>Permission overrides</b> ในหน้าจัดการผู้ใช้แทน.
      </div>
    </div>
  );
}
