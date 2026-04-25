'use client';

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';

type Size = 'sm' | 'md' | 'lg' | 'xl';

const WIDTHS: Record<Size, number> = { sm: 400, md: 560, lg: 760, xl: 960 };

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  size?: Size;
  children: React.ReactNode;
  footer?: React.ReactNode;
  dismissOnBackdrop?: boolean;
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
  footer,
  dismissOnBackdrop = true,
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'pms-dialog-title' : undefined}
      onMouseDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 1000,
        animation: 'pms-dialog-fade 150ms ease',
      }}
    >
      <div
        ref={ref}
        style={{
          background: 'var(--surface-card)',
          color: 'var(--text-primary)',
          borderRadius: 14,
          width: '100%',
          maxWidth: WIDTHS[size],
          maxHeight: 'calc(100vh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
          border: '1px solid var(--border-default)',
          animation: 'pms-dialog-scale 150ms ease',
        }}
      >
        {(title || description) && (
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-light)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
            }}
          >
            <div style={{ flex: 1 }}>
              {title && (
                <div id="pms-dialog-title" style={{ fontSize: 17, fontWeight: 600 }}>
                  {title}
                </div>
              )}
              {description && (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                  {description}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="ปิด"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                padding: 4,
                borderRadius: 6,
              }}
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div style={{ padding: 20, overflow: 'auto', flex: 1 }}>{children}</div>
        {footer && (
          <div
            style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--border-light)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              background: 'var(--surface-subtle)',
              borderBottomLeftRadius: 14,
              borderBottomRightRadius: 14,
            }}
          >
            {footer}
          </div>
        )}
      </div>
      <style>{`
        @keyframes pms-dialog-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pms-dialog-scale { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
}

type ConfirmProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = 'ยืนยัน',
  cancelText = 'ยกเลิก',
  variant = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  return (
    <Dialog
      open={open}
      onClose={loading ? () => {} : onCancel}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelText}
          </Button>
          <Button variant={variant} onClick={() => void onConfirm()} loading={loading}>
            {confirmText}
          </Button>
        </>
      }
    >
      <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
        {description ?? 'ดำเนินการต่อหรือไม่?'}
      </div>
    </Dialog>
  );
}
