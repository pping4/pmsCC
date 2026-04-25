/**
 * BulkRenewalDialog — Sprint 3B Phase I / T20.
 *
 * Operator-facing UI for the bulk contract renewal engine (T15) exposed via
 * `/api/contracts/renewal/bulk` (T17).
 *
 * Flow:
 *   1. User opens the dialog, picks an "as-of date" (defaults to today).
 *   2. Clicks "ดูตัวอย่าง (dry-run)" → POST with `dryRun: true` and renders
 *      the result grouped into succeeded / skipped / failed buckets.
 *   3. If any contract is in the succeeded bucket, "ดำเนินการจริง" enables;
 *      that button opens a ConfirmDialog ("จะสร้างใบแจ้งหนี้ N รายการ, ยืนยันหรือไม่?")
 *      and on confirm POSTs with `dryRun: false`.
 *   4. On a successful real run, a green completion banner is shown and the
 *      parent is notified via `onSuccess()` so the list page can refetch.
 *
 * Architectural notes:
 *   - No direct Prisma access — everything goes through the API route which
 *     enforces manager/admin RBAC on the POST path.
 *   - The service returns only contract IDs, not numbers. We accept an
 *     optional `idToLabel` map from the parent (the list page already knows
 *     each contract's number) so the operator sees human-friendly labels.
 *     Rows without a match degrade to the short id suffix.
 *   - Skip reasons are the service's uppercase constants; we translate them
 *     to Thai in a local dictionary (unknown codes pass through verbatim).
 */

'use client';

import { useMemo, useState } from 'react';
import { Dialog, ConfirmDialog, Button, useToast } from '@/components/ui';
import { toDateStr } from '@/lib/date-format';

// ─── Types mirroring the API envelope ────────────────────────────────────────

interface BulkRenewalResponse {
  ok: boolean;
  dryRun: boolean;
  processed: number;
  succeeded: string[];
  failed: Array<{ contractId: string; error: string }>;
  skipped: Array<{ contractId: string; reason: string }>;
}

interface BulkRenewalDialogProps {
  open: boolean;
  onClose: () => void;
  /** Optional id → human label map (typically contractNumber). */
  idToLabel?: Record<string, string>;
  /** Called after a successful real run (not dry-run). Parent should refetch. */
  onSuccess?: (result: BulkRenewalResponse) => void;
}

// ─── Skip reason translation ─────────────────────────────────────────────────
// Codes come from `runBulkRenewal` in `src/services/renewal.service.ts`.
// Keep this in sync with that file. Unknown codes fall through unchanged.
const SKIP_REASON_TH: Record<string, string> = {
  CONTRACT_EXPIRED_NO_AUTORENEW: 'สัญญาหมดอายุ (ไม่มีต่ออัตโนมัติ)',
  CONTRACT_JUST_EXPIRED:         'เพิ่งหมดอายุ — อัปเดตสถานะเป็น expired แล้ว',
  NOT_DUE_YET:                   'ยังไม่ถึงกำหนดต่อสัญญา',
  PAST_CONTRACT_END:             'เลยวันสิ้นสุดสัญญาแล้ว',
};

