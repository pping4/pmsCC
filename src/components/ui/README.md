# UI Primitives (Phase 1)

Shared components for consistent UX across the PMS. Zero external deps (uses `lucide-react` which is already installed).

## Toast — `useToast()`

Provides user feedback on Server Action results. `ToastProvider` is already wired in `src/app/providers.tsx`.

```tsx
'use client';
import { useToast } from '@/components/ui';

export function SaveButton() {
  const toast = useToast();

  async function handleSave() {
    try {
      await saveBooking(data);
      toast.success('บันทึกสำเร็จ', 'ข้อมูลการจองถูกบันทึกแล้ว');
    } catch (e) {
      toast.error('บันทึกไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    }
  }
}
```

Methods: `toast.success | error | warning | info(title, description?)` or `toast.show({ type, title, description, duration })`.

## Button — built-in loading/disabled state

```tsx
import { Button } from '@/components/ui';
import { Save } from 'lucide-react';

const [saving, setSaving] = useState(false);

<Button variant="primary" loading={saving} leftIcon={<Save size={16} />} onClick={handleSave}>
  บันทึก
</Button>
```

Variants: `primary | secondary | ghost | danger | success`.
Sizes: `sm | md | lg`.
Props: `loading`, `leftIcon`, `rightIcon`, `fullWidth`, plus all native `<button>` props.

**When `loading={true}`:** button disables automatically, shows spinner, `aria-busy` set. Prevents duplicate submissions.

## LoadingSpinner

```tsx
import { LoadingSpinner } from '@/components/ui';

// Inline inside a sentence
<LoadingSpinner inline label="กำลังโหลด..." size={14} />

// Centered block (inside a card)
<LoadingSpinner label="กำลังโหลดข้อมูล..." />

// Full-page center (use for initial data fetch on a route)
if (loading) return <LoadingSpinner fullPage label="กำลังโหลด..." />;
```

## Skeleton — preferred over spinner for table/list shells

```tsx
import { Skeleton, SkeletonRows, SkeletonCard } from '@/components/ui';

{loading ? <SkeletonRows rows={8} columns={5} /> : <DataTable ... />}

<Skeleton height={20} width="40%" />   // custom block
```

## Guidelines

- **Every Server Action result → toast.** No more silent failures.
- **Every submit button →** `<Button loading={isSubmitting}>` (never roll your own disabled state).
- **Every data-fetching page →** show `<Skeleton>` or `<LoadingSpinner fullPage>` instead of a blank screen.
- **Destructive actions →** `variant="danger"` + confirm dialog.
