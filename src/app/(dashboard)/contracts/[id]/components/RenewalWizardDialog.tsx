'use client';

/**
 * RenewalWizardDialog — 4-step wizard that executes a monthly renewal for
 * one contract (Sprint 3B · Module C · T19).
 *
 * Backed by:
 *   POST /api/contracts/[id]/renewal/preview   (read-only — live totals)
 *   POST /api/contracts/[id]/renewal/execute   (idempotent — money mover)
 *
 * Flow
 *   1) Period confirmation — server suggests nextPeriodStart/End; user may
 *      adjust. periodEnd must be strictly > periodStart.
 *   2) Utilities — two mutually-exclusive sub-options:
 *        "use recorded reading" (grayed-out if no UtilityReading exists yet)
 *        "manual entry" (prev/curr/rate for water + electric)
 *      Water/electric amounts auto-update from /preview.
 *   3) Other charges — dynamic rows of { label, amount }. Parking is already
 *      included by the service for contracts with parkingMonthly > 0, so this
 *      list is purely for ad-hoc additions.
 *   4) Review & submit — final summary + optional notes. On success, toast +
 *      onSuccess callback. The server is idempotent, so a duplicate submit
 *      returns `reused=true` which we surface as an info toast.
 *
 * Discipline
 *   - All buttons type="button" — never submit a form unintentionally.
 *   - Guard + try/finally + toast for both preview and execute.
 *   - Preview re-fetch is debounced 300 ms so typing meter numbers does not
 *     hammer the server.
 *   - No `any`, no th-TH locale, fmtDate/fmtBaht throughout.
 *   - Busy state locks the dialog; Esc / backdrop close are suppressed mid-
 *     submit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  Button,
  Input,
  Textarea,
  useToast,
} from '@/components/ui';
import { fmtBaht, fmtDate, toDateStr } from '@/lib/date-format';

// ─── Types (mirror the service preview/execute shapes) ─────────────────────

interface RenewalPreviewResponse {
  contractId: string;
  contractNumber: string;
  guestName: string;
  roomNumber: string;
  currentPeriodEnd: string;
  nextPeriodStart: string;
  nextPeriodEnd: string;
  billingCycle: 'calendar' | 'rolling';
  baseRent: number;
  furnitureRent: number;
  proratedAdjustment: number;
  utilityWater: number | null;
  utilityElectric: number | null;
  otherCharges: Array<{ label: string; amount: number }>;
  subtotal: number;
  total: number;
  warnings: string[];
  effectiveMonthlyRent: number;
  rateChangedFromAmendment: boolean;
}

interface OtherChargeRow {
  label: string;
  amount: number;
}

interface UtilitySideForm {
  prev: string;
  curr: string;
  rate: string;
}

interface ExecuteResponse {
  ok: boolean;
  folioId: string;
  invoiceId: string | null;
  lineItemIds: string[];
  total: number;
  reused: boolean;
}

export interface RenewalWizardDialogProps {
  open: boolean;
  onClose: () => void;
  contractId: string;
  onSuccess?: (result: {
    folioId: string;
    invoiceId: string | null;
    total: number;
    reused: boolean;
  }) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: 'งวดบิล' },
  { id: 2, label: 'ค่าน้ำ-ไฟ' },
  { id: 3, label: 'ค่าใช้จ่ายอื่น' },
  { id: 4, label: 'ยืนยัน' },
];

const OTHER_CHARGE_SUGGESTIONS = [
  'ค่าที่จอดรถเพิ่ม',
  'ค่าบริการพิเศษ',
  'ค่าทำความสะอาดเพิ่ม',
];

type UtilityMode = 'recorded' | 'manual';

// ─── Helpers ────────────────────────────────────────────────────────────────

function n(v: string): number {
  if (!v) return 0;
  const p = Number(v);
  return Number.isFinite(p) ? p : 0;
}

function cmpDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function emptyUtilitySide(): UtilitySideForm {
  return { prev: '', curr: '', rate: '' };
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function RenewalWizardDialog({
  open,
  onClose,
  contractId,
  onSuccess,
}: RenewalWizardDialogProps) {
  const toast = useToast();

  // Navigation / busy
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  // Step 1 — period
  const [periodStart, setPeriodStart] = useState<string>('');
  const [periodEnd, setPeriodEnd] = useState<string>('');
  const [periodTouched, setPeriodTouched] = useState(false);

  // Step 2 — utilities
  const [utilityMode, setUtilityMode] = useState<UtilityMode>('recorded');
  const [waterForm, setWaterForm] = useState<UtilitySideForm>(emptyUtilitySide);
  const [electricForm, setElectricForm] = useState<UtilitySideForm>(emptyUtilitySide);

  // Step 3 — other charges (user-added only; parking is added by the service)
  const [otherCharges, setOtherCharges] = useState<OtherChargeRow[]>([]);

  // Step 4 — notes
  const [notes, setNotes] = useState('');

  // Preview state
  const [preview, setPreview] = useState<RenewalPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Debounce timer ref (set in effect, cleared on re-run / unmount / close)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track in-flight fetch so we can ignore stale responses.
  const fetchSeqRef = useRef(0);

  // ── Reset on open ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setBusy(false);
    setPeriodStart('');
    setPeriodEnd('');
    setPeriodTouched(false);
    setUtilityMode('recorded');
    setWaterForm(emptyUtilitySide());
    setElectricForm(emptyUtilitySide());
    setOtherCharges([]);
    setNotes('');
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
  }, [open]);

  // ── Build the manual-utility payload (only when all 3 fields filled) ─────
  const manualUtilityPayload = useMemo(() => {
    if (utilityMode !== 'manual') return undefined;
    const out: {
      water?: { prev: number; curr: number; rate: number };
      electric?: { prev: number; curr: number; rate: number };
    } = {};
    const waterFilled =
      waterForm.prev !== '' && waterForm.curr !== '' && waterForm.rate !== '';
    if (waterFilled) {
      out.water = {
        prev: n(waterForm.prev),
        curr: n(waterForm.curr),
        rate: n(waterForm.rate),
      };
    }
    const elecFilled =
      electricForm.prev !== '' &&
      electricForm.curr !== '' &&
      electricForm.rate !== '';
    if (elecFilled) {
      out.electric = {
        prev: n(electricForm.prev),
        curr: n(electricForm.curr),
        rate: n(electricForm.rate),
      };
    }
    return out.water || out.electric ? out : undefined;
  }, [utilityMode, waterForm, electricForm]);

  // ── Preview fetcher (debounced via effect below) ─────────────────────────
  const runPreview = useCallback(
    async (overridePeriodStart?: string) => {
      const mySeq = ++fetchSeqRef.current;
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const body: Record<string, unknown> = {};
        if (overridePeriodStart) body.periodStart = overridePeriodStart;
        if (manualUtilityPayload) body.utilityOverride = manualUtilityPayload;

        const res = await fetch(
          `/api/contracts/${contractId}/renewal/preview`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        const json: unknown = await res.json().catch(() => ({}));
        if (mySeq !== fetchSeqRef.current) return; // stale
        if (!res.ok) {
          const errMsg =
            typeof json === 'object' && json && 'error' in json
              ? String((json as { error?: unknown }).error ?? `HTTP ${res.status}`)
              : `HTTP ${res.status}`;
          throw new Error(errMsg);
        }
        const p = json as RenewalPreviewResponse;
        setPreview(p);
        // Seed periodStart/End from first preview only (before the user edits).
        if (!periodTouched) {
          setPeriodStart(toDateStr(new Date(p.nextPeriodStart)));
          setPeriodEnd(toDateStr(new Date(p.nextPeriodEnd)));
        }
      } catch (e) {
        if (mySeq !== fetchSeqRef.current) return;
        setPreviewError(e instanceof Error ? e.message : 'โหลดตัวอย่างไม่สำเร็จ');
      } finally {
        if (mySeq === fetchSeqRef.current) setPreviewLoading(false);
      }
    },
    // periodTouched intentionally referenced via closure — changing it mid-
    // fetch should NOT invalidate the in-flight request. Likewise manualUtilityPayload
    // is captured so dependencies reflect actual inputs.
    [contractId, manualUtilityPayload, periodTouched],
  );

  // Initial preview on open
  useEffect(() => {
    if (!open) return;
    runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounced re-preview whenever user changes period or utility inputs.
  // 300 ms window; cancels on every re-trigger.
  useEffect(() => {
    if (!open) return;
    // Only debounce-refetch AFTER the first preview has loaded
    // (the initial load already covers the opening state).
    if (!preview) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // If user has overridden period, pass it through so the server computes
      // the right bucket.
      const override = periodTouched && periodStart ? periodStart : undefined;
      runPreview(override);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    periodStart,
    periodEnd,
    utilityMode,
    waterForm.prev,
    waterForm.curr,
    waterForm.rate,
    electricForm.prev,
    electricForm.curr,
    electricForm.rate,
  ]);

  // Cleanup on close
  useEffect(() => {
    if (open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    fetchSeqRef.current++; // invalidate any in-flight request
  }, [open]);

  // ── Step validation ──────────────────────────────────────────────────────
  const stepError = useMemo<string | null>(() => {
    if (step === 1) {
      if (previewLoading && !preview) return 'กำลังคำนวณตัวอย่าง...';
      if (previewError) return previewError;
      if (!preview) return 'ยังไม่มีข้อมูลตัวอย่าง';
      if (!periodStart || !periodEnd) return 'โปรดระบุช่วงงวดบิล';
      if (cmpDate(periodEnd, periodStart) <= 0)
        return 'วันสิ้นสุดงวดต้องอยู่หลังวันเริ่มต้น';
      return null;
    }
    if (step === 2) {
      if (utilityMode === 'manual') {
        const sides: Array<[string, UtilitySideForm]> = [
          ['ค่าน้ำ', waterForm],
          ['ค่าไฟ', electricForm],
        ];
        for (const [name, s] of sides) {
          // empty side is allowed (= 0). But partial is not.
          const filled = [s.prev, s.curr, s.rate].filter((v) => v !== '').length;
          if (filled === 0) continue;
          if (filled < 3) return `${name}: โปรดกรอกครบ (เดิม / ปัจจุบัน / อัตรา)`;
          if (n(s.curr) < n(s.prev))
            return `${name}: เลขปัจจุบันต้องไม่น้อยกว่าเลขเดิม`;
          if (n(s.rate) < 0) return `${name}: อัตราต้องไม่ติดลบ`;
        }
      }
      return null;
    }
    if (step === 3) {
      for (const r of otherCharges) {
        if (!r.label.trim()) return 'ทุกรายการต้องมีชื่อ';
        if (!Number.isFinite(r.amount) || r.amount < 0)
          return 'ทุกยอดต้องไม่ติดลบ';
      }
      return null;
    }
    if (step === 4) {
      if (notes.length > 500) return 'หมายเหตุยาวเกิน 500 ตัวอักษร';
      return null;
    }
    return null;
  }, [
    step,
    previewLoading,
    previewError,
    preview,
    periodStart,
    periodEnd,
    utilityMode,
    waterForm,
    electricForm,
    otherCharges,
    notes,
  ]);

  // ── Navigation ───────────────────────────────────────────────────────────
  const goNext = () => {
    if (stepError) {
      toast.error(stepError);
      return;
    }
    setStep((s) => Math.min(STEPS.length, s + 1));
  };
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  // ── Other-charges row helpers ────────────────────────────────────────────
  const addOtherCharge = () =>
    setOtherCharges((list) => [...list, { label: '', amount: 0 }]);
  const updateOtherCharge = (i: number, patch: Partial<OtherChargeRow>) =>
    setOtherCharges((list) =>
      list.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );
  const removeOtherCharge = (i: number) =>
    setOtherCharges((list) => list.filter((_, idx) => idx !== i));

  // ── Submit ───────────────────────────────────────────────────────────────
  const doSubmit = async () => {
    if (busy) return;
    if (stepError) {
      toast.error(stepError);
      return;
    }
    if (!preview) {
      toast.error('ยังไม่มีข้อมูลตัวอย่าง');
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        periodStart,
        periodEnd,
      };
      if (utilityMode === 'manual' && manualUtilityPayload) {
        body.utilityManual = manualUtilityPayload;
      }
      const cleanOthers = otherCharges
        .filter((r) => r.label.trim() && r.amount > 0)
        .map((r) => ({ label: r.label.trim(), amount: Number(r.amount) }));
      if (cleanOthers.length > 0) body.otherCharges = cleanOthers;
      const trimmedNotes = notes.trim();
      if (trimmedNotes) body.notes = trimmedNotes;

      const res = await fetch(
        `/api/contracts/${contractId}/renewal/execute`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg =
          typeof json === 'object' && json && 'error' in json
            ? String((json as { error?: unknown }).error ?? `HTTP ${res.status}`)
            : `HTTP ${res.status}`;
        throw new Error(errMsg);
      }
      const result = json as ExecuteResponse;
      if (result.reused) {
        toast.info(
          'งวดนี้มีใบแจ้งหนี้อยู่แล้ว',
          'ระบบนำใบแจ้งหนี้เดิมกลับมาใช้ (idempotent)',
        );
      } else {
        toast.success(
          'สร้างใบแจ้งหนี้งวดถัดไปสำเร็จ',
          `ยอดรวม ฿${fmtBaht(result.total)}`,
        );
      }
      onSuccess?.({
        folioId: result.folioId,
        invoiceId: result.invoiceId,
        total: result.total,
        reused: result.reused,
      });
      onClose();
    } catch (e) {
      toast.error(
        'สร้างใบแจ้งหนี้งวดถัดไปไม่สำเร็จ',
        e instanceof Error ? e.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  };

  // ── Stepper header ───────────────────────────────────────────────────────
  const Stepper = (
    <div
      style={{
        display: 'flex',
        gap: 6,
        marginBottom: 18,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      {STEPS.map((s, i) => {
        const active = step === s.id;
        const done = step > s.id;
        return (
          <div
            key={s.id}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: done
                  ? 'var(--success, #22c55e)'
                  : active
                    ? 'var(--primary-light, #3b82f6)'
                    : 'var(--surface-muted)',
                color: done || active ? '#fff' : 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {done ? '✓' : s.id}
            </div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span
                style={{
                  width: 18,
                  height: 1,
                  background: 'var(--border-default)',
                  margin: '0 4px',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );

  // ── Live summary card shown on every step (below content) ────────────────
  const SummaryCard = preview ? (
    <div
      className="pms-card pms-transition"
      style={{
        padding: 12,
        borderRadius: 10,
        border: '1px solid var(--border-default)',
        background: 'var(--surface-subtle)',
        fontSize: 12.5,
        marginTop: 14,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          color: 'var(--text-secondary)',
          marginBottom: 6,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>
          ตัวอย่างใบแจ้งหนี้งวด {fmtDate(preview.nextPeriodStart)} →{' '}
          {fmtDate(preview.nextPeriodEnd)}
        </span>
        {previewLoading && (
          <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
            กำลังคำนวณ…
          </span>
        )}
      </div>
      <PriceRow label="ค่าเช่าห้อง" value={preview.baseRent} />
      {preview.furnitureRent > 0 && (
        <PriceRow label="ค่าเฟอร์นิเจอร์" value={preview.furnitureRent} />
      )}
      {preview.utilityWater !== null && preview.utilityWater > 0 && (
        <PriceRow label="ค่าน้ำประปา" value={preview.utilityWater} />
      )}
      {preview.utilityElectric !== null && preview.utilityElectric > 0 && (
        <PriceRow label="ค่าไฟฟ้า" value={preview.utilityElectric} />
      )}
      {preview.otherCharges.map((c, i) => (
        <PriceRow key={`svc-${i}`} label={c.label} value={c.amount} />
      ))}
      {otherCharges
        .filter((r) => r.label.trim() && r.amount > 0)
        .map((r, i) => (
          <PriceRow key={`usr-${i}`} label={r.label.trim()} value={r.amount} />
        ))}
      <div
        style={{
          borderTop: '1px dashed var(--border-default)',
          marginTop: 6,
          paddingTop: 6,
        }}
      />
      <PriceRow
        label="รวมทั้งสิ้น (จากเซิร์ฟเวอร์)"
        value={
          preview.total +
          otherCharges
            .filter((r) => r.label.trim() && r.amount > 0)
            .reduce((s, r) => s + Number(r.amount), 0)
        }
        bold
      />
      {preview.warnings.length > 0 && (
        <ul
          style={{
            margin: '8px 0 0',
            paddingLeft: 18,
            color: '#854d0e',
            fontSize: 11.5,
          }}
        >
          {preview.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  ) : null;

  // ── Footer ───────────────────────────────────────────────────────────────
  const footer = (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={onClose}
        disabled={busy}
      >
        ปิด
      </Button>
      {step > 1 && (
        <Button
          type="button"
          variant="secondary"
          onClick={goBack}
          disabled={busy}
        >
          ← ย้อนกลับ
        </Button>
      )}
      {step < STEPS.length && (
        <Button
          type="button"
          variant="primary"
          onClick={goNext}
          disabled={busy || !!stepError}
        >
          ถัดไป →
        </Button>
      )}
      {step === STEPS.length && (
        <Button
          type="button"
          variant="primary"
          onClick={doSubmit}
          loading={busy}
          disabled={busy || !!stepError || !preview}
        >
          สร้างใบแจ้งหนี้งวดถัดไป
        </Button>
      )}
    </>
  );

  // The recorded-reading sub-option is only enabled if the server came back
  // with a non-null utilityWater or utilityElectric from the DEFAULT (no
  // override) preview. We capture that via the initial preview result.
  const hasRecordedReading =
    preview !== null &&
    (preview.utilityWater !== null || preview.utilityElectric !== null);

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title={
        preview
          ? `ต่อสัญญา ${preview.contractNumber} · ห้อง ${preview.roomNumber}`
          : 'ต่อสัญญา (สร้างใบแจ้งหนี้งวดถัดไป)'
      }
      size="lg"
      footer={footer}
    >
      {Stepper}

      {/* ── Step 1 · Period confirmation ───────────────────────────────── */}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {preview && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-secondary)',
                padding: '8px 10px',
                background: 'var(--surface-subtle)',
                borderRadius: 8,
                border: '1px solid var(--border-light)',
                lineHeight: 1.7,
              }}
            >
              งวดปัจจุบันสิ้นสุด:{' '}
              <strong>{fmtDate(preview.currentPeriodEnd)}</strong>
              <br />
              งวดถัดไป (แนะนำ): <strong>{fmtDate(preview.nextPeriodStart)}</strong>{' '}
              → <strong>{fmtDate(preview.nextPeriodEnd)}</strong>{' '}
              <span style={{ color: 'var(--text-muted)' }}>
                ({preview.billingCycle === 'calendar' ? 'calendar' : 'rolling'})
              </span>
              {preview.rateChangedFromAmendment && (
                <div style={{ marginTop: 4, color: '#854d0e' }}>
                  ℹ️ ใช้อัตราค่าเช่าจาก amendment: ฿
                  {fmtBaht(preview.effectiveMonthlyRent)}
                </div>
              )}
            </div>
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
            }}
          >
            <Input
              label="วันเริ่มงวด"
              type="date"
              value={periodStart}
              onChange={(e) => {
                setPeriodTouched(true);
                setPeriodStart(e.target.value);
              }}
              required
            />
            <Input
              label="วันสิ้นสุดงวด"
              type="date"
              value={periodEnd}
              onChange={(e) => {
                setPeriodTouched(true);
                setPeriodEnd(e.target.value);
              }}
              required
            />
          </div>
          {previewError && (
            <div
              style={{
                padding: 10,
                background: '#fef2f2',
                border: '1px solid #fca5a5',
                color: '#991b1b',
                borderRadius: 8,
                fontSize: 12.5,
              }}
            >
              {previewError}
              <div style={{ marginTop: 6 }}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => runPreview(periodTouched ? periodStart : undefined)}
                >
                  ลองอีกครั้ง
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 2 · Utilities ─────────────────────────────────────────── */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: 10,
              border: '1px solid var(--border-default)',
              borderRadius: 8,
              background: 'var(--surface-subtle)',
              cursor: hasRecordedReading ? 'pointer' : 'not-allowed',
              opacity: hasRecordedReading ? 1 : 0.6,
            }}
          >
            <input
              type="radio"
              name="utilityMode"
              value="recorded"
              checked={utilityMode === 'recorded'}
              disabled={!hasRecordedReading}
              onChange={() => setUtilityMode('recorded')}
              style={{ marginTop: 3 }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}
              >
                ใช้เลขมิเตอร์ที่บันทึกไว้
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  marginTop: 2,
                }}
              >
                {hasRecordedReading ? (
                  <>
                    น้ำ: ฿{fmtBaht(preview?.utilityWater ?? 0)} · ไฟ: ฿
                    {fmtBaht(preview?.utilityElectric ?? 0)}
                  </>
                ) : (
                  'ไม่มีเลขมิเตอร์สำหรับเดือนนี้ — ต้องระบุด้วยตนเอง'
                )}
              </div>
            </div>
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: 10,
              border: '1px solid var(--border-default)',
              borderRadius: 8,
              background: 'var(--surface-subtle)',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="utilityMode"
              value="manual"
              checked={utilityMode === 'manual'}
              onChange={() => setUtilityMode('manual')}
              style={{ marginTop: 3 }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}
              >
                ระบุด้วยตนเอง
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  marginTop: 2,
                }}
              >
                กรอกเลขมิเตอร์เดิม/ปัจจุบันและอัตรา — เซิร์ฟเวอร์จะคำนวณค่าให้
              </div>
            </div>
          </label>

          {utilityMode === 'manual' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
              }}
            >
              <UtilitySide
                title="ค่าน้ำ"
                form={waterForm}
                onChange={setWaterForm}
              />
              <UtilitySide
                title="ค่าไฟ"
                form={electricForm}
                onChange={setElectricForm}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Step 3 · Other charges ─────────────────────────────────────── */}
      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>
              ค่าใช้จ่ายอื่น (เพิ่มเติม)
            </strong>
            <Button
              type="button"
              variant="secondary"
              onClick={addOtherCharge}
            >
              + เพิ่มรายการ
            </Button>
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--text-muted)',
              lineHeight: 1.5,
            }}
          >
            ตัวอย่างชื่อรายการ:{' '}
            {OTHER_CHARGE_SUGGESTIONS.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() =>
                  setOtherCharges((list) => [...list, { label: s, amount: 0 }])
                }
                style={{
                  margin: '0 4px 4px 0',
                  padding: '2px 8px',
                  border: '1px solid var(--border-light)',
                  borderRadius: 12,
                  background: 'var(--surface-subtle)',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                + {s}
              </button>
            ))}
          </div>
          {otherCharges.length === 0 ? (
            <div
              style={{
                padding: 16,
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--text-muted)',
                border: '1px dashed var(--border-default)',
                borderRadius: 8,
              }}
            >
              ยังไม่มีรายการเพิ่มเติม
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {otherCharges.map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 160px 40px',
                    gap: 8,
                    alignItems: 'end',
                  }}
                >
                  <Input
                    label={i === 0 ? 'ชื่อรายการ' : undefined}
                    value={r.label}
                    onChange={(e) =>
                      updateOtherCharge(i, { label: e.target.value })
                    }
                    placeholder="เช่น ค่าที่จอดรถเพิ่ม"
                  />
                  <Input
                    label={i === 0 ? 'ยอด (บาท)' : undefined}
                    type="number"
                    min={0}
                    step="0.01"
                    value={String(r.amount)}
                    onChange={(e) =>
                      updateOtherCharge(i, {
                        amount: Number(e.target.value) || 0,
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => removeOtherCharge(i)}
                    style={{ padding: '6px 10px' }}
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Step 4 · Review ─────────────────────────────────────────────── */}
      {step === 4 && preview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            className="pms-card pms-transition"
            style={{
              padding: 14,
              borderRadius: 10,
              border: '1px solid var(--border-default)',
              background: 'var(--surface-subtle)',
            }}
          >
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: '160px 1fr',
                gap: '6px 12px',
                fontSize: 13,
                margin: 0,
              }}
            >
              <dt style={{ color: 'var(--text-muted)' }}>สัญญา</dt>
              <dd style={{ margin: 0 }}>
                {preview.contractNumber} · {preview.guestName}
              </dd>

              <dt style={{ color: 'var(--text-muted)' }}>ห้อง</dt>
              <dd style={{ margin: 0 }}>{preview.roomNumber}</dd>

              <dt style={{ color: 'var(--text-muted)' }}>ช่วงงวด</dt>
              <dd style={{ margin: 0 }}>
                {fmtDate(periodStart)} → {fmtDate(periodEnd)}
              </dd>

              <dt style={{ color: 'var(--text-muted)' }}>ค่าน้ำ-ไฟ</dt>
              <dd style={{ margin: 0 }}>
                {utilityMode === 'recorded'
                  ? 'ใช้เลขมิเตอร์ที่บันทึกไว้'
                  : 'ระบุด้วยตนเอง'}
              </dd>
            </dl>
          </div>

          {/* Re-use the live summary card for the canonical breakdown */}
          {SummaryCard}

          <Textarea
            label="หมายเหตุ"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="หมายเหตุเพิ่มเติม (ไม่บังคับ)"
            hint={`${notes.length} / 500 ตัวอักษร`}
          />
        </div>
      )}

      {/* Live summary always visible on steps 1-3; step 4 renders its own */}
      {step < 4 && SummaryCard}

      {stepError && (
        <div
          style={{
            marginTop: 12,
            padding: '8px 12px',
            borderRadius: 8,
            background: '#fef2f2',
            color: '#991b1b',
            fontSize: 12,
            border: '1px solid #fecaca',
          }}
        >
          {stepError}
        </div>
      )}
    </Dialog>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function UtilitySide({
  title,
  form,
  onChange,
}: {
  title: string;
  form: UtilitySideForm;
  onChange: (next: UtilitySideForm) => void;
}) {
  return (
    <div
      style={{
        padding: 12,
        border: '1px solid var(--border-default)',
        borderRadius: 8,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--text-secondary)',
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Input
          label="เลขเดิม"
          type="number"
          min={0}
          step="0.01"
          value={form.prev}
          onChange={(e) => onChange({ ...form, prev: e.target.value })}
        />
        <Input
          label="เลขปัจจุบัน"
          type="number"
          min={0}
          step="0.01"
          value={form.curr}
          onChange={(e) => onChange({ ...form, curr: e.target.value })}
        />
        <Input
          label="อัตรา (บาท/หน่วย)"
          type="number"
          min={0}
          step="0.01"
          value={form.rate}
          onChange={(e) => onChange({ ...form, rate: e.target.value })}
        />
      </div>
    </div>
  );
}

function PriceRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: number;
  bold?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '2px 0',
        fontWeight: bold ? 700 : 500,
        color: bold ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}
    >
      <span>{label}</span>
      <span style={{ fontFamily: 'monospace' }}>฿{fmtBaht(value)}</span>
    </div>
  );
}
