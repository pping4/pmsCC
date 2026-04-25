'use client';

import React, { forwardRef, useId } from 'react';

type Size = 'sm' | 'md' | 'lg';

type BaseProps = {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  sizeVariant?: Size;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
  containerStyle?: React.CSSProperties;
};

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & BaseProps;

const SIZES: Record<Size, React.CSSProperties> = {
  sm: { padding: '6px 10px', fontSize: 13, borderRadius: 6, minHeight: 30 },
  md: { padding: '8px 12px', fontSize: 14, borderRadius: 8, minHeight: 36 },
  lg: { padding: '10px 14px', fontSize: 15, borderRadius: 10, minHeight: 42 },
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    required,
    sizeVariant = 'md',
    leftIcon,
    rightIcon,
    fullWidth = true,
    containerStyle,
    disabled,
    id,
    style,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errId = error ? `${inputId}-err` : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: fullWidth ? '100%' : undefined, ...containerStyle }}>
      {label && (
        <label htmlFor={inputId} style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
          {label}
          {required && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
        </label>
      )}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          background: disabled ? 'var(--surface-muted)' : 'var(--surface-card)',
          border: `1px solid ${error ? 'var(--danger)' : 'var(--border-default)'}`,
          ...SIZES[sizeVariant],
          padding: 0,
          transition: 'border-color 150ms ease',
        }}
      >
        {leftIcon && (
          <span style={{ paddingLeft: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          required={required}
          aria-invalid={!!error}
          aria-describedby={[hintId, errId].filter(Boolean).join(' ') || undefined}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'var(--text-primary)',
            ...SIZES[sizeVariant],
            minHeight: 'auto',
            borderRadius: 0,
            width: '100%',
            ...style,
          }}
          {...rest}
        />
        {rightIcon && (
          <span style={{ paddingRight: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
            {rightIcon}
          </span>
        )}
      </div>
      {error && (
        <span id={errId} style={{ fontSize: 12, color: 'var(--danger)' }}>
          {error}
        </span>
      )}
      {!error && hint && (
        <span id={hintId} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {hint}
        </span>
      )}
    </div>
  );
});

type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> & BaseProps;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    hint,
    error,
    required,
    sizeVariant = 'md',
    fullWidth = true,
    containerStyle,
    disabled,
    id,
    children,
    style,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: fullWidth ? '100%' : undefined, ...containerStyle }}>
      {label && (
        <label htmlFor={selectId} style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
          {label}
          {required && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        disabled={disabled}
        required={required}
        aria-invalid={!!error}
        style={{
          ...SIZES[sizeVariant],
          background: disabled ? 'var(--surface-muted)' : 'var(--surface-card)',
          color: 'var(--text-primary)',
          border: `1px solid ${error ? 'var(--danger)' : 'var(--border-default)'}`,
          outline: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          width: '100%',
          ...style,
        }}
        {...rest}
      >
        {children}
      </select>
      {error && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</span>}
      {!error && hint && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{hint}</span>}
    </div>
  );
});

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & BaseProps;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    hint,
    error,
    required,
    fullWidth = true,
    containerStyle,
    disabled,
    id,
    style,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const tid = id ?? autoId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: fullWidth ? '100%' : undefined, ...containerStyle }}>
      {label && (
        <label htmlFor={tid} style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
          {label}
          {required && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
        </label>
      )}
      <textarea
        ref={ref}
        id={tid}
        disabled={disabled}
        required={required}
        aria-invalid={!!error}
        style={{
          padding: '8px 12px',
          fontSize: 14,
          borderRadius: 8,
          minHeight: 72,
          background: disabled ? 'var(--surface-muted)' : 'var(--surface-card)',
          color: 'var(--text-primary)',
          border: `1px solid ${error ? 'var(--danger)' : 'var(--border-default)'}`,
          outline: 'none',
          resize: 'vertical',
          fontFamily: 'inherit',
          width: '100%',
          ...style,
        }}
        {...rest}
      />
      {error && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</span>}
      {!error && hint && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{hint}</span>}
    </div>
  );
});
