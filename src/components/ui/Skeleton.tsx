'use client';

import React from 'react';

type Props = {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: React.CSSProperties;
  className?: string;
};

export function Skeleton({ width = '100%', height = 16, radius = 6, style, className }: Props) {
  return (
    <>
      <span
        aria-hidden="true"
        className={className}
        style={{
          display: 'inline-block',
          width,
          height,
          borderRadius: radius,
          background:
            'linear-gradient(90deg, var(--surface-subtle) 0%, var(--surface-muted) 50%, var(--surface-subtle) 100%)',
          backgroundSize: '200% 100%',
          animation: 'pms-skeleton 1.2s ease-in-out infinite',
          ...style,
        }}
      />
      <style>{`
        @keyframes pms-skeleton {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </>
  );
}

export function SkeletonRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: 'flex', gap: 12 }}>
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} height={14} width={`${100 / columns}%`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="pms-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Skeleton height={14} width="40%" />
      <Skeleton height={28} width="60%" />
      <Skeleton height={12} width="80%" />
    </div>
  );
}
