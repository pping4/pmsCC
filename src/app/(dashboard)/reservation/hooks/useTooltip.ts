'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
import type { RefObject, MouseEvent as ReactMouseEvent } from 'react';
import type { TooltipData } from '../lib/types';

interface UseTooltipReturn {
  tooltipData: TooltipData | null;
  tooltipRef: RefObject<HTMLDivElement>;
  showTooltip: (data: TooltipData) => void;
  hideTooltip: () => void;
  updatePosition: (e: ReactMouseEvent) => void;
}

const TOOLTIP_W = 280;
const TOOLTIP_H = 220;
const OFFSET_X  = 16;
const OFFSET_Y  = -10;

export function useTooltip(): UseTooltipReturn {
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hideTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePosition = useCallback((e: ReactMouseEvent) => {
    if (!tooltipRef.current) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = e.clientX + OFFSET_X;
    let y = e.clientY + OFFSET_Y;
    // Clamp to viewport
    if (x + TOOLTIP_W > vw - 8) x = e.clientX - TOOLTIP_W - OFFSET_X;
    if (y + TOOLTIP_H > vh - 8) y = vh - TOOLTIP_H - 8;
    if (y < 8) y = 8;
    // Direct DOM mutation — no React re-render
    tooltipRef.current.style.left = x + 'px';
    tooltipRef.current.style.top  = y + 'px';
  }, []);

  const showTooltip = useCallback((data: TooltipData) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setTooltipData(data);
  }, []);

  const hideTooltip = useCallback(() => {
    hideTimer.current = setTimeout(() => setTooltipData(null), 80);
  }, []);

  // Clean up timer on unmount
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  return { tooltipData, tooltipRef, showTooltip, hideTooltip, updatePosition };
}
