'use client';

import { Loader2 } from 'lucide-react';

type Props = {
  size?: number;
  label?: string;
  fullPage?: boolean;
  inline?: boolean;
};

export function LoadingSpinner({ size = 20, label, fullPage, inline }: Props) {
  const spinner = (
    <Loader2
      size={size}
      style={{
        color: 'var(--primary-light)',
        animation: 'pms-spin 0.8s linear infinite',
      }}
      aria-hidden="true"
    />
  );

  if (inline) {
    return (
      <span
        role="status"
        aria-live="polite"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        {spinner}
        {label && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>}
        <SpinKeyframes />
      </span>
    );
  }

  const content = (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 24,
      }}
    >
      {spinner}
      {label && (
        <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{label}</span>
      )}
      <SpinKeyframes />
    </div>
  );

  if (fullPage) {
    return (
      <div
        style={{
          minHeight: '60vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {content}
      </div>
    );
  }

  return content;
}

function SpinKeyframes() {
  return (
    <style>{`
      @keyframes pms-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `}</style>
  );
}
