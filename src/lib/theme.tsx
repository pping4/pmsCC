'use client';

/**
 * ThemeProvider — manages Light / Dark mode for the entire PMS app.
 *
 * Strategy:
 *  - Stores preference in localStorage under key 'pms-theme'
 *  - Applies / removes class 'dark' on <html> element
 *  - Anti-FOUC: a small inline script in root layout.tsx reads localStorage
 *    and applies the class BEFORE React hydrates (see layout.tsx)
 *  - All CSS tokens live in globals.css under :root / html.dark
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggle: () => {},
  setTheme: () => {},
});

const STORAGE_KEY = 'pms-theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // MUST start with 'light' on both server AND client first render —
  // reading localStorage here would cause a hydration mismatch because
  // the server never runs this branch.  The anti-FOUC <script> in
  // layout.tsx already adds class="dark" to <html> before first paint,
  // so the CSS dark tokens are applied even while React state says 'light'.
  const [theme, setThemeState] = useState<Theme>('light');

  // After hydration: read the persisted preference and sync state.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === 'dark') setThemeState('dark');
    } catch { /* ignore */ }
  }, []);

  // Keep <html> class and localStorage in sync on every change.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch { /* ignore */ }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggle   = useCallback(() => setThemeState(prev => prev === 'light' ? 'dark' : 'light'), []);

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Hook — use inside any Client Component */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/**
 * Inline script string injected into <head> to prevent FOUC.
 * Reads localStorage and immediately:
 *  1. Adds 'dark' class to <html> if theme = dark
 *  2. Sets --sidebar-w CSS variable so layout doesn't shift on hydration
 */
export const ANTI_FOUC_SCRIPT = `
(function(){
  try {
    var t = localStorage.getItem('pms-theme');
    if (t === 'dark') document.documentElement.classList.add('dark');
  } catch(e) {}
  try {
    var c = localStorage.getItem('pms-sidebar-collapsed');
    if (c === 'true') document.documentElement.classList.add('sidebar-collapsed');
  } catch(e) {}
})();
`.trim();
