'use client';

/**
 * ChangePasswordDialog — Sprint 4A / A-T10.
 *
 * Self-service password change accessible from the header. Calls
 * POST /api/me/password with { currentPassword, newPassword } and shows
 * server-side validation errors inline (weak password, wrong current
 * password, etc.). The server is the trust boundary — the dialog never
 * trusts its own client-side checks.
 *
 * Intentionally vanilla JSX + inline styles to match the rest of
 * components/layout/* (no extra UI-framework dependency).
 */

import { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ChangePasswordDialog({ open, onClose }: Props) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Reset state on open; autofocus first field.
  useEffect(() => {
    if (!open) return;
    setCurrentPassword('');
    setNewPassword('');
    setConfirm('');
    setError(null);
    setOk(false);
    setBusy(false);
    const t = setTimeout(() => firstFieldRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Client-side pre-checks (server still validates authoritatively).
    if (newPassword.length < 8) {
      setError('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
      return;
    }
    if (newPassword !== confirm) {
      setError('รหัสผ่านใหม่และยืนยันไม่ตรงกัน');
      return;
    }
    if (currentPassword === newPassword) {
      setError('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `เปลี่ยนรหัสผ่านไม่สำเร็จ (HTTP ${res.status})`);
        return;
      }
      setOk(true);
      setTimeout(onClose, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pms-change-pw-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          width: '100%',
          maxWidth: 420,
          padding: 20,
          boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
        }}
      >
        <h2
          id="pms-change-pw-title"
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: 4,
          }}
        >
          เปลี่ยนรหัสผ่าน
        </h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
          เพื่อความปลอดภัยของบัญชีของคุณ
        </p>

        <Field
          label="รหัสผ่านปัจจุบัน"
          type="password"
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
          disabled={busy || ok}
          inputRef={firstFieldRef}
          required
        />
        <Field
          label="รหัสผ่านใหม่ (≥ 8 ตัวอักษร)"
          type="password"
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          disabled={busy || ok}
          required
        />
        <Field
          label="ยืนยันรหัสผ่านใหม่"
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          disabled={busy || ok}
          required
        />

        {error && (
          <div
            role="alert"
            style={{
              marginTop: 10,
              padding: '8px 10px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              borderRadius: 8,
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}
        {ok && (
          <div
            role="status"
            style={{
              marginTop: 10,
              padding: '8px 10px',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              color: '#166534',
              borderRadius: 8,
              fontSize: 12,
            }}
          >
            เปลี่ยนรหัสผ่านเรียบร้อย ✓
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={btnSecondary}
          >
            ยกเลิก
          </button>
          <button type="submit" disabled={busy || ok} style={btnPrimary}>
            {busy ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Local helpers ──────────────────────────────────────────────────────────
function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
  disabled,
  required,
  inputRef,
}: {
  label: string;
  type: 'password' | 'text';
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  disabled?: boolean;
  required?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <input
        ref={inputRef}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        disabled={disabled}
        required={required}
        style={{
          width: '100%',
          padding: '8px 10px',
          fontSize: 13,
          border: '1px solid var(--border-default)',
          borderRadius: 8,
          background: 'var(--surface-muted)',
          color: 'var(--text-primary)',
        }}
      />
    </label>
  );
}

const btnSecondary: React.CSSProperties = {
  padding: '7px 14px',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  background: 'var(--surface-muted)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  cursor: 'pointer',
};

const btnPrimary: React.CSSProperties = {
  padding: '7px 14px',
  fontSize: 13,
  fontWeight: 700,
  color: '#fff',
  background: 'linear-gradient(135deg, #1e40af, #3b82f6)',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
};
