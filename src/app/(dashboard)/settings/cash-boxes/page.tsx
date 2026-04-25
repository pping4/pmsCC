'use client';

/**
 * /settings/cash-boxes — Sprint 4B / B-T12.
 *
 * Admin page for managing cash drawers (counters). Paired with:
 *   GET    /api/cash-boxes
 *   POST   /api/cash-boxes
 *   PATCH  /api/cash-boxes/[id]
 *   DELETE /api/cash-boxes/[id]   (soft-delete = deactivate)
 *
 * Access: client-side guard via `admin.manage_settings`. The API is the
 * real trust boundary — this page just hides affordances when the signed-in
 * user lacks the perm.
 *
 * Design notes:
 *  - Each row shows the denormalized `activeSession` pointer so the admin
 *    can see "in use by X since HH:mm" at a glance (O(1) per box, no joins).
 *  - Deactivate is blocked server-side when a session is open; we also
 *    disable the button client-side to avoid a round-trip.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/ui';
import { useEffectivePermissions, can } from '@/lib/rbac/client';
import { fmtDateTime, fmtBaht } from '@/lib/date-format';

// ── Types ───────────────────────────────────────────────────────────────────

interface ActiveSession {
  id:             string;
  openedBy:       string;
  openedByName:   string | null;
  openedAt:       string; // ISO from server
  openingBalance: number;
}

interface CashBox {
  id:           string;
  code:         string;
  name:         string;
  location:     string | null;
  displayOrder: number;
  isActive:     boolean;
  notes:        string | null;
  financialAccount: { id: string; code: string; name: string } | null;
  activeSession: ActiveSession | null;
}

interface CashAccount {
  id:   string;
  code: string;
  name: string;
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function CashBoxesSettingsPage() {
  const toast = useToast();
  const { data: perms, loading: permsLoading } = useEffectivePermissions();
  const canManage = can(perms, 'admin.manage_settings');

  const [boxes,    setBoxes]    = useState<CashBox[]>([]);
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing,    setEditing]    = useState<CashBox | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [boxRes, accRes] = await Promise.all([
        fetch('/api/cash-boxes'),
        fetch('/api/financial-accounts?subKind=CASH&active=1'),
      ]);
      if (!boxRes.ok) throw new Error(`HTTP ${boxRes.status} (cash-boxes)`);
      if (!accRes.ok) throw new Error(`HTTP ${accRes.status} (accounts)`);
      const boxData = await boxRes.json() as { boxes: CashBox[] };
      const accData = await accRes.json() as { accounts: CashAccount[] };
      setBoxes(boxData.boxes ?? []);
      setAccounts(accData.accounts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleToggleActive = async (box: CashBox) => {
    if (box.isActive && box.activeSession) {
      toast.error('ปิดใช้งานไม่ได้', 'ลิ้นชักนี้มีกะเปิดอยู่ — ปิดกะก่อน');
      return;
    }
    try {
      const res = await fetch(`/api/cash-boxes/${box.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !box.isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      toast.success(box.isActive ? 'ปิดใช้งานแล้ว' : 'เปิดใช้งานแล้ว');
      await load();
    } catch (e) {
      toast.error('ดำเนินการไม่สำเร็จ', e instanceof Error ? e.message : 'unknown');
    }
  };

  const activeCount = useMemo(() => boxes.filter((b) => b.isActive).length, [boxes]);
  const openCount   = useMemo(() => boxes.filter((b) => b.activeSession).length, [boxes]);

  if (permsLoading) {
    return <div className="p-6 text-sm text-gray-500">กำลังตรวจสอบสิทธิ์...</div>;
  }
  if (!canManage) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">
          🚫 คุณไม่มีสิทธิ์ <code>admin.manage_settings</code> ในการเข้าหน้านี้
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-800">🏧 ลิ้นชัก / เคาน์เตอร์แคชเชียร์</h1>
          <p className="text-xs text-gray-500 mt-1">
            จัดการเคาน์เตอร์รับเงิน — แต่ละลิ้นชักผูกกับบัญชีประเภทเงินสดหนึ่งบัญชี
            และสามารถมีกะเปิดได้ครั้งละหนึ่งกะ
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium"
        >
          + เพิ่มลิ้นชักใหม่
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="text-xs text-gray-500">ทั้งหมด</div>
          <div className="text-2xl font-semibold text-gray-800">{boxes.length}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="text-xs text-gray-500">เปิดใช้งาน</div>
          <div className="text-2xl font-semibold text-green-600">{activeCount}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="text-xs text-gray-500">กะที่เปิดอยู่</div>
          <div className="text-2xl font-semibold text-blue-600">{openCount}</div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs">
          โหลดข้อมูลไม่สำเร็จ: {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-xs text-gray-600">
              <th className="px-3 py-2 w-16">ลำดับ</th>
              <th className="px-3 py-2">รหัส</th>
              <th className="px-3 py-2">ชื่อ</th>
              <th className="px-3 py-2">ตำแหน่ง</th>
              <th className="px-3 py-2">บัญชี GL</th>
              <th className="px-3 py-2">สถานะ</th>
              <th className="px-3 py-2">กะปัจจุบัน</th>
              <th className="px-3 py-2 text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500 text-xs">กำลังโหลด...</td></tr>
            ) : boxes.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500 text-xs">ยังไม่มีลิ้นชัก</td></tr>
            ) : boxes.map((b) => (
              <tr key={b.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs text-gray-600">{b.displayOrder}</td>
                <td className="px-3 py-2 font-mono font-semibold text-gray-800">{b.code}</td>
                <td className="px-3 py-2 text-gray-800">{b.name}</td>
                <td className="px-3 py-2 text-gray-600">{b.location ?? '—'}</td>
                <td className="px-3 py-2 text-xs">
                  {b.financialAccount ? (
                    <span className="font-mono">{b.financialAccount.code} · {b.financialAccount.name}</span>
                  ) : <span className="text-red-600">ไม่ได้ผูกบัญชี</span>}
                </td>
                <td className="px-3 py-2">
                  {b.isActive
                    ? <span className="inline-block px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">เปิดใช้งาน</span>
                    : <span className="inline-block px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 text-xs">ปิดใช้งาน</span>}
                </td>
                <td className="px-3 py-2 text-xs">
                  {b.activeSession ? (
                    <div className="flex flex-col">
                      <span className="font-semibold text-blue-700">
                        🟢 {b.activeSession.openedByName ?? b.activeSession.openedBy}
                      </span>
                      <span className="text-gray-500">
                        เปิดเมื่อ {fmtDateTime(b.activeSession.openedAt)} · ฿{fmtBaht(b.activeSession.openingBalance)}
                      </span>
                    </div>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex gap-1 justify-end">
                    <button
                      onClick={() => setEditing(b)}
                      className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                    >แก้ไข</button>
                    <button
                      onClick={() => handleToggleActive(b)}
                      disabled={b.isActive && !!b.activeSession}
                      title={b.isActive && b.activeSession ? 'ปิดกะก่อนจึงจะปิดใช้งานได้' : ''}
                      className={`px-2 py-1 text-xs rounded border ${
                        b.isActive
                          ? 'border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed'
                          : 'border-green-300 text-green-700 hover:bg-green-50'
                      }`}
                    >{b.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <CashBoxDialog
          mode="create"
          accounts={accounts}
          onClose={() => setCreateOpen(false)}
          onSaved={async () => { setCreateOpen(false); await load(); }}
        />
      )}
      {editing && (
        <CashBoxDialog
          mode="edit"
          box={editing}
          accounts={accounts}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

// ── Create/Edit dialog ──────────────────────────────────────────────────────

interface DialogProps {
  mode:     'create' | 'edit';
  box?:     CashBox;
  accounts: CashAccount[];
  onClose:  () => void;
  onSaved:  () => void | Promise<void>;
}

function CashBoxDialog({ mode, box, accounts: initialAccounts, onClose, onSaved }: DialogProps) {
  const toast = useToast();

  const [code,         setCode]         = useState(box?.code ?? '');
  const [name,         setName]         = useState(box?.name ?? '');
  const [location,     setLocation]     = useState(box?.location ?? '');
  const [displayOrder, setDisplayOrder] = useState(String(box?.displayOrder ?? 0));
  const [accountId,    setAccountId]    = useState(box?.financialAccount?.id ?? '');
  const [notes,        setNotes]        = useState(box?.notes ?? '');

  // Re-fetch the CASH account list every time the dialog opens, so newly
  // created accounts (in another tab or just now at /settings/accounts)
  // show up without needing a page refresh.
  const [accounts, setAccounts] = useState<CashAccount[]>(initialAccounts);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/financial-accounts?subKind=CASH&active=1')
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: { accounts: CashAccount[] }) => {
        if (!cancelled) setAccounts(data.accounts ?? []);
      })
      .catch(() => { /* fall back to initialAccounts already in state */ });
    return () => { cancelled = true; };
  }, []);

  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const isEdit = mode === 'edit';

  const canSubmit =
    !submitting &&
    name.trim() !== '' &&
    (isEdit || code.trim() !== '') &&
    accountId !== '';

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const url    = isEdit ? `/api/cash-boxes/${box!.id}` : '/api/cash-boxes';
      const method = isEdit ? 'PATCH' : 'POST';
      const body: Record<string, unknown> = {
        name:               name.trim(),
        location:           location.trim() || null,
        displayOrder:       Number.isFinite(parseInt(displayOrder, 10)) ? parseInt(displayOrder, 10) : 0,
        notes:              notes.trim() || null,
        financialAccountId: accountId,
      };
      if (!isEdit) body.code = code.trim();

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.error === 'DUPLICATE_CODE') throw new Error('รหัสนี้มีอยู่แล้ว');
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }
      toast.success(isEdit ? 'บันทึกการแก้ไขแล้ว' : 'สร้างลิ้นชักใหม่แล้ว');
      await onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error(isEdit ? 'แก้ไขไม่สำเร็จ' : 'สร้างไม่สำเร็จ', msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">
            {isEdit ? '✏️ แก้ไขลิ้นชัก' : '➕ เพิ่มลิ้นชักใหม่'}
          </h2>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none disabled:opacity-40"
          >×</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">รหัส (Code) *</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={submitting || isEdit}
              placeholder="เช่น C01"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono disabled:bg-gray-50 disabled:text-gray-500"
            />
            {isEdit && <p className="text-xs text-gray-400 mt-1">แก้ไขรหัสไม่ได้</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">ลำดับแสดง</label>
            <input
              type="number" min="0" step="1"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
              disabled={submitting}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">ชื่อ *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={submitting}
            placeholder="เช่น เคาน์เตอร์ Front Desk 1"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">ตำแหน่ง</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            disabled={submitting}
            placeholder="เช่น ล็อบบี้ ชั้น 1"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">บัญชี GL (เงินสด) *</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={submitting}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">— เลือกบัญชีเงินสด —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            ต้องเป็นบัญชีประเภทเงินสด (CASH) เท่านั้น — ยอดเคลื่อนไหวของลิ้นชักนี้จะถูกบันทึกในบัญชีนี้
          </p>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">หมายเหตุ</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitting}
            rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t pt-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 disabled:opacity-50"
          >ยกเลิก</button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
          >
            {submitting ? 'กำลังบันทึก...' : (isEdit ? '💾 บันทึก' : '➕ สร้าง')}
          </button>
        </div>
      </div>
    </div>
  );
}
