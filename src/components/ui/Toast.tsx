'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

type Toast = {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration: number;
};

type ToastContextValue = {
  show: (t: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastContextValue['show']>((t) => {
    const id = Math.random().toString(36).slice(2);
    const duration = t.duration ?? 4000;
    setToasts((prev) => [...prev, { id, duration, ...t }]);
  }, []);

  const value: ToastContextValue = {
    show,
    success: (title, description) => show({ type: 'success', title, description }),
    error: (title, description) => show({ type: 'error', title, description, duration: 6000 }),
    warning: (title, description) => show({ type: 'warning', title, description }),
    info: (title, description) => show({ type: 'info', title, description }),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
          maxWidth: 'min(92vw, 400px)',
        }}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const ICONS = {
  success: { Icon: CheckCircle2, color: 'var(--success)', bg: '#f0fdf4', border: '#86efac' },
  error: { Icon: XCircle, color: 'var(--danger)', bg: '#fef2f2', border: '#fca5a5' },
  warning: { Icon: AlertTriangle, color: 'var(--warning)', bg: '#fffbeb', border: '#fcd34d' },
  info: { Icon: Info, color: 'var(--primary-light)', bg: '#eff6ff', border: '#93c5fd' },
} as const;

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const { Icon, color, bg, border } = ICONS[toast.type];

  useEffect(() => {
    const t = setTimeout(() => {
      setLeaving(true);
      setTimeout(onClose, 200);
    }, toast.duration);
    return () => clearTimeout(t);
  }, [toast.duration, onClose]);

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      style={{
        pointerEvents: 'auto',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 10,
        padding: '12px 14px',
        boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'translateX(20px)' : 'translateX(0)',
        transition: 'all 200ms ease',
      }}
    >
      <Icon size={20} style={{ color, flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
          {toast.title}
        </div>
        {toast.description && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            {toast.description}
          </div>
        )}
      </div>
      <button
        onClick={() => {
          setLeaving(true);
          setTimeout(onClose, 200);
        }}
        aria-label="ปิด"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 2,
          color: 'var(--text-muted)',
          flexShrink: 0,
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