function translateSkipReason(code: string): string {
  return SKIP_REASON_TH[code] ?? code;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function labelFor(id: string, map?: Record<string, string>): string {
  if (map && map[id]) return map[id];
  // Last 6 chars of the id — enough to disambiguate in ops.
  return id.length > 8 ? `…${id.slice(-6)}` : id;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function BulkRenewalDialog({
  open,
  onClose,
  idToLabel,
  onSuccess,
}: BulkRenewalDialogProps) {
  const toast = useToast();

  const [asOfDate, setAsOfDate] = useState<string>(() => toDateStr(new Date()));
  const [running,  setRunning]  = useState(false);
  const [preview,  setPreview]  = useState<BulkRenewalResponse | null>(null);
  const [executed, setExecuted] = useState<BulkRenewalResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Reset transient state whenever the dialog closes.
  const handleClose = () => {
    if (running) return;
    setPreview(null);
    setExecuted(null);
    setConfirmOpen(false);
    onClose();
  };

  // ── Dry-run preview ────────────────────────────────────────────────────────
  const handleDryRun = async () => {
    if (running) return;
    setRunning(true);
    setExecuted(null);
    try {
      const res = await fetch('/api/contracts/renewal/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asOfDate, dryRun: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`,
        );
      }
      const payload = data as BulkRenewalResponse;
      setPreview(payload);
      if (payload.succeeded.length === 0) {
        toast.info(
          'ไม่มีสัญญาที่ต้องต่อในวันนี้',
          `ตรวจสอบ ${payload.processed} ฉบับ · ข้าม ${payload.skipped.length}`,
        );
      } else {
        toast.success(
          'โหลดตัวอย่างเรียบร้อย',
          `จะต่อสัญญา ${payload.succeeded.length} ฉบับ`,
        );
      }
    } catch (e) {
      toast.error(
        'ดูตัวอย่างไม่สำเร็จ',
        e instanceof Error ? e.message : undefined,
      );
    } finally {
      setRunning(false);
    }
  };

  // ── Real execution ─────────────────────────────────────────────────────────
  const handleExecute = async () => {
    if (running) return;
    setRunning(true);
    try {
      const res = await fetch('/api/contracts/renewal/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asOfDate, dryRun: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`,
        );
      }
      const payload = data as BulkRenewalResponse;
      setExecuted(payload);
      setPreview(null);
      setConfirmOpen(false);
      if (payload.failed.length > 0) {
        toast.warning(
          'ต่อสัญญาแบบกลุ่มเสร็จสิ้น (มีบางรายการล้มเหลว)',
          `สำเร็จ ${payload.succeeded.length} · ล้มเหลว ${payload.failed.length}`,
        );
      } else {
        toast.success(
          'ต่อสัญญาแบบกลุ่มสำเร็จ',
          `สร้างใบแจ้งหนี้ ${payload.succeeded.length} รายการ`,
        );
      }
      onSuccess?.(payload);
    } catch (e) {
      toast.error(
        'ต่อสัญญาแบบกลุ่มไม่สำเร็จ',
        e instanceof Error ? e.message : undefined,
      );
    } finally {
      setRunning(false);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const current     = executed ?? preview;
  const isCompleted = executed !== null;
  const canExecute  = preview !== null && preview.succeeded.length > 0 && !isCompleted;
  const succeededCount = preview?.succeeded.length ?? 0;

  // ── Result panel renderer (shared between preview and executed views) ─────
  const resultPanel = useMemo(() => {
    if (!current) return null;

    const { succeeded, skipped, failed } = current;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Succeeded */}
        <ResultSection
          title={`จะต่อสัญญา (succeeded)`}
          count={succeeded.length}
          tone="success"
        >
          {succeeded.length === 0 ? (
            <EmptyLine text="— ไม่มี —" />
          ) : (
            <ChipList items={succeeded.map((id) => labelFor(id, idToLabel))} tone="success" />
          )}
        </ResultSection>

        {/* Skipped */}
        <ResultSection
          title="ข้าม (skipped)"
          count={skipped.length}
          tone="warning"
        >
          {skipped.length === 0 ? (
            <EmptyLine text="— ไม่มี —" />
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {skipped.map((s, i) => (
                <li
                  key={`${s.contractId}-${i}`}
                  style={{
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'baseline',
                  }}
                >
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#92400e' }}>
                    {labelFor(s.contractId, idToLabel)}
                  </span>
                  <span>— {translateSkipReason(s.reason)}</span>
                </li>
              ))}
            </ul>
          )}
        </ResultSection>

        {/* Failed */}
        <ResultSection
          title="เกิดข้อผิดพลาด (failed)"
          count={failed.length}
          tone="danger"
        >
          {failed.length === 0 ? (
            <EmptyLine text="— ไม่มี —" />
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {failed.map((f, i) => (
                <li
                  key={`${f.contractId}-${i}`}
                  style={{
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'baseline',
                  }}
                >
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#b91c1c' }}>
                    {labelFor(f.contractId, idToLabel)}
                  </span>
                  <span>— {f.error}</span>
                </li>
              ))}
            </ul>
          )}
        </ResultSection>
      </div>
    );
  }, [current, idToLabel]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Dialog
        open={open}
        onClose={handleClose}
        title="ต่อสัญญาแบบกลุ่ม"
        description="ตรวจสอบสัญญาที่ถึงกำหนดต่ออายุและสร้างใบแจ้งหนี้ให้ทั้งหมดในครั้งเดียว"
        size="lg"
        dismissOnBackdrop={!running}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={handleClose}
              disabled={running}
            >
              ปิด
            </Button>
            <Button
              variant="secondary"
              onClick={handleDryRun}
              loading={running && !confirmOpen && !isCompleted}
              disabled={running || isCompleted}
            >
              ดูตัวอย่าง (dry-run)
            </Button>
            <Button
              variant="primary"
              onClick={() => setConfirmOpen(true)}
              disabled={!canExecute || running}
            >
              ดำเนินการจริง
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ── As-of date picker ──────────────────────────────────────────── */}
          <div
            className="pms-card pms-transition"
            style={{
              padding: 14,
              borderRadius: 10,
              border: '1px solid var(--border-default)',
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <label
              htmlFor="bulk-renewal-asof"
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}
            >
              วันที่อ้างอิง (as-of date)
            </label>
            <input
              id="bulk-renewal-asof"
              type="date"
              value={asOfDate}
              onChange={(e) => {
                setAsOfDate(e.target.value);
                // Stale preview — clear once the date changes.
                setPreview(null);
                setExecuted(null);
              }}
              disabled={running}
              style={{
                padding: '6px 10px',
                border: '1px solid var(--border-default)',
                borderRadius: 6,
                background: 'var(--surface-card)',
                color: 'var(--text-primary)',
                fontSize: 13,
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              สัญญาที่มีงวดถัดไปเริ่มในหรือก่อนวันนี้จะถูกต่ออายุ
            </span>
          </div>

          {/* ── Completion banner (real run only) ────────────────────────── */}
          {isCompleted && executed && (
            <div
              role="status"
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                border: '1px solid #86efac',
                background: '#f0fdf4',
                color: '#166534',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              ดำเนินการเสร็จสิ้น — สำเร็จ {executed.succeeded.length} ฉบับ ·
              ข้าม {executed.skipped.length} · ล้มเหลว {executed.failed.length}
            </div>
          )}

          {/* ── Result grid ─────────────────────────────────────────────── */}
          {current ? (
            <>
              <SummaryStrip res={current} />
              {resultPanel}
            </>
          ) : (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--text-faint)',
                border: '1px dashed var(--border-default)',
                borderRadius: 10,
              }}
            >
              กด &quot;ดูตัวอย่าง (dry-run)&quot; เพื่อตรวจสอบสัญญาที่จะต่ออายุ
            </div>
          )}
        </div>
      </Dialog>

      {/* ── Confirmation dialog ─────────────────────────────────────────── */}
      <ConfirmDialog
        open={confirmOpen}
        title="ยืนยันการต่อสัญญาแบบกลุ่ม"
        description={`จะสร้างใบแจ้งหนี้ ${succeededCount} รายการ, ยืนยันหรือไม่?`}
        confirmText="ยืนยันและดำเนินการ"
        cancelText="ยกเลิก"
        variant="primary"
        loading={running}
        onConfirm={handleExecute}
        onCancel={() => {
          if (!running) setConfirmOpen(false);
        }}
      />
    </>
  );
}

