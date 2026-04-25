'use client';

import React from 'react';

type Props = React.HTMLAttributes<HTMLDivElement> & {
  padding?: number | string;
  title?: React.ReactNode;
  actions?: React.ReactNode;
  subtle?: boolean;
};

export function Card({ padding = 16, title, actions, subtle, children, style, ...rest }: Props) {
  return (
    <div
      className="pms-card pms-transition"
      style={{
        background: subtle ? 'var(--surface-subtle)' : 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 12,
        padding: title || actions ? 0 : padding,
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
      {...rest}
    >
      {(title || actions) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-light)',
          }}
        >
          {title && (
            <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
              {title}
            </div>
          )}
          {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
        </div>
      )}
      {title || actions ? <div style={{ padding }}>{children}</div> : children}
    </div>
  );
}
