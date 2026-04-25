/**
 * Financial Accounts & Cash Drawers — admin settings page.
 *
 * Lists all FinancialAccount rows and CashBox rows, with create / edit / deactivate.
 * System accounts (isSystem=true) allow cosmetic edits but not deactivation or delete.
 * Cash drawers with an OPEN session cannot be deactivated.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ui';
import { fmtBaht, fmtDateTime } from '@/lib/date-format';

type AccountKind    = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
type AccountSubKind =
  | 'CASH' | 'BANK' | 'UNDEPOSITED_FUNDS' | 'CARD_CLEARING'
  | 'AR' | 'AR_CORPORATE'
  | 'DEPOSIT_LIABILITY' | 'AGENT_PAYABLE'
  | 'VAT_OUTPUT' | 'VAT_INPUT' | 'SERVICE_CHARGE_PAYABLE'
  | 'ROOM_REVENUE' | 'FB_REVENUE' | 'PENALTY_REVENUE' | 'OTHER_REVENUE'
  | 'DISCOUNT_GIVEN' | 'CARD_FEE' | 'BANK_FEE' | 'CASH_OVER_SHORT' | 'OTHER_EXPENSE'
  | 'EQUITY_OPENING';

interface FinancialAccount {
  id: string;
  code: string;
  name: string;
  nameEN: string | null;
  kind: AccountKind;
  subKind: AccountSubKind;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  openingBalance: number;
  isActive: boolean;
  isSystem: boolean;
  isDefault: boolean;
  description: string | null;
  _count: {
    ledgerEntries: number;
    payments:      number;
    paymentFees:   number;
    refunds:       number;
    cashBoxes:     number;
  };
}

interface CashBoxActiveSession {
  id:             string;
  openedByName:   string | null;
  openedAt:       string;
  openingBalance: number;
}

interface CashBox {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  notes: string | null;
  financialAccount: { id: string; code: string; name: string };
  _count: { sessions: number };
  activeSession: CashBoxActiveSession | null;
}

const KIND_LABEL: Record<AccountKind, string> = {
  ASSET: 'สินทรัพย์', LIABILITY: 'หนี้สิน', EQUITY: 'ส่วนของเจ้าของ',
  REVENUE: 'รายได้', EXPENSE: 'ค่าใช้จ่าย',
};

const SUBKIND_LABEL: Record<AccountSubKind, string> = {
  CASH: 'เงินสด', BANK: 'ธนาคาร',
  UNDEPOSITED_FUNDS: 'เงินรอฝาก', CARD_CLEARING: 'พักบัตร',
  AR: 'ลูกหนี้', AR_CORPORATE: 'ลูกหนี้องค์กร',
  DEPOSIT_LIABILITY: 'เงินมัดจำรับล่วงหน้า', AGENT_PAYABLE: 'เจ้าหนี้เอเยนต์',
  VAT_OUTPUT: 'VAT ขาย', VAT_INPUT: 'VAT ซื้อ',
  SERVICE_CHARGE_PAYABLE: 'Service Charge ค้างจ่าย',
  ROOM_REVENUE: 'รายได้ห้องพัก', FB_REVENUE: 'รายได้อาหาร/เครื่องดื่ม',
  PENALTY_REVENUE: 'รายได้ค่าปรับ', OTHER_REVENUE: 'รายได้อื่น',
  DISCOUNT_GIVEN: 'ส่วนลดจ่าย', CARD_FEE: 'ค่าธรรมเนียมบัตร',
  BANK_FEE: 'ค่าธรรมเนียมธนาคาร', CASH_OVER_SHORT: 'เงินขาด/เกิน',
  OTHER_EXPENSE: 'ค่าใช้จ่ายอื่น', EQUITY_OPENING: 'ยอดยกมา',
};

const SUB_BY_KIND: Record<AccountKind, AccountSubKind[]> = {
  ASSET:     ['CASH','BANK','UNDEPOSITED_FUNDS','CARD_CLEARING','AR','AR_CORPORATE','VAT_INPUT'],
  LIABILITY: ['DEPOSIT_LIABILITY','AGENT_PAYABLE','VAT_OUTPUT','SERVICE_CHARGE_PAYABLE'],
  EQUITY:    ['EQUITY_OPENING'],
  REVENUE:   ['ROOM_REVENUE','FB_REVENUE','PENALTY_REVENUE','OTHER_REVENUE'],
  EXPENSE:   ['DISCOUNT_GIVEN','CARD_FEE','BANK_FEE','CASH_OVER_SHORT','OTHER_EXPENSE'],
};

export default function AccountsSettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const toast = useToast();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === 'admin';

  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [boxes,    setBoxes]    = useState<CashBox[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [tab, setTab] = useState<'accounts' | 'boxes'>('accounts');

  // Filters for account list
  const [fKind, setFKind] = useState<AccountKind | ''>('');
  const [fActive, setFActive] = useState<'all' | 'active' | 'inactive'>('all');
  // Default view shows only money accounts (CASH + BANK + CARD_CLEARING).
  // Technical accounts (VAT, Deposit, Revenue, Expense, …) are posted automatically by
  // the system and rarely need editing — hide them behind an "Advanced" toggle.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const MONEY_SUBKINDS: AccountSubKind[] = ['CASH', 'BANK', 'CARD_CLEARING', 'UNDEPOSITED_FUNDS'];

  // Account form modal
  const [showAccModal, setShowAccModal] = useState(false);
  const [editAcc, setEditAcc] = useState<FinancialAccount | null>(null);
  const emptyAcc = {
    code: '', name: '', nameEN: '',
    kind:    'ASSET' as AccountKind,
    subKind: SUB_BY_KIND['ASSET'][0] as AccountSubKind,  // Bug1 fix: default = first of ASSET = 'CASH'
    bankName: '', bankAccountNo: '', bankAccountName: '',
    openingBalance: 0,
    isDefault: false, isActive: true,
    description: '',
  };
  const [accForm, setAccForm] = useState(emptyAcc);
  const [accSaving, setAccSaving] = useState(false);

  // Cash box form modal
  const [showBoxModal, setShowBoxModal] = useState(false);
  const [editBox, setEditBox] = useState<CashBox | null>(null);
  const emptyBox = { code: '', name: '', financialAccountId: '', notes: '', isActive: true };
  const [boxForm, setBoxForm] = useState(emptyBox);
  const [boxSaving, setBoxSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, bRes] = await Promise.all([
        fetch('/api/financial-accounts'),
        fetch('/api/cash-boxes'),
      ]);
      if (aRes.ok) setAccounts((await aRes.json()).accounts ?? []);
      if (bRes.ok) setBoxes((await bRes.json()).boxes ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (status === 'authenticated') load(); }, [status, load]);

  // ── Account actions ──────────────────────────────────────────────────────
  function openNewAccount() {
    setEditAcc(null);
    setAccForm(emptyAcc);
    setShowAccModal(true);
  }
  function openEditAccount(a: FinancialAccount) {
    setEditAcc(a);
    setAccForm({
      code: a.code, name: a.name, nameEN: a.nameEN ?? '',
      kind: a.kind, subKind: a.subKind,
      bankName: a.bankName ?? '', bankAccountNo: a.bankAccountNo ?? '', bankAccountName: a.bankAccountName ?? '',
      openingBalance: a.openingBalance,
      isDefault: a.isDefault, isActive: a.isActive,
      description: a.description ?? '',
    });
    setShowAccModal(true);
  }

  async function submitAccount() {
    setAccSaving(true);
    try {
      const payload = { ...accForm };
      const res = editAcc
        ? await fetch(`/api/financial-accounts/${editAcc.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: payload.name,
              nameEN: payload.nameEN || null,
              // Bug2 fix: send subKind only when it changed (server guards with hasRefs check)
              ...(payload.subKind !== editAcc.subKind ? { subKind: payload.subKind } : {}),
              bankName: payload.bankName || null,
              bankAccountNo: payload.bankAccountNo || null,
              bankAccountName: payload.bankAccountName || null,
              isActive: payload.isActive,
              isDefault: payload.isDefault,
              description: payload.description || null,
            }),
          })
        : await fetch('/api/financial-accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || j.error || 'บันทึกไม่สำเร็จ');
      }
      toast.success(editAcc ? 'อัปเดตบัญชีแล้ว' : 'สร้างบัญชีแล้ว');
      setShowAccModal(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setAccSaving(false);
    }
  }

  async function deactivateAccount(a: FinancialAccount) {
    if (!confirm(`ลบ/ปิดใช้งานบัญชี "${a.code} — ${a.name}" ?\n\n• หากยังไม่เคยใช้ → ลบถาวร\n• หากเคยใช้แล้ว → ปิดใช้งาน (เพื่อรักษาประวัติบัญชี)`)) return;
    const res = await fetch(`/api/financial-accounts/${a.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.message || j.error || 'ลบไม่สำเร็จ');
      return;
    }
    const j = await res.json().catch(() => ({}));
    toast.success(j.mode === 'hard' ? 'ลบบัญชีถาวรแล้ว' : 'ปิดใช้งานแล้ว (มีประวัติอ้างอิง)');
    await load();
  }

  // ── Cash box actions ─────────────────────────────────────────────────────
  function openNewBox() {
    setEditBox(null);
    setBoxForm(emptyBox);
    setShowBoxModal(true);
  }
  function openEditBox(b: CashBox) {
    setEditBox(b);
    setBoxForm({
      code: b.code, name: b.name,
      financialAccountId: b.financialAccount.id,
      notes: b.notes ?? '',
      isActive: b.isActive,
    });
    setShowBoxModal(true);
  }

  async function submitBox() {
    setBoxSaving(true);
    try {
      const res = editBox
        ? await fetch(`/api/cash-boxes/${editBox.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: boxForm.name,
              notes: boxForm.notes || null,
              isActive: boxForm.isActive,
              financialAccountId: boxForm.financialAccountId,
            }),
          })
        : await fetch('/api/cash-boxes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: boxForm.code,
              name: boxForm.name,
              financialAccountId: boxForm.financialAccountId,
              notes: boxForm.notes || undefined,
            }),
          });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || j.error || 'บันทึกไม่สำเร็จ');
      }
      toast.success(editBox ? 'อัปเดตลิ้นชักแล้ว' : 'สร้างลิ้นชักแล้ว');
      setShowBoxModal(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBoxSaving(false);
    }
  }

  async function deactivateBox(b: CashBox) {
    // Client-side gate: if we already know a session is OPEN, surface the
    // precise Thai message before the round-trip. Server still enforces.
    if (b.activeSession) {
      toast.error(
        `ลิ้นชักนี้มีกะเปิดอยู่ (${b.activeSession.openedByName ?? '—'}) — ปิดกะก่อนจึงจะปิดลิ้นชักได้`,
      );
      return;
    }
    if (!confirm(`ปิดใช้งานลิ้นชัก "${b.code} — ${b.name}" ?`)) return;
    const res = await fetch(`/api/cash-boxes/${b.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.message || j.error || 'ปิดใช้งานไม่สำเร็จ');
      return;
    }
    toast.success('ปิดใช้งานแล้ว');
    await load();
  }

  if (status === 'loading') return <div style={{ padding: 24 }}>กำลังโหลด…</div>;
  if (!isAdmin) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>บัญชีการเงิน</h1>
        <p style={{ color: 'var(--text-secondary)' }}>เฉพาะผู้ดูแลระบบ (admin) เท่านั้น</p>
      </div>
    );
  }

  // Filtered account list
  const cashAccounts = accounts.filter(a => a.subKind === 'CASH' && a.isActive);
  const visibleAccounts = accounts.filter(a => {
    if (!showAdvanced && !MONEY_SUBKINDS.includes(a.subKind)) return false;
    if (fKind && a.kind !== fKind) return false;
    if (fActive === 'active' && !a.isActive) return false;
    if (fActive === 'inactive' && a.isActive) return false;
    return true;
  });
  const hiddenSystemCount = accounts.filter(a => !MONEY_SUBKINDS.includes(a.subKind)).length;

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>🏦 บัญชีการเงิน / ลิ้นชัก</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
          ตั้งค่าผังบัญชี (Chart of Accounts) และลิ้นชักเงินสด — ผู้ดูแลระบบเท่านั้น
        </p>
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-default)', marginBottom: 16 }}>
        {[
          { k: 'accounts', label: `บัญชีการเงิน (${accounts.length})` },
          { k: 'boxes',    label: `ลิ้นชักเงินสด (${boxes.length})` },
        ].map(t => (
          <button
            key={t.k}
            onClick={() => setTab(t.k as 'accounts' | 'boxes')}
            style={{
              padding: '10px 16px',
              border: 'none',
              borderBottom: tab === t.k ? '2px solid var(--primary-light)' : '2px solid transparent',
              background: 'transparent',
              color: tab === t.k ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: tab === t.k ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div style={{ padding: 24, color: 'var(--text-secondary)' }}>กำลังโหลด…</div>}

      {/* ── ACCOUNTS TAB ─────────────────────────────────────────────────── */}
      {!loading && tab === 'accounts' && (
        <section className="pms-card pms-transition" style={{ padding: 16 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <select value={fKind} onChange={e => setFKind(e.target.value as AccountKind | '')} style={selectSx}>
              <option value="">หมวดทั้งหมด</option>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select value={fActive} onChange={e => setFActive(e.target.value as 'all'|'active'|'inactive')} style={selectSx}>
              <option value="all">สถานะทั้งหมด</option>
              <option value="active">ใช้งาน</option>
              <option value="inactive">ปิด</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showAdvanced}
                onChange={e => setShowAdvanced(e.target.checked)}
              />
              แสดงบัญชีระบบ (ขั้นสูง){!showAdvanced && hiddenSystemCount > 0 && ` • ซ่อน ${hiddenSystemCount}`}
            </label>
            <div style={{ flex: 1 }} />
            <button onClick={openNewAccount} style={btnPrimarySx}>+ สร้างบัญชีใหม่</button>
          </div>
          {!showAdvanced && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px', padding: '6px 10px', background: 'var(--surface-subtle)', borderRadius: 4 }}>
              💡 แสดงเฉพาะบัญชีเงินจริง (เงินสด / ธนาคาร / พักบัตร) — บัญชีระบบ เช่น VAT, เงินมัดจำ, รายได้, ค่าใช้จ่าย ถูกซ่อนไว้เพราะระบบโพสต์ให้อัตโนมัติ
            </p>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface-muted)' }}>
                  <th style={thSx}>รหัส</th>
                  <th style={thSx}>ชื่อบัญชี</th>
                  <th style={thSx}>หมวด</th>
                  <th style={thSx}>ประเภทย่อย</th>
                  <th style={thSx}>ธนาคาร / เลขบัญชี</th>
                  <th style={{ ...thSx, textAlign: 'right' }}>ยอดยกมา</th>
                  <th style={thSx}>สถานะ</th>
                  <th style={thSx}></th>
                </tr>
              </thead>
              <tbody>
                {visibleAccounts.map((a, i) => (
                  <tr key={a.id} style={{ background: i % 2 ? 'var(--surface-subtle)' : 'var(--surface-card)' }}>
                    <td style={tdSx}><code>{a.code}</code></td>
                    <td style={tdSx}>
                      <div style={{ fontWeight: 500 }}>{a.name}</div>
                      {a.nameEN && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.nameEN}</div>}
                    </td>
                    <td style={tdSx}>{KIND_LABEL[a.kind]}</td>
                    <td style={tdSx}>{SUBKIND_LABEL[a.subKind]}</td>
                    <td style={tdSx}>
                      {a.bankName ? (
                        <div>
                          <div>{a.bankName}</div>
                          {a.bankAccountNo && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.bankAccountNo}</div>}
                        </div>
                      ) : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                    </td>
                    <td style={{ ...tdSx, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtBaht(a.openingBalance)}</td>
                    <td style={tdSx}>
                      {a.isSystem  && <span style={badgeSys}>SYSTEM</span>}
                      {a.isDefault && <span style={badgeDef}>DEFAULT</span>}
                      {!a.isActive && <span style={badgeOff}>ปิด</span>}
                      {a.isActive && !a.isDefault && !a.isSystem && <span style={{ color: 'var(--success)' }}>●</span>}
                    </td>
                    <td style={{ ...tdSx, whiteSpace: 'nowrap' }}>
                      <button onClick={() => openEditAccount(a)} style={btnLinkSx}>แก้ไข</button>
                      {!a.isSystem && a.isActive && (
                        <button onClick={() => deactivateAccount(a)} style={{ ...btnLinkSx, color: 'var(--danger)' }}>ลบ</button>
                      )}
                    </td>
                  </tr>
                ))}
                {visibleAccounts.length === 0 && (
                  <tr><td colSpan={8} style={{ ...tdSx, textAlign: 'center', color: 'var(--text-muted)' }}>ไม่พบบัญชี</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── CASH BOXES TAB ───────────────────────────────────────────────── */}
      {!loading && tab === 'boxes' && (
        <section className="pms-card pms-transition" style={{ padding: 16 }}>
          <div style={{ display: 'flex', marginBottom: 12 }}>
            <div style={{ flex: 1 }} />
            <button onClick={openNewBox} style={btnPrimarySx}>+ สร้างลิ้นชักใหม่</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface-muted)' }}>
                  <th style={thSx}>รหัส</th>
                  <th style={thSx}>ชื่อลิ้นชัก</th>
                  <th style={thSx}>บัญชีเงินสดที่ผูก</th>
                  <th style={thSx}>หมายเหตุ</th>
                  <th style={thSx}>สถานะกะ</th>
                  <th style={thSx}>สถานะ</th>
                  <th style={thSx}></th>
                </tr>
              </thead>
              <tbody>
                {boxes.map((b, i) => (
                  <tr key={b.id} style={{ background: i % 2 ? 'var(--surface-subtle)' : 'var(--surface-card)' }}>
                    <td style={tdSx}><code>{b.code}</code></td>
                    <td style={tdSx}>{b.name}</td>
                    <td style={tdSx}>
                      <code style={{ color: 'var(--text-muted)' }}>{b.financialAccount.code}</code> {b.financialAccount.name}
                    </td>
                    <td style={tdSx}>{b.notes ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>
                    <td style={tdSx}>
                      {b.activeSession ? (
                        <button
                          type="button"
                          onClick={() => router.push(`/cashier?sessionId=${b.activeSession!.id}`)}
                          title="ดูกะนี้ในหน้าแคชเชียร์"
                          style={{
                            display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start',
                            gap: 2, padding: '4px 8px', borderRadius: 4,
                            background: '#dcfce7', color: '#166534',
                            border: '1px solid #86efac', cursor: 'pointer',
                            fontSize: 11, textAlign: 'left',
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>
                            🟢 เปิดกะโดย {b.activeSession.openedByName ?? '—'}
                          </span>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            เปิดเมื่อ {fmtDateTime(b.activeSession.openedAt)}
                          </span>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            ยอดเปิด ฿{fmtBaht(b.activeSession.openingBalance)}
                          </span>
                        </button>
                      ) : (
                        <span style={badgeIdle}>ว่าง</span>
                      )}
                    </td>
                    <td style={tdSx}>
                      {!b.isActive && <span style={badgeOff}>ปิด</span>}
                      {b.isActive && !b.activeSession && <span style={{ color: 'var(--success)' }}>●</span>}
                    </td>
                    <td style={{ ...tdSx, whiteSpace: 'nowrap' }}>
                      <button onClick={() => openEditBox(b)} style={btnLinkSx}>แก้ไข</button>
                      {b.isActive && (
                        <button onClick={() => deactivateBox(b)} style={{ ...btnLinkSx, color: 'var(--danger)' }}>ปิด</button>
                      )}
                    </td>
                  </tr>
                ))}
                {boxes.length === 0 && (
                  <tr><td colSpan={7} style={{ ...tdSx, textAlign: 'center', color: 'var(--text-muted)' }}>ยังไม่มีลิ้นชัก</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── ACCOUNT MODAL ────────────────────────────────────────────────── */}
      {showAccModal && (
        <Modal title={editAcc ? `แก้ไขบัญชี ${editAcc.code}` : 'สร้างบัญชีใหม่'} onClose={() => setShowAccModal(false)}>
          <div style={{ display: 'grid', gap: 10 }}>
            <Row label="รหัส">
              <input
                value={accForm.code}
                onChange={e => setAccForm(f => ({ ...f, code: e.target.value }))}
                disabled={!!editAcc}
                placeholder="เช่น 1110-02"
                style={inputSx}
              />
            </Row>
            <Row label="ชื่อบัญชี (TH)">
              <input value={accForm.name} onChange={e => setAccForm(f => ({ ...f, name: e.target.value }))} style={inputSx} />
            </Row>
            <Row label="ชื่อ EN">
              <input value={accForm.nameEN} onChange={e => setAccForm(f => ({ ...f, nameEN: e.target.value }))} style={inputSx} />
            </Row>
            <Row label="หมวด">
              <select
                value={accForm.kind}
                onChange={e => {
                  const k = e.target.value as AccountKind;
                  setAccForm(f => ({ ...f, kind: k, subKind: SUB_BY_KIND[k][0] }));
                }}
                disabled={!!editAcc}
                style={inputSx}
              >
                {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Row>
            <Row label="ประเภทย่อย">
              {/* Bug2 fix: allow editing subKind when account has no transactions yet.
                  editAcc with _count all-zero = "created by mistake, nothing posted" → safe to change.
                  Server enforces the same rule (409 HAS_TRANSACTIONS if violated). */}
              {(() => {
                const hasRefs = editAcc
                  ? (editAcc._count.ledgerEntries + editAcc._count.payments + editAcc._count.paymentFees + editAcc._count.refunds + editAcc._count.cashBoxes) > 0
                  : false;
                const locked = !!editAcc && (editAcc.isSystem || hasRefs);
                return (
                  <>
                    <select
                      value={accForm.subKind}
                      onChange={e => setAccForm(f => ({ ...f, subKind: e.target.value as AccountSubKind }))}
                      disabled={locked}
                      style={inputSx}
                    >
                      {SUB_BY_KIND[accForm.kind].map(sk => <option key={sk} value={sk}>{SUBKIND_LABEL[sk]}</option>)}
                    </select>
                    {editAcc && !locked && (
                      <p style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>
                        ⚠️ เปลี่ยนได้เพราะยังไม่มีรายการที่ผูกกับบัญชีนี้ — หลังมีรายการแล้วจะล็อค
                      </p>
                    )}
                    {editAcc && hasRefs && (
                      <p style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                        🔒 มีรายการอ้างอิงแล้ว ({editAcc._count.ledgerEntries + editAcc._count.payments} รายการ) — เปลี่ยนประเภทย่อยไม่ได้
                      </p>
                    )}
                  </>
                );
              })()}
            </Row>

            {(accForm.subKind === 'BANK' || accForm.subKind === 'CARD_CLEARING') && (
              <>
                <Row label="ชื่อธนาคาร">
                  <input value={accForm.bankName} onChange={e => setAccForm(f => ({ ...f, bankName: e.target.value }))} style={inputSx} />
                </Row>
                <Row label="เลขที่บัญชี">
                  <input value={accForm.bankAccountNo} onChange={e => setAccForm(f => ({ ...f, bankAccountNo: e.target.value }))} style={inputSx} />
                </Row>
                <Row label="ชื่อบัญชีธนาคาร">
                  <input value={accForm.bankAccountName} onChange={e => setAccForm(f => ({ ...f, bankAccountName: e.target.value }))} style={inputSx} />
                </Row>
              </>
            )}

            {!editAcc && (
              <Row label="ยอดยกมา">
                <input
                  type="number"
                  step="0.01"
                  value={accForm.openingBalance}
                  onChange={e => setAccForm(f => ({ ...f, openingBalance: Number(e.target.value) }))}
                  style={inputSx}
                />
              </Row>
            )}

            <Row label="คำอธิบาย">
              <textarea
                value={accForm.description}
                onChange={e => setAccForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
                style={{ ...inputSx, resize: 'vertical' }}
              />
            </Row>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={accForm.isDefault} onChange={e => setAccForm(f => ({ ...f, isDefault: e.target.checked }))} />
              ตั้งเป็นค่าเริ่มต้นของประเภทย่อยนี้
            </label>
            {editAcc && !editAcc.isSystem && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={accForm.isActive} onChange={e => setAccForm(f => ({ ...f, isActive: e.target.checked }))} />
                เปิดใช้งาน
              </label>
            )}
            {editAcc?.isSystem && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                บัญชีมาตรฐานของระบบ — แก้ไขชื่อและรายละเอียดธนาคารได้ แต่ปิดใช้งานไม่ได้
              </p>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={() => setShowAccModal(false)} style={btnSx} disabled={accSaving}>ยกเลิก</button>
            <button onClick={submitAccount} style={btnPrimarySx} disabled={accSaving || !accForm.code || !accForm.name}>
              {accSaving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── CASH BOX MODAL ───────────────────────────────────────────────── */}
      {showBoxModal && (
        <Modal title={editBox ? `แก้ไขลิ้นชัก ${editBox.code}` : 'สร้างลิ้นชักใหม่'} onClose={() => setShowBoxModal(false)}>
          <div style={{ display: 'grid', gap: 10 }}>
            <Row label="รหัสลิ้นชัก">
              <input
                value={boxForm.code}
                onChange={e => setBoxForm(f => ({ ...f, code: e.target.value }))}
                disabled={!!editBox}
                placeholder="เช่น COUNTER-1"
                style={inputSx}
              />
            </Row>
            <Row label="ชื่อลิ้นชัก">
              <input value={boxForm.name} onChange={e => setBoxForm(f => ({ ...f, name: e.target.value }))} style={inputSx} />
            </Row>
            <Row label="บัญชีเงินสดที่ผูก">
              <select
                value={boxForm.financialAccountId}
                onChange={e => setBoxForm(f => ({ ...f, financialAccountId: e.target.value }))}
                style={inputSx}
              >
                <option value="">— เลือกบัญชีเงินสด —</option>
                {cashAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </Row>
            <Row label="หมายเหตุ">
              <textarea
                value={boxForm.notes}
                onChange={e => setBoxForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                style={{ ...inputSx, resize: 'vertical' }}
              />
            </Row>
            {editBox && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={boxForm.isActive} onChange={e => setBoxForm(f => ({ ...f, isActive: e.target.checked }))} />
                เปิดใช้งาน
              </label>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={() => setShowBoxModal(false)} style={btnSx} disabled={boxSaving}>ยกเลิก</button>
            <button
              onClick={submitBox}
              style={btnPrimarySx}
              disabled={boxSaving || !boxForm.code || !boxForm.name || !boxForm.financialAccountId}
            >
              {boxSaving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Presentational helpers ───────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="pms-card"
        style={{ padding: 20, width: 'min(560px, 92vw)', maxHeight: '90vh', overflow: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h2>
          <button onClick={onClose} style={{ ...btnLinkSx, fontSize: 18 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '160px 1fr', alignItems: 'center', gap: 10, fontSize: 13 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </label>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────
const thSx: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border-default)',
  fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap',
};
const tdSx: React.CSSProperties = {
  padding: '8px 10px', borderBottom: '1px solid var(--border-light)', verticalAlign: 'top',
};
const inputSx: React.CSSProperties = {
  padding: '6px 8px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 13, background: 'var(--surface-card)', color: 'var(--text-primary)', width: '100%',
};
const selectSx: React.CSSProperties = { ...inputSx, width: 'auto' };
const btnSx: React.CSSProperties = {
  padding: '6px 14px', border: '1px solid var(--border-default)', borderRadius: 4,
  background: 'var(--surface-card)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13,
};
const btnPrimarySx: React.CSSProperties = {
  ...btnSx, background: 'var(--primary-light)', color: '#fff', borderColor: 'var(--primary-light)',
};
const btnLinkSx: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--primary-light)',
  cursor: 'pointer', padding: '2px 6px', fontSize: 13,
};
const badgeSys: React.CSSProperties = {
  display: 'inline-block', padding: '1px 6px', borderRadius: 3, marginRight: 4,
  fontSize: 10, background: '#eff6ff', color: '#1e40af', fontWeight: 600,
};
const badgeDef: React.CSSProperties = {
  display: 'inline-block', padding: '1px 6px', borderRadius: 3, marginRight: 4,
  fontSize: 10, background: '#f0fdf4', color: '#166534', fontWeight: 600,
};
const badgeOff: React.CSSProperties = {
  display: 'inline-block', padding: '1px 6px', borderRadius: 3, marginRight: 4,
  fontSize: 10, background: '#fee2e2', color: '#991b1b', fontWeight: 600,
};
const badgeIdle: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 3,
  fontSize: 11, background: 'var(--surface-muted)', color: 'var(--text-secondary)', fontWeight: 500,
};
