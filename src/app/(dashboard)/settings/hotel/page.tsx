/**
 * Hotel Settings — admin-only.
 *
 * Toggles VAT / service charge and stores hotel identity (name, address,
 * tax reg no) used on invoice headers + tax reports.
 *
 * Flipping vatEnabled affects NEW invoices only — existing invoices keep the
 * numbers that were booked when they were issued.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface HotelSettings {
  vatEnabled: boolean;
  vatRate: number;
  vatInclusive: boolean;
  vatRegistrationNo: string | null;
  serviceChargeEnabled: boolean;
  serviceChargeRate: number;
  hotelName: string | null;
  hotelAddress: string | null;
  hotelPhone: string | null;
  hotelEmail: string | null;
}

export default function HotelSettingsPage() {
  const { data: session, status: authStatus } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === 'admin';

  const [form, setForm] = useState<HotelSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/hotel');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setForm(j);
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'โหลดไม่สำเร็จ' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (authStatus === 'authenticated') load(); }, [authStatus, load]);

  async function save() {
    if (!form || !isAdmin) return;
    setSaving(true); setMsg(null);
    try {
      const res = await fetch('/api/settings/hotel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vatEnabled:           form.vatEnabled,
          vatRate:              Number(form.vatRate),
          vatInclusive:         form.vatInclusive,
          vatRegistrationNo:    form.vatRegistrationNo || null,
          serviceChargeEnabled: form.serviceChargeEnabled,
          serviceChargeRate:    Number(form.serviceChargeRate),
          hotelName:            form.hotelName || null,
          hotelAddress:         form.hotelAddress || null,
          hotelPhone:           form.hotelPhone || null,
          hotelEmail:           form.hotelEmail || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      setForm(j);
      setMsg({ kind: 'ok', text: 'บันทึกสำเร็จ' });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof HotelSettings>(key: K, value: HotelSettings[K]) {
    setForm(f => f ? { ...f, [key]: value } : f);
  }

  if (authStatus === 'loading' || loading || !form) {
    return <div style={{ padding: 24 }}>กำลังโหลด…</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 780, margin: '0 auto' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>⚙️ ตั้งค่าโรงแรม / VAT</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
          กำหนดภาษีมูลค่าเพิ่ม (VAT 7%) และค่าบริการ (Service Charge 10%) สำหรับใบเสร็จ — เปลี่ยนแล้วมีผลกับใบเสร็จใหม่เท่านั้น
        </p>
      </header>

      {!isAdmin && (
        <div className="pms-card" style={{ padding: 12, marginBottom: 12, background: '#fef3c7', color: '#92400e' }}>
          ⚠️ เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขได้ — คุณดูค่าปัจจุบันได้อย่างเดียว
        </div>
      )}

      {msg && (
        <div className="pms-card" style={{
          padding: 12, marginBottom: 12,
          background: msg.kind === 'ok' ? '#f0fdf4' : '#fee2e2',
          color:      msg.kind === 'ok' ? '#166534' : '#991b1b',
        }}>{msg.text}</div>
      )}

      {/* VAT */}
      <section className="pms-card pms-transition" style={{ padding: 16, marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>🧾 VAT / ภาษีมูลค่าเพิ่ม</h2>

        <label style={rowSx}>
          <input
            type="checkbox" checked={form.vatEnabled} disabled={!isAdmin}
            onChange={e => update('vatEnabled', e.target.checked)}
          />
          <span style={{ fontWeight: 500 }}>เปิดใช้งาน VAT</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            เมื่อเปิด: ใบเสร็จจะแยก VAT ในสมุดบัญชี (DR Revenue / CR VAT_OUTPUT)
          </span>
        </label>

        <div style={gridSx}>
          <Field label="อัตรา VAT (%)">
            <input type="number" min={0} max={30} step={0.01}
              disabled={!isAdmin || !form.vatEnabled}
              value={form.vatRate} onChange={e => update('vatRate', Number(e.target.value))}
              style={inputSx}
            />
          </Field>
          <Field label="เลขทะเบียนผู้เสียภาษี">
            <input type="text" maxLength={20}
              disabled={!isAdmin || !form.vatEnabled}
              value={form.vatRegistrationNo ?? ''}
              onChange={e => update('vatRegistrationNo', e.target.value || null)}
              placeholder="0-0000-00000-00-0"
              style={inputSx}
            />
          </Field>
        </div>

        <label style={{ ...rowSx, marginTop: 8 }}>
          <input
            type="checkbox" checked={form.vatInclusive} disabled={!isAdmin || !form.vatEnabled}
            onChange={e => update('vatInclusive', e.target.checked)}
          />
          <span style={{ fontSize: 13 }}>ราคาห้อง/สินค้าเป็นแบบรวม VAT แล้ว (inclusive)</span>
        </label>
      </section>

      {/* Service charge */}
      <section className="pms-card pms-transition" style={{ padding: 16, marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>🛎️ ค่าบริการ (Service Charge)</h2>
        <label style={rowSx}>
          <input
            type="checkbox" checked={form.serviceChargeEnabled} disabled={!isAdmin}
            onChange={e => update('serviceChargeEnabled', e.target.checked)}
          />
          <span style={{ fontWeight: 500 }}>เรียกเก็บค่าบริการ</span>
        </label>
        <div style={gridSx}>
          <Field label="อัตรา Service (%)">
            <input type="number" min={0} max={30} step={0.01}
              disabled={!isAdmin || !form.serviceChargeEnabled}
              value={form.serviceChargeRate} onChange={e => update('serviceChargeRate', Number(e.target.value))}
              style={inputSx}
            />
          </Field>
        </div>
      </section>

      {/* Identity */}
      <section className="pms-card pms-transition" style={{ padding: 16, marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>🏨 ข้อมูลโรงแรม (สำหรับใบเสร็จ)</h2>
        <div style={gridSx}>
          <Field label="ชื่อโรงแรม">
            <input type="text" maxLength={200} disabled={!isAdmin}
              value={form.hotelName ?? ''} onChange={e => update('hotelName', e.target.value || null)}
              style={inputSx}
            />
          </Field>
          <Field label="โทรศัพท์">
            <input type="text" maxLength={30} disabled={!isAdmin}
              value={form.hotelPhone ?? ''} onChange={e => update('hotelPhone', e.target.value || null)}
              style={inputSx}
            />
          </Field>
          <Field label="อีเมล">
            <input type="email" maxLength={200} disabled={!isAdmin}
              value={form.hotelEmail ?? ''} onChange={e => update('hotelEmail', e.target.value || null)}
              style={inputSx}
            />
          </Field>
          <Field label="ที่อยู่">
            <textarea maxLength={500} rows={2} disabled={!isAdmin}
              value={form.hotelAddress ?? ''} onChange={e => update('hotelAddress', e.target.value || null)}
              style={{ ...inputSx, resize: 'vertical' }}
            />
          </Field>
        </div>
      </section>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={load} disabled={saving || !isAdmin}
          style={{ ...btnSx, background: 'var(--surface-muted)' }}
        >รีเซ็ต</button>
        <button onClick={save} disabled={saving || !isAdmin}
          style={{ ...btnSx, background: '#2563eb', color: 'white', borderColor: '#1d4ed8' }}
        >{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </label>
  );
}

const rowSx: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
};
const gridSx: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 10, marginTop: 8,
};
const inputSx: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 13, background: 'var(--surface-card)', color: 'var(--text-primary)',
};
const btnSx: React.CSSProperties = {
  padding: '8px 16px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
