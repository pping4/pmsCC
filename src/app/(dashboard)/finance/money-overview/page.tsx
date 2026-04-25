/**
 * Money Overview — "ภาพรวมเงิน"
 *
 * Shows real-time balance of every CASH + BANK + CARD_CLEARING + UNDEPOSITED_FUNDS
 * account, grouped by type, with a running total. Answers the core question:
 * "ตอนนี้มีเงินอยู่ที่ไหนเท่าไหร่"
 *
 * All balances are ledger-derived (opening + Σ signed entries) so they are always
 * in sync with posted payments, refunds, and over/short auto-postings.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ui';
import { fmtBaht, fmtDateTime } from '@/lib/date-format';

type SubKind = 'CASH' | 'BANK' | 'CARD_CLEARING' | 'UNDEPOSITED_FUNDS';

interface Balance {
  accountId:      string;
  code:           string;
  name:           string;
  subKind:        SubKind;
  bankName:       string | null;
  bankAccountNo:  string | null;
  isDefault:      boolean;
  openingBalance: number;
  debitTotal:     number;
  creditTotal:    number;
  balance:        number;
  asOf:           string;
}

const GROUP_META: Record<SubKind, { label: string; icon: string; color: string; bg: string }> = {
  CASH:              { label: 'เงินสด / ลิ้นชัก',   icon: '💵', color: '#166534', bg: '#f0fdf4' },
  BANK:              { label: 'บัญชีธนาคาร',        icon: '🏦', color: '#1e40af', bg: '#eff6ff' },
  CARD_CLEARING:     { label: 'พักบัตรเครดิต',       icon: '💳', color: '#6b21a8', bg: '#faf5ff' },
  UNDEPOSITED_FUNDS: { label: 'เงินรอฝากธนาคาร',    icon: '⏳', color: '#92400e', bg: '#fef3c7' },
};

export default function MoneyOverviewPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const toast = useToast();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canTransfer = role === 'admin' || role === 'manager';

  const [balances, setBalances] = useState<Balance[]>([]);
  const [asOf,     setAsOf]     = useState<string>('');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  // Transfer modal state
  const [showTransfer, setShowTransfer] = useState(false);
  const [tForm, setTForm] = useState({ fromAccountId: '', toAccountId: '', amount: '', notes: '' });
  const [tSaving, setTSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/account-balances');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setBalances(json.balances ?? []);
      setAsOf(json.asOf);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (status === 'authenticated') load(); }, [status]);

  async function submitTransfer() {
    if (!tForm.fromAccountId || !tForm.toAccountId || !tForm.amount) return;
    if (tForm.fromAccountId === tForm.toAccountId) {
      toast.error('เลือกบัญชีต้นทาง/ปลายทางต่างกัน');
      return;
    }
    const amt = Number(tForm.amount);
    if (!(amt > 0)) { toast.error('จำนวนเงินต้องมากกว่า 0'); return; }

    setTSaving(true);
    try {
      const res = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromAccountId: tForm.fromAccountId,
          toAccountId:   tForm.toAccountId,
          amount:        amt,
          notes:         tForm.notes || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || j.error || 'โอนเงินไม่สำเร็จ');
      }
      toast.success('โอนเงินสำเร็จ');
      setShowTransfer(false);
      setTForm({ fromAccountId: '', toAccountId: '', amount: '', notes: '' });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'โอนเงินไม่สำเร็จ');
    } finally {
      setTSaving(false);
    }
  }

  if (status === 'loading' || loading) {
    return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>กำลังโหลด…</div>;
  }
  if (error) {
    return <div style={{ padding: 24, color: 'var(--danger)' }}>{error}</div>;
  }

  // Group by subKind
  const groups = (Object.keys(GROUP_META) as SubKind[]).map(sk => ({
    subKind: sk,
    items:   balances.filter(b => b.subKind === sk),
    total:   balances.filter(b => b.subKind === sk).reduce((s, b) => s + b.balance, 0),
  }));

  const grandTotal = balances.reduce((s, b) => s + b.balance, 0);

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>💰 ภาพรวมเงิน</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
            ยอดคงเหลือจริงของทุกบัญชีเงินสดและธนาคาร — อัปเดต {fmtDateTime(new Date(asOf))}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canTransfer && balances.length >= 2 && (
            <button onClick={() => setShowTransfer(true)} style={{ ...refreshBtnSx, background: 'var(--primary-light)', color: '#fff', borderColor: 'var(--primary-light)' }}>
              ↔ โอนเงินระหว่างบัญชี
            </button>
          )}
          <button onClick={load} style={refreshBtnSx}>🔄 รีเฟรช</button>
        </div>
      </header>

      {/* Grand total */}
      <div className="pms-card pms-transition" style={{
        padding: 20, marginBottom: 20,
        background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
        color: '#fff',
      }}>
        <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 4 }}>ยอดรวมทุกบัญชี</div>
        <div style={{ fontSize: 36, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          ฿{fmtBaht(grandTotal)}
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>
          จาก {balances.length} บัญชี
        </div>
      </div>

      {/* Groups */}
      {groups.filter(g => g.items.length > 0).map(g => {
        const meta = GROUP_META[g.subKind];
        return (
          <section key={g.subKind} className="pms-card pms-transition" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              padding: '6px 10px', marginBottom: 10, borderRadius: 4,
              background: meta.bg, color: meta.color,
            }}>
              <h2 style={{ fontSize: 14, fontWeight: 600 }}>
                {meta.icon} {meta.label} <span style={{ opacity: 0.7, fontWeight: 400 }}>({g.items.length})</span>
              </h2>
              <div style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                ฿{fmtBaht(g.total)}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {g.items.map(b => (
                <div
                  key={b.accountId}
                  style={{ ...cardSx, cursor: 'pointer' }}
                  onClick={() => router.push(`/finance/money-overview/${b.accountId}`)}
                  title="คลิกเพื่อดูรายการเคลื่อนไหว"
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{b.code}</div>
                      <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.name}
                      </div>
                      {b.bankName && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {b.bankName}{b.bankAccountNo ? ` • ${b.bankAccountNo}` : ''}
                        </div>
                      )}
                    </div>
                    {b.isDefault && <span style={defaultBadge}>DEFAULT</span>}
                  </div>
                  <div style={{
                    fontSize: 22, fontWeight: 700, marginTop: 10,
                    fontVariantNumeric: 'tabular-nums',
                    color: b.balance < 0 ? 'var(--danger)' : 'var(--text-primary)',
                  }}>
                    ฿{fmtBaht(b.balance)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 4 }}>
                    ยอดยกมา {fmtBaht(b.openingBalance)} • DR {fmtBaht(b.debitTotal)} • CR {fmtBaht(b.creditTotal)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {balances.length === 0 && (
        <div className="pms-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          ยังไม่มีบัญชีเงินสดหรือธนาคาร — ไปที่ <a href="/settings/accounts" style={{ color: 'var(--primary-light)' }}>ตั้งค่าบัญชี</a> เพื่อสร้าง
        </div>
      )}

      {showTransfer && (
        <div onClick={() => !tSaving && setShowTransfer(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div onClick={e => e.stopPropagation()} className="pms-card" style={{ padding: 20, width: 'min(520px, 92vw)' }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>↔ โอนเงินระหว่างบัญชี</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
              ระบบจะสร้างรายการบัญชีคู่ (DR ปลายทาง / CR ต้นทาง) ยอดคงเหลือของทั้งสองบัญชีจะอัปเดตทันที
              <br />หากต้นทางหรือปลายทางเป็น "เงินสด" ต้องมีกะเปิดอยู่
            </p>

            <div style={{ display: 'grid', gap: 10 }}>
              <label style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>จากบัญชี</span>
                <select value={tForm.fromAccountId} onChange={e => setTForm(f => ({ ...f, fromAccountId: e.target.value }))} style={selectSx}>
                  <option value="">— เลือกต้นทาง —</option>
                  {balances.map(b => (
                    <option key={b.accountId} value={b.accountId}>
                      {b.code} — {b.name} ({fmtBaht(b.balance)})
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>ไปยังบัญชี</span>
                <select value={tForm.toAccountId} onChange={e => setTForm(f => ({ ...f, toAccountId: e.target.value }))} style={selectSx}>
                  <option value="">— เลือกปลายทาง —</option>
                  {balances.filter(b => b.accountId !== tForm.fromAccountId).map(b => (
                    <option key={b.accountId} value={b.accountId}>
                      {b.code} — {b.name} ({fmtBaht(b.balance)})
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>จำนวนเงิน</span>
                <input
                  type="number" step="0.01" min="0"
                  value={tForm.amount}
                  onChange={e => setTForm(f => ({ ...f, amount: e.target.value }))}
                  style={selectSx}
                  placeholder="0.00"
                />
              </label>
              <label style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'start', gap: 10, fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)', paddingTop: 6 }}>หมายเหตุ</span>
                <textarea
                  value={tForm.notes}
                  onChange={e => setTForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  style={{ ...selectSx, resize: 'vertical' }}
                  placeholder="เช่น ฝากเงินลิ้นชักเข้าธนาคาร"
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setShowTransfer(false)} disabled={tSaving} style={refreshBtnSx}>ยกเลิก</button>
              <button
                onClick={submitTransfer}
                disabled={tSaving || !tForm.fromAccountId || !tForm.toAccountId || !tForm.amount}
                style={{ ...refreshBtnSx, background: 'var(--primary-light)', color: '#fff', borderColor: 'var(--primary-light)' }}
              >
                {tSaving ? 'กำลังโอน…' : 'ยืนยันโอน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const selectSx: React.CSSProperties = {
  padding: '6px 8px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 13, background: 'var(--surface-card)', color: 'var(--text-primary)', width: '100%',
};

// ── Styles ───────────────────────────────────────────────────────────────
const cardSx: React.CSSProperties = {
  padding: 12,
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  background: 'var(--surface-card)',
};
const refreshBtnSx: React.CSSProperties = {
  padding: '6px 12px',
  border: '1px solid var(--border-default)',
  borderRadius: 4,
  background: 'var(--surface-card)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontSize: 13,
};
const defaultBadge: React.CSSProperties = {
  display: 'inline-block', padding: '1px 6px', borderRadius: 3,
  fontSize: 10, background: '#f0fdf4', color: '#166534', fontWeight: 600,
  whiteSpace: 'nowrap',
};
