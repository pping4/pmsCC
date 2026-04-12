'use client';
import { useEffect } from 'react';

interface UseKeyboardOptions {
  onEscape:    () => void;
  onArrowLeft: () => void;
  onArrowRight: () => void;
  onTodayKey:  () => void;  // 't' key
  enabled?: boolean;
}

export function useKeyboard({
  onEscape,
  onArrowLeft,
  onArrowRight,
  onTodayKey,
  enabled = true,
}: UseKeyboardOptions): void {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs/textareas
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onEscape();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          onArrowLeft();
          break;
        case 'ArrowRight':
          e.preventDefault();
          onArrowRight();
          break;
        case 't':
        case 'T':
          e.preventDefault();
          onTodayKey();
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, onEscape, onArrowLeft, onArrowRight, onTodayKey]);
}
