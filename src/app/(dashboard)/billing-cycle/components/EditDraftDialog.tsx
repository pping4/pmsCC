/**
 * EditDraftDialog.tsx — Billing Cycle / Task 3.3
 *
 * Modal dialog that lets a manager inline-edit a draft invoice's amounts
 * before approval.
 *
 * Fields:
 *  - rentAmount    (baht, ≥0)        — always shown
 *  - waterUsage    (units, ≥0)       — only if draft has UTILITY_WATER line
 *  - electricUsage (units, ≥0)       — only if draft has UTILITY_ELECTRIC line
 *  - notes         (textarea ≤500)   — always shown
 *
 * Rates are displayed as helper text below each utility input.
 * The API returns the computed newGrandTotal on success.
 *
 * POST /api/billing/drafts/[id]/edit
 *   422 with `unmatched` → per-field error
 *   200 → { ok: true, newGrandTotal: number }
 */

'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui';
import { useToast } from '@/components/ui';
import { fmtBaht } from '@/lib/date-format';

// ─── DraftRow subset we need ──────────────────────────────────────────────────

export interface DraftRowForEdit {
  invoiceId:     string;
  invoiceNumber: string;
  roomNumber:    string;
  guestName:     string;
  rentAmount:    number;
  waterAmount:   number;
  electricAmount: number;
  grandTotal:    number;
}

interface EditDraftDialogProps {
  draft:     DraftRowForEdit;
  onClose:   () => void;
  onSuccess: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 3 }}>{msg}</div>;
}

