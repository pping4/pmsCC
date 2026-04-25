/**
 * OTA Reconciliation — list statements + upload new one.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { fmtBaht, fmtDate, toDateStr } from '@/lib/date-format';

interface Agent { id: string; code: string; name: string; defaultCommissionPct: number }
interface StatementRow {
  id: string; periodStart: string; periodEnd: string;
  totalGross: string; totalCommission: string; netPayable: string;
  status: string; uploadedAt: string;
  agent: { id: string; code: string; name: string };
  _count: { lines: number };
}

export default function OtaReconciliationPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? '';
  const canWrite = ['admin', 'accountant'].includes(role);

  const [rows, setRows] = useState<StatementRow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [showUpload, setShowUpload] = useState(false);
  const today = toDateStr(new Date());
  const firstOfMonth = today.slice(0, 8) + '01';
  const [form, setForm] = useState({
    agentId: '', periodStart: firstOfMonth, periodEnd: today, csv: '',
  });
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [sRes, aRes] = await Promise.all([
        fetch('/api/ota/statements'),
        fetch('/api/ota/agents'),
      ]);
      if (!sRes.ok || !aRes.ok) throw new Error('โหลดไม่สำเร็จ');
      setRows(await sRes.json());
      const ags: Agent[] = await aRes.json();
      setAgents(ags);
      if (ags[0] && !form.agentId) setForm(f => ({ ...f, agentId: ags[0].id }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [form.agentId]);

  useEffect(() => { if (status === 'authenticated') load(); }, [status, load]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setForm(f => ({ ...f, csv: text }));
  }

  async function upload() {
    if (!form.agentId || !form.csv) { setUploadMsg('กรุณาเลือก OTA และไฟล์ CSV'); return; }
    setUploading(true); setUploadMsg(null);
    try {
      const res = await fetch('/api/ota/statements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
      setUploadMsg(`✅ อัปโหลดสำเร็จ: ${j.lineCount} รายการ (parse errors: ${j.parseErrors?.length ?? 0})`);
      setShowUpload(false);
      setForm(f => ({ ...f, csv: '' }));
      load();
    } catch (e) {
      setUploadMsg(`❌ ${e instanceof Error ? e.message : 'อัปโหลดไม่สำเร็จ'}`);
    } finally {
      setUploading(false);
    }
  }

  if (status === 'loading') return <div style={{ padding: 24 }}>กำลังโหลด…</div>;

  return (
    <div style={{ padding: 24 }}>
      <header style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>🌐 OTA Reconciliation</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
            อัปโหลดงบ commission จาก Agoda / Booking.com / Expedia และจับคู่กับ booking ภายใน
          </p>
        </div>
        {canWrite && (
          <button onClick={() => setShowUpload(true)} style={{ ...btnSx, background: '#2563eb', color: 'white', borderColor: '#1d4ed8' }}>
            ＋ อัปโหลดงบใหม่
          </button>
        )}
      </header>

      {err && <div className="pms-card" style={{ padding: 12, marginBottom: 12, background: '#fee2e2', color: '#991b1b' }}>{err}</div>}
      {uploadMsg && <div className="pms-card" style={{ padding: 12, marginBottom: 12 }}>{uploadMsg}</div>}

      {showUpload && (
        <div className="pms-card" style={{ padding: 16, marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>อัปโหลดงบใหม่</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <label style={lblSx}>
              <span>OTA</span>
              <select value={form.agentId} onChange={e => setForm(f => ({ ...f, agentId: e.target.value }))} style={inputSx}>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label style={lblSx}>
              <span>ตั้งแต่</span>
              <input type="date" value={form.periodStart} onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))} style={inputSx} />
            </label>
            <label style={lblSx}>
              <span>ถึง</span>
              <input type="date" value={form.periodEnd} onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))} style={inputSx} />
            </label>
            <label style={lblSx}>
              <span>ไฟล์ CSV</span>
              <input type="file" accept=".csv,text/csv" onChange={handleFileChange} style={inputSx} />
            </label>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            คอลัมน์ที่ต้องมี: booking_ref, guest_name, check_in, check_out, gross, commission
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowUpload(false)} style={{ ...btnSx, background: 'var(--surface-muted)' }}>ยกเลิก</button>
            <button onClick={upload} disabled={uploading} style={{ ...btnSx, background: '#2563eb', color: 'white', borderColor: '#1d4ed8' }}>
              {uploading ? 'กำลังอัปโหลด…' : 'อัปโหลด'}
            </button>
          </div>
        </div>
      )}

      <div className="pms-card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface-subtle)', textAlign: 'left' }}>
              <th style={thSx}>OTA</th>
              <th style={thSx}>ช่วงเวลา</th>
              <th style={{ ...thSx, textAlign: 'right' }}>รายการ</th>
              <th style={{ ...thSx, textAlign: 'right' }}>Gross</th>
              <th style={{ ...thSx, textAlign: 'right' }}>Commission</th>
              <th style={{ ...thSx, textAlign: 'right' }}>Net</th>
              <th style={thSx}>สถานะ</th>
              <th style={thSx}>อัปโหลด</th>
              <th style={thSx}></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center' }}>กำลังโหลด…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>ยังไม่มีข้อมูล</td></tr>}
            {rows.map((r, i) => (
              <tr key={r.id} style={{ background: i % 2 ? 'var(--surface-subtle)' : 'var(--surface-card)' }}>
                <td style={tdSx}>{r.agent.name}</td>
                <td style={tdSx}>{fmtDate(r.periodStart)} → {fmtDate(r.periodEnd)}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{r._count.lines}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(Number(r.totalGross))}</td>
                <td style={{ ...tdSx, textAlign: 'right', color: '#dc2626' }}>{fmtBaht(Number(r.totalCommission))}</td>
                <td style={{ ...tdSx, textAlign: 'right', fontWeight: 600 }}>{fmtBaht(Number(r.netPayable))}</td>
                <td style={tdSx}><StatusBadge status={r.status} /></td>
                <td style={tdSx}>{fmtDate(r.uploadedAt)}</td>
                <td style={tdSx}><Link href={`/ota-reconciliation/${r.id}`} style={{ color: '#2563eb' }}>ดูรายละเอียด →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string; text: string }> = {
    draft:      { bg: '#f3f4f6', fg: '#374151', text: 'ร่าง' },
    reconciled: { bg: '#dbeafe', fg: '#1e40af', text: 'จับคู่แล้ว' },
    posted:     { bg: '#dcfce7', fg: '#166534', text: 'โพสต์แล้ว' },
    void:       { bg: '#fee2e2', fg: '#991b1b', text: 'ยกเลิก' },
  };
  const c = colors[status] ?? colors.draft;
  return <span style={{ padding: '2px 8px', borderRadius: 10, background: c.bg, color: c.fg, fontSize: 11, fontWeight: 600 }}>{c.text}</span>;
}

const btnSx: React.CSSProperties = { padding: '8px 16px', border: '1px solid var(--border-default)', borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const inputSx: React.CSSProperties = { padding: '6px 10px', border: '1px solid var(--border-default)', borderRadius: 4, fontSize: 13, background: 'var(--surface-card)', color: 'var(--text-primary)' };
const lblSx: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-secondary)' };
const thSx: React.CSSProperties = { padding: '8px 10px', fontSize: 12, borderBottom: '1px solid var(--border-default)' };
const tdSx: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid var(--border-light)' };
