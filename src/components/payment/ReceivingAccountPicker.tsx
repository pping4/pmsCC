/**
 * ReceivingAccountPicker — Sprint 5 Phase 3.3
 *
 * Picker for which bank account received the transfer / QR.
 * Pulls active BANK-subKind accounts from GET /api/financial-accounts?active=1&subKind=BANK.
 */
'use client';

import { useEffect, useState } from 'react';
import { Select } from '@/components/ui';

interface Account {
  id: string;
  code: string;
  name: string;
  bankName?: string | null;
  bankAccountNo?: string | null;
  isDefault?: boolean;
}

interface Props {
  receivingAccountId?: string;
  onChange: (id: string | undefined) => void;
  disabled?: boolean;
  label?: string;
}

export function ReceivingAccountPicker({ receivingAccountId, onChange, disabled, label }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        const res = await fetch('/api/financial-accounts?active=1&subKind=BANK');
        if (!res.ok) throw new Error('fetch accounts failed');
        const data = await res.json();
        if (abort) return;
        const list: Account[] = data.accounts ?? [];
        setAccounts(list);

        // UX: skip the empty "— เลือกบัญชี —" placeholder when the cashier
        // has no real choice to make.  Pick a sensible default automatically:
        //   1. an account flagged isDefault=true
        //   2. otherwise, the only account if there's exactly one
        // Only fires when no value is already selected — never overrides
        // an existing selection that the parent passed in.
        if (!receivingAccountId && list.length > 0) {
          const def = list.find(a => a.isDefault) ?? (list.length === 1 ? list[0] : null);
          if (def) onChange(def.id);
        }
      } catch {
        if (!abort) setAccounts([]);
      } finally {
        if (!abort) setLoading(false);
      }
    })();
    return () => { abort = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Select
      label={label ?? 'บัญชีที่รับเงิน'}
      required
      value={receivingAccountId ?? ''}
      disabled={disabled || loading}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">— เลือกบัญชี —</option>
      {accounts.map(a => (
        <option key={a.id} value={a.id}>
          {a.code} — {a.name}
          {a.bankName ? ` (${a.bankName}${a.bankAccountNo ? ` ${a.bankAccountNo}` : ''})` : ''}
        </option>
      ))}
    </Select>
  );
}
