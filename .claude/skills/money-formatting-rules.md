---
name: money-formatting-rules
description: Use when rendering any Baht amount in UI (tables, invoices, receipts, dashboards, badges). Enforces fmtBaht usage and forbids th-TH locale formatting.
type: convention
---

# Money Formatting Rules

## When to use
Any JSX/TSX that shows a number representing money — invoices, receipts, folio rows, dashboards, KPI cards, tooltips, export headers.

## Rules (checklist)

- [ ] **Always use `fmtBaht(n)` from `@/lib/date-format`** — never `n.toLocaleString()`, never `n.toFixed(2)` directly in JSX, never `Intl.NumberFormat('th-TH', ...)`.
- [ ] **Currency symbol**: prepend `฿` as a sibling text node (`฿{fmtBaht(n)}`). Do NOT bake `฿` into `fmtBaht`.
- [ ] **Negative / credit amounts**: show as `(1,234.50)` with parentheses **or** red color + minus sign. Pick ONE style per screen and stay consistent.
- [ ] **Zero**: show as `0.00`, not `-` or blank, unless the column explicitly documents "blank = zero".
- [ ] **Null / undefined** amounts: render `—` (em dash), never `NaN` or `฿0.00` which implies a real zero.
- [ ] **Right-align** every money column in tables (`style={{ textAlign: 'right' }}`) so decimals stack.
- [ ] **Monospace / tabular-nums** for dense money tables — add `fontVariantNumeric: 'tabular-nums'` to keep digits aligned at variable widths.
- [ ] **Exports (CSV/Excel)**: export raw numbers with 2 dp, no `฿`, no comma — let the spreadsheet format.

## Anti-patterns (search regex)

❌ `toLocaleString('th-TH'` — shows Buddhist year / Thai digits in some locales
❌ `toFixed(2)` in render — bypasses `fmtBaht` (which handles null/edge cases)
❌ `Intl.NumberFormat(` in component code — extract to `date-format.ts` if truly needed
❌ Hardcoding `.toString()` + manual comma insertion
❌ `<td>{amount}</td>` without formatting — ships `1234.5` to users

## Example

```tsx
import { fmtBaht } from '@/lib/date-format';

// ✅ Good
<td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
  ฿{fmtBaht(invoice.grandTotal)}
</td>

// ✅ Credit line
<td style={{ color: 'var(--danger)' }}>
  ({fmtBaht(Math.abs(line.amount))})
</td>

// ❌ Bad
<td>{invoice.grandTotal.toLocaleString('th-TH')}</td>
```

## Reference files
- `src/lib/date-format.ts` — the only approved formatter
