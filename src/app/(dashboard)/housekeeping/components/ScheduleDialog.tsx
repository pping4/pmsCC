'use client';

/**
 * ScheduleDialog — 4-step wizard to create a recurring CleaningSchedule.
 *
 * Follows `.claude/skills/multi-step-dialog-wizard.md`:
 *   stepper header · per-step validation · Back/Next/Cancel · summary on step 4.
 *
 * Either cadenceDays OR weekdays must be set (API enforces XOR). Monthly
 * bookings only — caller is responsible for gating visibility.
 */

import { useState, useEffect, useMemo } from 'react';
import { Dialog, Button, Input, Select, Textarea, useToast } from '@/components/ui';
import { fmtDate, fmtBaht, toDateStr } from '@/lib/date-format';

type Priority = 'low' | 'normal' | 'high' | 'urgent';
type Mode     = 'cadence' | 'weekdays';

interface Props {
  open: boolean;
  onClose: () => void;
  roomId: string;
  roomNumber: string;
  bookingId: string;
  guestName?: string;
  onCreated?: () => void;
}

// bitmask: Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64
const WEEKDAYS: Array<{ bit: number; short: string; full: string }> = [
  { bit: 1,  short: 'จ.', full: 'จันทร์' },
  { bit: 2,  short: 'อ.', full: 'อังคาร' },
  { bit: 4,  short: 'พ.', full: 'พุธ' },
  { bit: 8,  short: 'พฤ.', full: 'พฤหัสบดี' },
  { bit: 16, short: 'ศ.', full: 'ศุกร์' },
  { bit: 32, short: 'ส.', full: 'เสาร์' },
  { bit: 64, short: 'อา.', full: 'อาทิตย์' },
];

function weekdaysLabel(mask: number): string {
  return WEEKDAYS.filter(w => (mask & w.bit) !== 0).map(w => w.full).join(', ');
}

const STEPS = [
  { id: 1, label: 'รอบ' },
  { id: 2, label: 'ช่วงเวลา' },
  { id: 3, label: 'ค่าบริการ' },
  { id: 4, label: 'สรุป' },
];

