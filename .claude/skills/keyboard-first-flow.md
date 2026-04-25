---
name: keyboard-first-flow
description: Use when building forms, dialogs, tables, or any interactive UI. Enforces keyboard shortcuts, focus management, escape-to-close, and aria patterns for power users.
type: pattern
---

# Keyboard-First Flow

## When to use
Every interactive component — dialogs, dropdowns, tables, command palettes, multi-step forms, date pickers.

## Global shortcuts (already wired)

- `Ctrl/Cmd + K` → open Command Palette (`src/components/layout/CommandPalette.tsx`)
- `Esc` → close topmost overlay (dialog / palette / drawer)

Do NOT reassign these keys elsewhere.

## Rules (checklist)

- [ ] **`autoFocus` on the first meaningful input** when a dialog / step opens. For wizards, re-autofocus on step change.
- [ ] **Enter submits the primary action** when focus is inside a form control (let the browser handle via `<form onSubmit>` or explicit `onKeyDown`).
- [ ] **Esc closes** every dialog, drawer, and popover. Wire with `useEffect` + `keydown` listener scoped to `open` state.
- [ ] **Arrow keys navigate** lists — palette results, dropdown options, table rows when a row-mode is active. ↑/↓ move active index, Enter selects.
- [ ] **Tab order is logical** — inputs in reading order; never `tabIndex={1}` / `tabIndex={2}` manual ordering (breaks SR users).
- [ ] **Focus trap inside modals** — Tab from last focusable wraps to first; Shift+Tab from first wraps to last. (`Dialog.tsx` handles this.)
- [ ] **Return focus to trigger** when a dialog closes — store `document.activeElement` on open, call `.focus()` on close.
- [ ] **ARIA**: dialogs have `role="dialog" aria-modal="true" aria-label="..."`; toast region has `aria-live="polite"`; destructive buttons have `aria-label` that includes the object (`ลบการจอง BK-0042`).
- [ ] **Skip boilerplate clicks** — don't require clicking a "Next" button if the step has only one choice and Enter is pressed.
- [ ] **Body scroll lock** when a modal is open (`document.body.style.overflow = 'hidden'`) with cleanup in `useEffect` return.

## Anti-patterns

❌ `onClick` without a keyboard equivalent (`onKeyDown` for custom clickable divs — or just use `<button>`).
❌ Div-as-button — always use `<button type="button">` for clickable elements inside forms (prevents accidental form submit).
❌ Hijacking browser shortcuts (`Ctrl+S`, `Ctrl+P`) without a toggle.
❌ Missing `Esc` handler → trapped users.
❌ `autoFocus` on a non-input element (buttons, divs) — disorients screen reader users.

## Reference files
- `src/components/layout/CommandPalette.tsx` — ↑↓ Enter Esc
- `src/components/ui/Dialog.tsx` — focus trap + Esc + scroll lock
- `src/components/ui/Toast.tsx` — aria-live region