function LabelRow({ label, required }: { label: string; required?: boolean }) {
  return (
    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
      {label}
      {required && <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  border: '1px solid var(--border-default)',
  borderRadius: 8, padding: '8px 12px',
  fontSize: 13, color: 'var(--text-primary)',
  background: 'var(--surface-card)',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function EditDraftDialog({ draft, onClose, onSuccess }: EditDraftDialogProps) {
  const toast = useToast();

  const hasWater    = draft.waterAmount > 0;
  const hasElectric = draft.electricAmount > 0;

  // ── Form state ─────────────────────────────────────────────────────────────
  const [rentAmount,    setRentAmount]    = useState(String(draft.rentAmount));
  const [waterUsage,    setWaterUsage]    = useState('');   // units — blank = no change
  const [electricUsage, setElectricUsage] = useState('');  // units — blank = no change
  const [notes,         setNotes]         = useState('');

  // ── Field errors (from 422 unmatched or local validation) ──────────────────
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // ── Async state ────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (loading) return;
    setFieldErrors({});

    // ── Client-side validation ──────────────────────────────────────────────
    const errs: Record<string, string> = {};
    const parsedRent = parseFloat(rentAmount);
    if (isNaN(parsedRent) || parsedRent < 0) {
      errs.rentAmount = 'ค่าห้องต้องเป็นตัวเลข ≥ 0';
    }
    if (hasWater && waterUsage !== '') {
      const v = parseFloat(waterUsage);
      if (isNaN(v) || v < 0) errs.waterUsage = 'หน่วยน้ำต้องเป็นตัวเลข ≥ 0';
    }
    if (hasElectric && electricUsage !== '') {
      const v = parseFloat(electricUsage);
      if (isNaN(v) || v < 0) errs.electricUsage = 'หน่วยไฟต้องเป็นตัวเลข ≥ 0';
    }
    if (notes.length > 500) {
      errs.notes = 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร';
    }

    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }

    // ── Build payload — only include fields with values ─────────────────────
    const body: Record<string, unknown> = {
      rentAmount: parsedRent,
    };
    if (hasWater && waterUsage !== '') body.waterUsage = parseFloat(waterUsage);
    if (hasElectric && electricUsage !== '') body.electricUsage = parseFloat(electricUsage);
    if (notes.trim()) body.notes = notes.trim();

    setLoading(true);
    try {
      const res = await fetch(`/api/billing/drafts/${draft.invoiceId}/edit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({})) as {
        ok?:          boolean;
        newGrandTotal?: number;
        error?:       string;
        unmatched?:   string[];
      };

      if (res.status === 422 && data.unmatched) {
        // Map server unmatched → per-field errors
        const newErrs: Record<string, string> = {};
        for (const field of data.unmatched) {
          newErrs[field] = `ไม่มี line item สำหรับ field นี้ใน draft`;
        }
        setFieldErrors(newErrs);
        return;
      }

      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      toast.success(
        'บันทึกการแก้ไขแล้ว',
        data.newGrandTotal !== undefined
          ? `ยอดใหม่: ฿${fmtBaht(data.newGrandTotal)}`
          : undefined,
      );
      onSuccess();
    } catch (err) {
      toast.error('แก้ไขบิลไม่สำเร็จ', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <Dialog
      open
      onClose={loading ? () => {} : onClose}
      title={`แก้ไขบิล — ห้อง ${draft.roomNumber}`}
      description={`${draft.guestName} · ${draft.invoiceNumber}`}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              padding: '8px 18px', borderRadius: 7,
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)', color: 'var(--text-primary)',
              cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13,
            }}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={loading}
            style={{
              padding: '8px 18px', borderRadius: 7,
              background: loading ? '#9ca3af' : '#1e40af',
              color: '#fff', border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 700, fontSize: 13,
            }}
          >
            {loading ? 'กำลังบันทึก...' : '💾 บันทึก'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Current total for context */}
        <div style={{
          background: 'var(--surface-subtle)', borderRadius: 8,
          padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)',
        }}>
          ยอดปัจจุบัน: <strong style={{ color: 'var(--text-primary)' }}>฿{fmtBaht(draft.grandTotal)}</strong>
          <span style={{ marginLeft: 12 }}>ค่าห้อง ฿{fmtBaht(draft.rentAmount)}</span>
          {draft.waterAmount > 0 && <span style={{ marginLeft: 8 }}>น้ำ ฿{fmtBaht(draft.waterAmount)}</span>}
          {draft.electricAmount > 0 && <span style={{ marginLeft: 8 }}>ไฟ ฿{fmtBaht(draft.electricAmount)}</span>}
        </div>

        {/* Rent amount */}
        <div>
          <LabelRow label="ค่าห้อง (บาท)" required />
          <input
            type="number"
            min="0"
            step="0.01"
            value={rentAmount}
            onChange={e => setRentAmount(e.target.value)}
            style={{
              ...inputStyle,
              borderColor: fieldErrors.rentAmount ? '#fca5a5' : undefined,
            }}
          />
          <FieldError msg={fieldErrors.rentAmount} />
        </div>

        {/* Water usage (units) — only if UTILITY_WATER exists */}
        {hasWater && (
          <div>
            <LabelRow label="ค่าน้ำ (หน่วย)" />
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="เว้นว่างถ้าไม่ต้องการเปลี่ยน"
              value={waterUsage}
              onChange={e => setWaterUsage(e.target.value)}
              style={{
                ...inputStyle,
                borderColor: fieldErrors.waterUsage ? '#fca5a5' : undefined,
              }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
              อัตรา: ฿X/หน่วย (ดึงจาก utility reading ล่าสุด) · ยอดปัจจุบัน ฿{fmtBaht(draft.waterAmount)}
            </div>
            <FieldError msg={fieldErrors.waterUsage} />
          </div>
        )}

        {/* Electric usage (units) — only if UTILITY_ELECTRIC exists */}
        {hasElectric && (
          <div>
            <LabelRow label="ค่าไฟ (หน่วย)" />
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="เว้นว่างถ้าไม่ต้องการเปลี่ยน"
              value={electricUsage}
              onChange={e => setElectricUsage(e.target.value)}
              style={{
                ...inputStyle,
                borderColor: fieldErrors.electricUsage ? '#fca5a5' : undefined,
              }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
              อัตรา: ฿X/หน่วย (ดึงจาก utility reading ล่าสุด) · ยอดปัจจุบัน ฿{fmtBaht(draft.electricAmount)}
            </div>
            <FieldError msg={fieldErrors.electricUsage} />
          </div>
        )}

        {/* Notes */}
        <div>
          <LabelRow label="หมายเหตุ" />
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="เช่น: แก้ไขค่าน้ำตามมิเตอร์ที่จดใหม่"
            style={{
              ...inputStyle,
              resize: 'vertical',
              borderColor: fieldErrors.notes ? '#fca5a5' : undefined,
            }}
          />
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            {notes.length}/500
          </div>
          <FieldError msg={fieldErrors.notes} />
        </div>
      </div>
    </Dialog>
  );
}
