/**
 * OTA Statement Detail — match lines to bookings, then post to ledger.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { fmtBaht, fmtDate } from '@/lib/date-format';

interface Line {
  id: string; otaBookingRef: string; guestName: string;
  checkIn: string; checkOut: string; roomNights: number;
  grossAmount: string; commissionAmount: string; netAmount: string;
  matchedBookingId: string | null; matchStatus: string;
  booking: { id: string; bookingNumber: string } | null;
}
interface Statement {
  id: string; periodStart: string; periodEnd: string;
  totalGross: string; totalCommission: string; netPayable: string;
  status: string; uploadedAt: string;
  agent: { code: string; name: string };
  lines: Line[];
}

export default function StatementDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const { data: session, status: authStatus } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? '';
  const canWrite = ['admin', 'accountant'].includes(role);

  const [stmt, setStmt] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/ota/statements/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStmt(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { if (authStatus === 'authenticated') load(); }, [authStatus, load]);

  async function rematch(lineId: string, bookingNumber: string) {
    if (!bookingNumber) return;
    const bookRes = await fetch(`/api/bookings/search?q=${encodeURIComponent(bookingNumber)}`);
    let bookingId: string | null = null;
    if (bookRes.ok) {
      const results = await bookRes.json();
      bookingId = results[0]?.id ?? null;
    }
    if (!bookingId) {
      // fallback: treat input as UUID
      bookingId = bookingNumber.length === 36 ? bookingNumber : null;
    }
    if (!bookingId) { setMsg('❌ ไม่พบ booking ตามเลขที่ระบุ'); return; }
    await doMatch(lineId, bookingId);
  }

  async function doMatch(lineId: string, bookingId: string | null) {
    const res = await fetch(`/api/ota/statements/${id}/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineId, bookingId }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setMsg(`❌ ${j.message ?? j.error ?? 'จับคู่ไม่สำเร็จ'}`); return; }
    setMsg(bookingId ? '✅ จับคู่สำเร็จ' : '✅ ยกเลิกการจับคู่');
    load();
  }

  async function postToLedger() {
    if (!confirm('ยืนยันโพสต์งบนี้เข้าสมุดบัญชี? การกระทำนี้ย้อนกลับไม่ได้')) return;
    const res = await fetch(`/api/ota/statements/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'post' }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(`❌ ${j.message ?? j.error ?? 'โพสต์ไม่สำเร็จ'}`); return; }
    setMsg('✅ โพสต์เข้าสมุดบัญชีสำเร็จ');
    load();
  }

  if (authStatus === 'loading' || loading || !stmt) return <div style={{ padding: 24 }}>กำลังโหลด…</div>;

  const unmatchedCount = stmt.lines.filter(l => l.matchStatus === 'unmatched').length;
  const canPost = canWrite && stmt.status !== 'posted' && stmt.status !== 'void' && unmatchedCount === 0;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/ota-reconciliation" style={{ color: '#2563eb', fontSize: 13 }}>← กลับ</Link>
      </div>
      <header style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>{stmt.agent.name}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {fmtDate(stmt.periodStart)} → {fmtDate(stmt.periodEnd)} • {stmt.lines.length} รายการ
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>สถานะ: <b>{stmt.status}</b></span>
          {canPost && (
            <button onClick={postToLedger} style={{ ...btnSx, background: '#16a34a', color: 'white', borderColor: '#15803d' }}>
              โพสต์เข้าสมุดบัญชี
            </button>
          )}
        </div>
      </header>

      {err && <div className="pms-card" style={{ padding: 12, marginBottom: 12, background: '#fee2e2', color: '#991b1b' }}>{err}</div>}
      {msg && <div className="pms-card" style={{ padding: 12, marginBottom: 12 }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
        <Kpi label="Gross"      value={Number(stmt.totalGross)} />
        <Kpi label="Commission" value={Number(stmt.totalCommission)} accent="#dc2626" />
        <Kpi label="Net Payable" value={Number(stmt.netPayable)} accent="#16a34a" />
        <Kpi label="ไม่จับคู่"    value={unmatchedCount} raw accent={unmatchedCount > 0 ? '#dc2626' : '#16a34a'} />
      </div>

      <div className="pms-card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface-subtle)', textAlign: 'left' }}>
              <th style={thSx}>OTA Ref</th>
              <th style={thSx}>ลูกค้า</th>
              <th style={thSx}>เข้า-ออก</th>
              <th style={{ ...thSx, textAlign: 'right' }}>Gross</th>
              <th style={{ ...thSx, textAlign: 'right' }}>Commission</th>
              <th style={{ ...thSx, textAlign: 'right' }}>Net</th>
              <th style={thSx}>จับคู่</th>
              <th style={thSx}></th>
            </tr>
          </thead>
          <tbody>
            {stmt.lines.map((l, i) => (
              <tr key={l.id} style={{ background: i % 2 ? 'var(--surface-subtle)' : 'var(--surface-card)' }}>
                <td style={tdSx}>{l.otaBookingRef}</td>
                <td style={tdSx}>{l.guestName}</td>
                <td style={tdSx}>{fmtDate(l.checkIn)} → {fmtDate(l.checkOut)}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(Number(l.grossAmount))}</td>
                <td style={{ ...tdSx, textAlign: 'right', color: '#dc2626' }}>{fmtBaht(Number(l.commissionAmount))}</td>
                <td style={{ ...tdSx, textAlign: 'right' }}>{fmtBaht(Number(l.netAmount))}</td>
                <td style={tdSx}>
                  <MatchBadge status={l.matchStatus} />
                  {l.booking && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{l.booking.bookingNumber}</div>}
                </td>
                <td style={tdSx}>
                  {canWrite && stmt.status !== 'posted' && (
                    l.matchedBookingId
                      ? <button onClick={() => doMatch(l.id, null)} style={{ ...btnSmSx }}>ยกเลิกจับคู่</button>
                      : <MatchInput onSubmit={(val) => rematch(l.id, val)} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatchInput({ onSubmit }: { onSubmit: (val: string) => void }) {
  const [val, setVal] = useState('');
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <input value={val} onChange={e => setVal(e.target.value)}
        placeholder="BK-xxxx หรือ UUID"
        style={{ ...inputSmSx, width: 140 }}
        onKeyDown={e => { if (e.key === 'Enter' && val) { onSubmit(val); setVal(''); } }}
      />
      <button onClick={() => { if (val) { onSubmit(val); setVal(''); } }} style={btnSmSx}>จับคู่</button>
    </div>
  );
}

function MatchBadge({ status }: { status: string }) {
  const m: Record<string, { bg: string; fg: string; text: string }> = {
    unmatched:       { bg: '#fee2e2', fg: '#991b1b', text: 'ไม่จับคู่' },
    auto_matched:    { bg: '#dcfce7', fg: '#166534', text: 'auto' },
    manual_matched:  { bg: '#dbeafe', fg: '#1e40af', text: 'manual' },
    disputed:        { bg: '#fef3c7', fg: '#92400e', text: 'โต้แย้ง' },
  };
  const c = m[status] ?? m.unmatched;
  return <span style={{ padding: '2px 8px', borderRadius: 10, background: c.bg, color: c.fg, fontSize: 11, fontWeight: 600 }}>{c.text}</span>;
}

function Kpi({ label, value, accent, raw }: { label: string; value: number; accent?: string; raw?: boolean }) {
  return (
    <div className="pms-card" style={{ padding: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent ?? 'var(--text-primary)', marginTop: 4 }}>
        {raw ? value : fmtBaht(value)}
      </div>
    </div>
  );
}

const btnSx: React.CSSProperties = { padding: '8px 16px', border: '1px solid var(--border-default)', borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnSmSx: React.CSSProperties = { padding: '4px 10px', border: '1px solid var(--border-default)', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: 'var(--surface-muted)' };
const inputSmSx: React.CSSProperties = { padding: '4px 8px', border: '1px solid var(--border-default)', borderRadius: 4, fontSize: 12, background: 'var(--surface-card)', color: 'var(--text-primary)' };
const thSx: React.CSSProperties = { padding: '8px 10px', fontSize: 12, borderBottom: '1px solid var(--border-default)' };
const tdSx: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid var(--border-light)' };
