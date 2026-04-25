---
name: mutation-toast-pattern
description: Use when writing any click handler that calls a POST/PUT/PATCH/DELETE API. Enforces double-click guard, try/finally, and toast success/error conventions. Also covers ConfirmDialog for destructive actions.
type: pattern
---

# Mutation Toast Pattern

## When to use
Every handler that triggers a non-idempotent server mutation from the UI — save, create, delete, post, void, refund, close-session, run-audit.

## The canonical pattern

```tsx
const toast = useToast();
const [saving, setSaving] = useState(false);

const handleSave = async () => {
  if (saving) return;              // 1. double-click guard
  setSaving(true);
  try {
    const res = await fetch('/api/x', { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.message || `HTTP ${res.status}`);
    }
    toast.success('บันทึกสำเร็จ');  // 2. success toast
    onSaved?.();
  } catch (e) {
    toast.error('บันทึกไม่สำเร็จ',   // 3. error toast with detail
                e instanceof Error ? e.message : undefined);
  } finally {
    setSaving(false);              // 4. always clear loading
  }
};
```

## Rules (checklist)

- [ ] **Guard**: `if (saving) return;` at the top of every mutation handler.
- [ ] **`try/finally`** — `setSaving(false)` MUST be in `finally`, not in `try` or `catch` alone.
- [ ] **Button reflects loading** — `disabled={saving}` + text change (`กำลังบันทึก...`) or Loader2 icon.
- [ ] **Success toast**: short title + optional detail (e.g. `'สร้างการจองสำเร็จ'`, `'ห้อง 101'`).
- [ ] **Error toast**: `toast.error(title, serverMessage)` — never show raw `[object Object]` or stack traces.
- [ ] **Validation failures** use `toast.warning`, not `toast.error` — warning = fixable by user; error = something went wrong server-side.
- [ ] **Never use `alert()` / `confirm()` / `prompt()`** — use `toast` or `ConfirmDialog` from `@/components/ui`.

## Destructive actions — require ConfirmDialog

Any delete, void, refund, cancel-booking, close-day, write-off:

```tsx
<ConfirmDialog
  open={confirmOpen}
  title="ยกเลิกการจอง?"
  message="การจอง BK-2026-0042 จะถูกยกเลิก ไม่สามารถกู้คืนได้"
  confirmLabel="ยกเลิกการจอง"
  confirmVariant="danger"
  onConfirm={handleCancel}
  onClose={() => setConfirmOpen(false)}
/>
```

## Anti-patterns

❌ `setSaving(true); await fetch(); setSaving(false);` — leaks loading state on throw.
❌ `window.confirm('ลบ?')` — not themed, not translatable, not testable.
❌ `toast.success('ok')` — give a real Thai message; the user can't confirm what happened.
❌ Not reading `err.message` from the response body — generic "Failed" doesn't help.
❌ Swallowing error silently (`catch {}`) — money mutations must surface.

## Reference files
- `src/components/ui/Toast.tsx`
- `src/components/ui/Dialog.tsx` (ConfirmDialog)
