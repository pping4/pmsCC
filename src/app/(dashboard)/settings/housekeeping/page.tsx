'use client';

/**
 * /settings/housekeeping — housekeeping defaults
 *
 * Persists to HotelSettings (single-row). Uses the existing
 * PUT /api/settings/hotel endpoint (admin-only at the route level).
 */

import { useEffect, useState } from 'react';
import { useToast } from '@/components/ui';
import { fmtBaht } from '@/lib/date-format';

interface Settings {
  hkMonthlyFeeDefault: number;
  hkAdhocFeeDefault: number;
  hkMorningShiftStart: string;
  hkStaleDailyWarnDays: number;
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'var(--text-secondary)', marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px',
  border: '1px solid var(--border-default)',
  background: 'var(--surface-card)',
  color: 'var(--text-primary)',
  borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box',
};

export default function HousekeepingSettingsPage() {
  const toast = useToast();
  const [form, setForm] = useState<Settings>({
    hkMonthlyFeeDefault: 300,
    hkAdhocFeeDefault:   200,
    hkMorningShiftStart: '09:00',
    hkStaleDailyWarnDays: 3,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    fetch('/api/settings/hotel')
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => setForm({
        hkMonthlyFeeDefault: Number(d.hkMonthlyFeeDefault ?? 300),
        hkAdhocFeeDefault:   Number(d.hkAdhocFeeDefault   ?? 200),
        hkMorningShiftStart: d.hkMorningShiftStart ?? '09:00',
        hkStaleDailyWarnDays: Number(d.hkStaleDailyWarnDays ?? 3),
      }))
      .catch(e => toast.error('โหลดการตั้งค่าไม่สำเร็จ', String(e)))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/hotel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      toast.success('บันทึกการตั้งค่าแม่บ้านสำเร็จ');
    } catch (e) {
      toast.error('บันทึกไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-faint)' }}>กำลังโหลด...</div>;
  }

  return (
    <div style={{ maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>
          ตั้งค่าระบบแม่บ้าน
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
          ค่าเริ่มต้นสำหรับ Dialog ขอทำความสะอาด + Night audit
        </p>
      </div>

      <div className="pms-card pms-transition" style={{ padding: 24, borderRadius: 12, border: '1px solid var(--border-default)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>ค่าทำความสะอาดรายเดือน default (฿)</label>
            <input
              type="number" min={0} step={10}
              value={form.hkMonthlyFeeDefault}
              onChange={e => setForm(p => ({ ...p, hkMonthlyFeeDefault: Number(e.target.value) }))}
              style={inputStyle}
            />
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
              ใช้เมื่อกด "+ ตั้งรอบประจำ" สำหรับแขกจองรายเดือน ({fmtBaht(form.hkMonthlyFeeDefault)} บาท)
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>ค่าทำความสะอาด ad-hoc default (฿)</label>
            <input
              type="number" min={0} step={10}
              value={form.hkAdhocFeeDefault}
              onChange={e => setForm(p => ({ ...p, hkAdhocFeeDefault: Number(e.target.value) }))}
              style={inputStyle}
            />
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
              ใช้กับ "+ แจ้งแม่บ้าน / ขอพิเศษ" ({fmtBaht(form.hkAdhocFeeDefault)} บาท)
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>เวลาเริ่มงานแม่บ้าน</label>
            <input
              type="time"
              value={form.hkMorningShiftStart}
              onChange={e => setForm(p => ({ ...p, hkMorningShiftStart: e.target.value }))}
              style={inputStyle}
            />
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
              เวลาเริ่มกะเช้าของทีมแม่บ้าน
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>แจ้งเตือนห้องค้างเกิน (วัน)</label>
            <input
              type="number" min={1} max={30}
              value={form.hkStaleDailyWarnDays}
              onChange={e => setForm(p => ({ ...p, hkStaleDailyWarnDays: Number(e.target.value) }))}
              style={inputStyle}
            />
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
              Night audit จะ warn เมื่อรายเดือนไม่ได้ทำความสะอาดเกิน N วัน
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: '10px 22px', background: '#1e40af', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}
