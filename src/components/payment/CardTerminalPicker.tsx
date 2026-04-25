/**
 * CardTerminalPicker — Sprint 5 Phase 3.3
 *
 * Picker for EDC terminal + cardBrand. Pulls active terminals from
 * GET /api/edc-terminals?active=1 and filters brand options by the
 * selected terminal's `allowedBrands` (empty = accepts all).
 */
'use client';

import { useEffect, useState } from 'react';
import { Select } from '@/components/ui';
import { CARD_BRANDS, CARD_TYPES } from '@/lib/validations/payment.schema';

interface Terminal {
  id: string;
  code: string;
  name: string;
  acquirerBank: string;
  allowedBrands: string[];
  isActive: boolean;
}

interface Props {
  terminalId?: string;
  cardBrand?: string;
  cardType?: string;
  cardLast4?: string;
  authCode?: string;
  onChange: (v: {
    terminalId?: string;
    cardBrand?: string;
    cardType?: string;
    cardLast4?: string;
    authCode?: string;
  }) => void;
  disabled?: boolean;
}

export function CardTerminalPicker(props: Props) {
  const { terminalId, cardBrand, cardType, cardLast4, authCode, onChange, disabled } = props;
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        const res = await fetch('/api/edc-terminals?active=1');
        if (!res.ok) throw new Error('fetch terminals failed');
        const data = await res.json();
        if (!abort) setTerminals(data.terminals ?? []);
      } catch {
        if (!abort) setTerminals([]);
      } finally {
        if (!abort) setLoading(false);
      }
    })();
    return () => { abort = true; };
  }, []);

  const selected = terminals.find(t => t.id === terminalId);
  const availableBrands =
    !selected || selected.allowedBrands.length === 0
      ? CARD_BRANDS
      : (CARD_BRANDS.filter(b => selected.allowedBrands.includes(b)) as readonly string[]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Select
        label="เครื่อง EDC"
        required
        value={terminalId ?? ''}
        disabled={disabled || loading}
        onChange={(e) => onChange({ ...props, terminalId: e.target.value || undefined, cardBrand: undefined })}
      >
        <option value="">— เลือกเครื่อง —</option>
        {terminals.map(t => (
          <option key={t.id} value={t.id}>
            {t.code} — {t.name} ({t.acquirerBank})
          </option>
        ))}
      </Select>

      <Select
        label="แบรนด์บัตร"
        required
        value={cardBrand ?? ''}
        disabled={disabled || !terminalId}
        onChange={(e) => onChange({ ...props, cardBrand: e.target.value || undefined })}
      >
        <option value="">— เลือกแบรนด์ —</option>
        {availableBrands.map(b => (
          <option key={b} value={b}>{b}</option>
        ))}
      </Select>

      <Select
        label="ประเภทบัตร"
        value={cardType ?? ''}
        disabled={disabled}
        onChange={(e) => onChange({ ...props, cardType: e.target.value || undefined })}
      >
        <option value="">— ไม่ระบุ —</option>
        {CARD_TYPES.map(t => (
          <option key={t} value={t}>{t}</option>
        ))}
      </Select>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>เลข 4 หลักท้าย</span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            pattern="\d{4}"
            placeholder="1234"
            value={cardLast4 ?? ''}
            disabled={disabled}
            onChange={(e) => onChange({ ...props, cardLast4: e.target.value.replace(/\D/g, '').slice(0, 4) || undefined })}
            style={{ padding: '8px 12px', border: '1px solid var(--border-default)', borderRadius: 8 }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Auth Code</span>
          <input
            type="text"
            maxLength={12}
            placeholder="เช่น 123456"
            value={authCode ?? ''}
            disabled={disabled}
            onChange={(e) => onChange({ ...props, authCode: e.target.value || undefined })}
            style={{ padding: '8px 12px', border: '1px solid var(--border-default)', borderRadius: 8 }}
          />
        </label>
      </div>
    </div>
  );
}
