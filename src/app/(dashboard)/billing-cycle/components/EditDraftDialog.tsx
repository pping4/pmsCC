/**
 * EditDraftDialog.tsx — Billing Cycle / Task 3.3 + 5.4
 *
 * Modal dialog that lets a manager inline-edit a draft invoice's amounts
 * and/or cycle period before approval.
 *
 * Fields:
 *  - periodStart   (date)            — cycle start (changing re-pro-rates rent)
 *  - periodEnd     (date)            — cycle end
 *  - rentAmount    (baht, ≥0)        — always shown; blank = auto-pro-rate from period
 *  - waterUsage    (units, ≥0)       — only if draft has UTILITY_WATER line
 *  - electricUsage (units, ≥0)       — only if draft has UTILITY_ELECTRIC line
 *  - notes         (textarea ≤500)   — always shown
 *
 * POST /api/billing/drafts/[id]/edit
 *   400 → Zod validation
 *   422 with `unmatched` → per-field error
 *   200 → { ok: true, newGrandTotal: number, newPeriodStart?: string, newPeriodEnd?: string }
 */

'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui';
import { useToast } from '@/components/ui';
import { fmtBaht, formatPeriod } from '@/lib/date-format';

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
  periodStart:   string;   // "YYYY-MM-DD"
  periodEnd:     string;   // "YYYY-MM-DD"
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
  // Period inputs — default to the draft's existing period
  const [periodStart,    setPeriodStart]    = useState(draft.periodStart);
  const [periodEnd,      setPeriodEnd]      = useState(draft.periodEnd);
  // Rent — blank means "auto-pro-rate from changed period" when period changes
  const [rentAmount,     setRentAmount]     = useState(String(draft.rentAmount));
  const [waterUsage,     setWaterUsage]     = useState('');   // units — blank = no change
  const [electricUsage,  setElectricUsage]  = useState('');  // units — blank = no change
  const [notes,          setNotes]          = useState('');

  // Track whether user explicitly typed a rent override
  const rentChanged = rentAmount !== String(draft.rentAmount);
  const periodChanged = periodStart !== draft.periodStart || periodEnd !== draft.periodEnd;

  // ── Field errors ──────────────────────────────────────────────────────────
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // ── Async state ────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (loading) return;
    setFieldErrors({});

    // ── Client-side validation ──────────────────────────────────────────────
    const errs: Record<string, string> = {};

    if (!periodStart) errs.periodStart = 'กรุณาระบุวันเริ่มต้น';
    if (!periodEnd)   errs.periodEnd   = 'กรุณาระบุวันสิ้นสุด';
    if (periodStart && periodEnd && periodEnd < periodStart) {
      errs.periodEnd = 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น';
    }

    // Rent validation: if user typed something, validate it; blank = auto-pro-rate
    if (rentAmount !== '') {
      const parsedRent = parseFloat(rentAmount);
      if (isNaN(parsedRent) || parsedRent < 0) {
        errs.rentAmount = 'ค่าห้องต้องเป็นตัวเลข ≥ 0';
      }
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

    // ── Build payload — only include fields that changed ────────────────────
    const body: Record<string, unknown> = {};

    // Period — only send if changed from original
    if (periodChanged) {
      body.periodStart = periodStart;
      body.periodEnd   = periodEnd;
    }

    // Rent — only include if user explicitly typed a value
    // (if period changed and rentAmount is still the original, we let server re-pro-rate)
    if (rentAmount !== '' && (rentChanged || !periodChanged)) {
      body.rentAmount = parseFloat(rentAmount);
    } else if (!periodChanged && rentAmount !== '') {
      // No period change, use whatever rent value is there
      body.rentAmount = parseFloat(rentAmount);
    }

    if (hasWater && waterUsage !== '') body.waterUsage = parseFloat(waterUsage);
    if (hasElectric && electricUsage !== '') body.electricUsage = parseFloat(electricUsage);
    if (notes.trim()) body.notes = notes.trim();

    // Ensure at least one field is provided
    if (Object.keys(body).length === 0) {
      toast.warning('ไม่มีอะไรเปลี่ยนแปลง');
      return;
    }

    // If only period changed (no rentAmount override), include rent in body
    // only when period changed — let API do the re-pro-rate
    if (periodChanged && body.rentAmount === undefined && !rentChanged) {
      // intentionally omit rentAmount — API will auto-pro-rate
    } else if (!periodChanged && body.rentAmount === undefined) {
      // No period change, no explicit rent — that's allowed as long as other fields exist
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/billing/drafts/${draft.invoiceId}/edit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({})) as {
        ok?:             boolean;
        newGrandTotal?:  number;
        newPeriodStart?: string;
        newPeriodEnd?:   string;
        error?:          string;
        unmatched?:      string[];
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

      const periodLabel = data.newPeriodStart && data.newPeriodEnd
        ? formatPeriod(data.newPeriodStart, data.newPeriodEnd)
        : undefined;

      toast.success(
        'บันทึกการแก้ไขแล้ว',
        [
          data.newGrandTotal !== undefined ? `ยอดใหม่: ฿${fmtBaht(data.newGrandTotal)}` : '',
          periodLabel ? `ช่วง: ${periodLabel}` : '',
        ].filter(Boolean).join(' · ') || undefined,
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
      description={`${draft.guestName} · ${draft.invoiceNumber} · ${formatPeriod(draft.periodStart, draft.periodEnd)}`}
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

        {/* ── Period inputs (Task 5.4) ───────────────────────────────────── */}
        <div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <LabelRow label="ตั้งแต่วันที่" />
              <input
                type="date"
                value={periodStart}
                onChange={e => setPeriodStart(e.target.value)}
                style={{
                  ...inputStyle,
                  borderColor: fieldErrors.periodStart ? '#fca5a5' : undefined,
                }}
              />
              <FieldError msg={fieldErrors.periodStart} />
            </div>
            <div style={{ flex: 1 }}>
              <LabelRow label="ถึงวันที่" />
              <input
                type="date"
                value={periodEnd}
                min={periodStart}
                onChange={e => setPeriodEnd(e.target.value)}
                style={{
                  ...inputStyle,
                  borderColor: fieldErrors.periodEnd ? '#fca5a5' : undefined,
                }}
              />
              <FieldError msg={fieldErrors.periodEnd} />
            </div>
          </div>
          {periodChanged && (
            <div style={{
              marginTop: 6, fontSize: 11,
              color: '#1d4ed8',
              padding: '6px 10px',
              background: '#eff6ff',
              borderRadius: 6,
              border: '1px solid #bfdbfe',
            }}>
              💡 เปลี่ยนช่วงวันที่จะคำนวณค่าเช่าใหม่ตามจำนวนวันโดยอัตโนมัติ ยกเว้นคุณกรอกค่าเช่าด้วยตัวเอง
            </div>
          )}
        </div>

        {/* Rent amount */}
        <div>
          <LabelRow label={periodChanged ? 'ค่าห้อง (บาท) — เว้นว่างให้คำนวณอัตโนมัติ' : 'ค่าห้อง (บาท)'} />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder={periodChanged ? 'เว้นว่างให้คำนวณตามจำนวนวัน' : ''}
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
