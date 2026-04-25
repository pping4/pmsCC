'use client';

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

/**
 * Reusable React error boundary.
 * - Catches render-time errors in its subtree
 * - Renders a themed fallback card using CSS vars
 * - "ลองใหม่" button resets internal state and invokes onReset (if provided)
 *
 * NOTE: React error boundaries must be class components (no hook equivalent).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Caught error:', error, info);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;

    const message = this.state.error?.message ?? 'ไม่ทราบสาเหตุ';

    return (
      <div
        role="alert"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          minHeight: 240,
          width: '100%',
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: '100%',
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            borderRadius: 12,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--danger)',
            }}
          >
            <AlertTriangle size={28} aria-hidden="true" />
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--text-primary)',
            }}
          >
            เกิดข้อผิดพลาด
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              color: 'var(--text-secondary)',
              wordBreak: 'break-word',
            }}
          >
            {message}
          </p>
          <Button variant="primary" size="md" onClick={this.handleReset}>
            ลองใหม่
          </Button>
        </div>
      </div>
    );
  }
}
