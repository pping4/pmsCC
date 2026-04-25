---
name: multi-step-dialog-wizard
description: Use when building or refactoring a complex form dialog with 3+ logical sections (booking, check-in, invoice creation, PO creation). Enforces the stepper + per-step validation + summary-before-confirm pattern.
type: pattern
---

# Multi-Step Dialog Wizard

## When to use
A form dialog is a candidate to become a wizard when **any** of these are true:
- Form has 3+ logical sections (guest / booking / payment)
- User can't meaningfully fill later fields until earlier ones are chosen
- Mobile users need to scroll more than one screen
- The final submit does a non-trivial server-side operation (transaction)

## Required elements

1. **Stepper header** — numbered circles (1 → N), completed = ✓ green, active = blue, future = gray; connector lines color-transition when a step is completed.
2. **Step title + counter** under modal heading — `ขั้นตอนที่ 2 จาก 3 — ห้อง & วันที่`
3. **Sticky footer** with:
   - Left: `ยกเลิก` on step 1, `← ย้อนกลับ` on step 2+
   - Right: `ถัดไป →` on step < N, `✓ ยืนยัน` on step N
4. **Per-step validation** — `handleNext()` runs a `validateStepN()` that toasts warnings and blocks advance; never advance silently.
5. **Summary card on final step** — re-shows key choices (guest, room, dates, totals) so the user confirms a complete picture.
6. **`autoFocus` on the first input of each step** — keyboard flow keeps momentum.
7. **Back button preserves state** — never reset on back; only reset on close.
8. **Scrollable content area, non-scrolling header/stepper/footer** — use `flex-direction: column` with `overflow-y: auto` on the middle region.

## Reference implementation
`src/app/(dashboard)/reservation/components/NewBookingDialog.tsx` — 3-step Guest → Booking → Payment.

## Anti-patterns

❌ One giant scrolling modal with all fields visible — exactly what we refactored away from.
❌ Advancing step inside an `onChange` handler — must be explicit via button.
❌ Submitting from step 1 or 2 — final submit ONLY on step N.
❌ Losing state when the user navigates back — keep all form state at the top level.
❌ Putting the stepper inside the scroll region — it must stay visible.
❌ No summary before submit — user clicks "ยืนยัน" without re-seeing what they're confirming.

## Mobile adaptation
- Step labels may be hidden below `sm` breakpoint; keep just the numbered circles + current-step title.
- Footer buttons should be full-width stacked on narrow screens.