// ─── Small internal presentation components ────────────────────────────────

type Tone = 'success' | 'warning' | 'danger';

const TONE_STYLE: Record<Tone, { border: string; bg: string; fg: string; chipBg: string; chipFg: string }> = {
  success: { border: '#86efac', bg: '#f0fdf4', fg: '#166534', chipBg: '#dcfce7', chipFg: '#166534' },
  warning: { border: '#fcd34d', bg: '#fffbeb', fg: '#92400e', chipBg: '#fef3c7', chipFg: '#92400e' },
  danger:  { border: '#fca5a5', bg: '#fef2f2', fg: '#b91c1c', chipBg: '#fee2e2', chipFg: '#b91c1c' },
};

function ResultSection({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone: Tone;
  children: React.ReactNode;
}) {
  const t = TONE_STYLE[tone];
  return (
    <div
      style={{
        border: `1px solid ${t.border}`,
        background: t.bg,
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: t.fg }}>{title}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 10,
            background: t.chipBg,
            color: t.chipFg,
          }}
        >
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

function ChipList({ items, tone }: { items: string[]; tone: Tone }) {
  const t = TONE_STYLE[tone];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((label, i) => (
        <span
          key={`${label}-${i}`}
          style={{
            fontFamily: 'monospace',
            fontSize: 11,
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: 6,
            background: t.chipBg,
            color: t.chipFg,
            border: `1px solid ${t.border}`,
          }}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic' }}>
      {text}
    </div>
  );
}

function SummaryStrip({ res }: { res: BulkRenewalResponse }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        flexWrap: 'wrap',
        fontSize: 12,
        color: 'var(--text-muted)',
      }}
    >
      <span>
        <strong style={{ color: 'var(--text-primary)' }}>{res.processed}</strong> ตรวจสอบทั้งหมด
      </span>
      <span>·</span>
      <span>
        <strong style={{ color: '#166534' }}>{res.succeeded.length}</strong> สำเร็จ
      </span>
      <span>·</span>
      <span>
        <strong style={{ color: '#92400e' }}>{res.skipped.length}</strong> ข้าม
      </span>
      <span>·</span>
      <span>
        <strong style={{ color: '#b91c1c' }}>{res.failed.length}</strong> ล้มเหลว
      </span>
      <span style={{ marginLeft: 'auto' }}>
        {res.dryRun ? 'โหมด: ตัวอย่าง (dry-run)' : 'โหมด: ดำเนินการจริง'}
      </span>
    </div>
  );
}