export default function ScheduleDialog({
  open, onClose, roomId, roomNumber, bookingId, guestName, onCreated,
}: Props) {
  const toast = useToast();

  const [step, setStep] = useState(1);

  // Step 1 — recurrence
  const [mode, setMode]               = useState<Mode>('weekdays');
  const [cadenceDays, setCadenceDays] = useState<string>('7');
  const [weekdayMask, setWeekdayMask] = useState<number>(1); // Mon

  // Step 2 — window
  const [activeFrom, setActiveFrom]   = useState<string>(toDateStr(new Date()));
  const [activeUntil, setActiveUntil] = useState<string>('');
  const [timeOfDay, setTimeOfDay]     = useState<string>('10:00');

  // Step 3 — charge & priority
  const [chargeable, setChargeable] = useState<boolean>(true);
  const [fee, setFee]               = useState<string>('300');
  const [priority, setPriority]     = useState<Priority>('normal');
  const [notes, setNotes]           = useState<string>('');

  const [busy, setBusy] = useState(false);

  // Reset when reopened
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setMode('weekdays');
    setCadenceDays('7');
    setWeekdayMask(1);
    setActiveFrom(toDateStr(new Date()));
    setActiveUntil('');
    setTimeOfDay('10:00');
    setChargeable(true);
    setFee('300');
    setPriority('normal');
    setNotes('');
  }, [open]);

  // ── Per-step validation ───────────────────────────────────────────────────
  const stepError = useMemo<string | null>(() => {
    if (step === 1) {
      if (mode === 'cadence') {
        const n = Number(cadenceDays);
        if (!Number.isInteger(n) || n < 1 || n > 365) return 'ค่าจำนวนวันต้องอยู่ 1-365';
      } else if (weekdayMask < 1 || weekdayMask > 127) {
        return 'เลือกอย่างน้อย 1 วันในสัปดาห์';
      }
    }
    if (step === 2) {
      if (!activeFrom) return 'ระบุวันเริ่มต้น';
      if (activeUntil && activeUntil < activeFrom) return 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม';
      if (!/^\d{2}:\d{2}$/.test(timeOfDay)) return 'เวลารูปแบบ HH:mm';
    }
    if (step === 3) {
      if (chargeable) {
        const f = Number(fee);
        if (!Number.isFinite(f) || f < 0) return 'ค่าบริการต้องเป็นตัวเลข ≥ 0';
      }
    }
    return null;
  }, [step, mode, cadenceDays, weekdayMask, activeFrom, activeUntil, timeOfDay, chargeable, fee]);

  const toggleWeekday = (bit: number) => {
    setWeekdayMask(m => m ^ bit);
  };

  const goNext = () => {
    if (stepError) {
      toast.error(stepError);
      return;
    }
    setStep(s => Math.min(4, s + 1));
  };
  const goBack = () => setStep(s => Math.max(1, s - 1));

  const summarySentence = useMemo(() => {
    const recur = mode === 'cadence'
      ? `ทุก ${cadenceDays} วัน`
      : `ทุกวัน${weekdaysLabel(weekdayMask)}`;
    const window = activeUntil
      ? `เริ่ม ${fmtDate(activeFrom)} ถึง ${fmtDate(activeUntil)}`
      : `เริ่ม ${fmtDate(activeFrom)} ต่อเนื่อง`;
    const charge = chargeable && Number(fee) > 0
      ? ` ค่าบริการ ฿${fmtBaht(Number(fee))} ต่อรอบ`
      : ' ไม่เก็บค่าบริการ';
    return `จะทำความสะอาด ${recur} เวลา ${timeOfDay} ${window}${charge}`;
  }, [mode, cadenceDays, weekdayMask, activeFrom, activeUntil, timeOfDay, chargeable, fee]);

  const submit = async () => {
    if (busy) return;
    if (stepError) { toast.error(stepError); return; }
    setBusy(true);
    try {
      const body = {
        roomId,
        bookingId,
        cadenceDays: mode === 'cadence'  ? Number(cadenceDays) : null,
        weekdays:    mode === 'weekdays' ? weekdayMask          : null,
        timeOfDay,
        activeFrom:  new Date(`${activeFrom}T00:00:00`).toISOString(),
        activeUntil: activeUntil ? new Date(`${activeUntil}T23:59:59`).toISOString() : null,
        fee:         chargeable ? Number(fee) : null,
        chargeable,
        notes:       notes.trim() || null,
        priority,
      };
      const res = await fetch('/api/housekeeping/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success('ตั้งรอบทำความสะอาดสำเร็จ', `ห้อง ${roomNumber}`);
      onCreated?.();
      onClose();
    } catch (e) {
      toast.error('ตั้งรอบไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  // ── Stepper ───────────────────────────────────────────────────────────────
  const Stepper = (
    <div style={{
      display: 'flex', gap: 6, marginBottom: 18, alignItems: 'center',
      padding: '4px 0', flexWrap: 'wrap',
    }}>
      {STEPS.map((s, i) => {
        const active = step === s.id;
        const done   = step > s.id;
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: done ? 'var(--success, #22c55e)' : active ? 'var(--primary-light, #3b82f6)' : 'var(--surface-muted)',
              color: done || active ? '#fff' : 'var(--text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700,
            }}>
              {done ? '✓' : s.id}
            </div>
            <span style={{
              fontSize: 12, fontWeight: 600,
              color: active ? 'var(--text-primary)' : 'var(--text-muted)',
            }}>{s.label}</span>
            {i < STEPS.length - 1 && (
              <span style={{ width: 18, height: 1, background: 'var(--border-default)', margin: '0 4px' }} />
            )}
          </div>
        );
      })}
    </div>
  );

  // ── Footer buttons ────────────────────────────────────────────────────────
  const footer = (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>ยกเลิก</Button>
      {step > 1 && <Button variant="secondary" onClick={goBack} disabled={busy}>← ย้อนกลับ</Button>}
      {step < 4 && <Button variant="primary" onClick={goNext} disabled={busy}>ถัดไป →</Button>}
      {step === 4 && <Button variant="primary" onClick={submit} loading={busy}>ยืนยันสร้างรอบ</Button>}
    </>
  );

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title={`ตั้งรอบทำความสะอาด · ห้อง ${roomNumber}`}
      description={guestName ? `แขก: ${guestName}` : undefined}
      size="lg"
      footer={footer}
    >
      {Stepper}

      {/* ─── Step 1 — Recurrence ─────────────────────────────────────────── */}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="radio" name="mode" checked={mode === 'cadence'}
                     onChange={() => setMode('cadence')} />
              <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>ทุก N วัน</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="radio" name="mode" checked={mode === 'weekdays'}
                     onChange={() => setMode('weekdays')} />
              <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>วันในสัปดาห์</span>
            </label>
          </div>

          {mode === 'cadence' ? (
            <Input
              label="จำนวนวัน"
              type="number"
              min={1}
              max={365}
              value={cadenceDays}
              onChange={(e) => setCadenceDays(e.target.value)}
              hint="เช่น 7 = ทุก 7 วัน"
              required
            />
          ) : (
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, color: 'var(--text-primary)' }}>
                เลือกวัน <span style={{ color: 'var(--danger)' }}>*</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {WEEKDAYS.map(w => {
                  const on = (weekdayMask & w.bit) !== 0;
                  return (
                    <button
                      key={w.bit}
                      type="button"
                      onClick={() => toggleWeekday(w.bit)}
                      className="pms-transition"
                      style={{
                        padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                        cursor: 'pointer',
                        background: on ? 'var(--primary-light, #3b82f6)' : 'var(--surface-muted)',
                        color:      on ? '#fff' : 'var(--text-muted)',
                        border: `1px solid ${on ? 'var(--primary-light, #3b82f6)' : 'var(--border-default)'}`,
                        minWidth: 52,
                      }}
                    >
                      {w.short}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                {weekdayMask > 0 ? weekdaysLabel(weekdayMask) : 'ยังไม่ได้เลือกวัน'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Step 2 — Window ─────────────────────────────────────────────── */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="เริ่มตั้งแต่" type="date"
              value={activeFrom}
              onChange={(e) => setActiveFrom(e.target.value)}
              required
            />
            <Input
              label="สิ้นสุด (ไม่บังคับ)" type="date"
              value={activeUntil}
              onChange={(e) => setActiveUntil(e.target.value)}
              hint="ว่าง = ไม่มีกำหนด"
            />
          </div>
          <Input
            label="เวลาทำความสะอาด"
            type="time"
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(e.target.value)}
            hint="รูปแบบ HH:mm เช่น 10:00"
            required
          />
        </div>
      )}

      {/* ─── Step 3 — Charge & priority ──────────────────────────────────── */}
      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer',
            padding: '8px 10px', background: 'var(--surface-subtle)',
            borderRadius: 8, border: '1px solid var(--border-light)',
          }}>
            <input type="checkbox" checked={chargeable} onChange={(e) => setChargeable(e.target.checked)} />
            <span>เก็บค่าบริการ (ลง folio อัตโนมัติทุกรอบ)</span>
          </label>

          {chargeable && (
            <Input
              label="ค่าบริการต่อรอบ (บาท)"
              type="number" min={0} step="0.01"
              value={fee} onChange={(e) => setFee(e.target.value)}
              required
            />
          )}

          <Select
            label="ลำดับความสำคัญ"
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
          >
            <option value="low">ต่ำ</option>
            <option value="normal">ปกติ</option>
            <option value="high">สูง</option>
            <option value="urgent">ด่วนมาก</option>
          </Select>

          <Textarea
            label="หมายเหตุ"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="เช่น ให้เข้าหลัง 14:00 (ไม่บังคับ)"
            rows={3}
            maxLength={1000}
          />
        </div>
      )}

      {/* ─── Step 4 — Summary ────────────────────────────────────────────── */}
      {step === 4 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="pms-card" style={{
            padding: 14, borderRadius: 10,
            border: '1px solid var(--border-default)',
            background: 'var(--surface-subtle)',
            fontSize: 14, lineHeight: 1.5, color: 'var(--text-primary)',
          }}>
            {summarySentence}
          </div>
          <dl style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '6px 12px', fontSize: 13, margin: 0 }}>
            <dt style={{ color: 'var(--text-muted)' }}>ห้อง</dt><dd style={{ margin: 0 }}>{roomNumber}</dd>
            {guestName && (<><dt style={{ color: 'var(--text-muted)' }}>แขก</dt><dd style={{ margin: 0 }}>{guestName}</dd></>)}
            <dt style={{ color: 'var(--text-muted)' }}>รอบ</dt>
            <dd style={{ margin: 0 }}>
              {mode === 'cadence' ? `ทุก ${cadenceDays} วัน` : weekdaysLabel(weekdayMask)}
            </dd>
            <dt style={{ color: 'var(--text-muted)' }}>เวลา</dt><dd style={{ margin: 0 }}>{timeOfDay}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>ช่วง</dt>
            <dd style={{ margin: 0 }}>{fmtDate(activeFrom)} {activeUntil ? `→ ${fmtDate(activeUntil)}` : '(ต่อเนื่อง)'}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>ค่าบริการ</dt>
            <dd style={{ margin: 0 }}>
              {chargeable && Number(fee) > 0 ? `฿${fmtBaht(Number(fee))} / รอบ` : '— ไม่เก็บ'}
            </dd>
            <dt style={{ color: 'var(--text-muted)' }}>ลำดับความสำคัญ</dt><dd style={{ margin: 0 }}>{priority}</dd>
            {notes && (<><dt style={{ color: 'var(--text-muted)' }}>หมายเหตุ</dt><dd style={{ margin: 0 }}>{notes}</dd></>)}
          </dl>
        </div>
      )}

      {stepError && step !== 4 && (
        <div style={{
          marginTop: 12, padding: '8px 12px', borderRadius: 8,
          background: '#fef2f2', color: '#991b1b', fontSize: 12,
          border: '1px solid #fecaca',
        }}>
          {stepError}
        </div>
      )}
    </Dialog>
  );
}
