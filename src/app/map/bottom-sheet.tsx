"use client";

import { useRef, useState, type ReactNode } from "react";

type Props = {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** One-line summary shown when collapsed (and above the content when open). */
  peek: ReactNode;
  children: ReactNode;
  /** Height cap when open, e.g. "max-h-[75dvh]". */
  maxHeight: string;
  /** Width class for the side panel on wider screens. */
  desktopWidth: string;
};

const SWIPE = 40; // px of drag that counts as a swipe

/**
 * Sheet over the map. On phones it sits at the bottom: swipe the handle down (or tap it) to
 * shrink it to a slim bar so the map gets the screen, and swipe up (or tap) to bring it back.
 * On wider screens it's a side panel with the same collapse toggle.
 */
export function BottomSheet({ collapsed, onCollapsedChange, peek, children, maxHeight, desktopWidth }: Props) {
  // drag drives rendering; dragRef is read on release, since a quick tap can end before
  // React has re-rendered with the new state.
  const [drag, setDragState] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const startY = useRef(0);
  const setDrag = (v: number | null) => {
    dragRef.current = v;
    setDragState(v);
  };

  function end() {
    const d = dragRef.current;
    if (d === null) return;
    setDrag(null);
    if (Math.abs(d) < 6) onCollapsedChange(!collapsed); // a tap
    else if (d > SWIPE) onCollapsedChange(true);
    else if (d < -SWIPE) onCollapsedChange(false);
  }

  // Follow the finger while dragging: down when open, up when collapsed.
  const offset = drag === null ? 0 : collapsed ? Math.min(0, Math.max(drag, -80)) : Math.max(0, drag);

  return (
    <section
      style={{ transform: offset ? `translateY(${offset}px)` : undefined }}
      className={`absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-2xl bg-white text-neutral-900 shadow-[0_-8px_30px_rgba(0,0,0,0.15)]
        ${drag === null ? "transition-transform duration-200" : ""}
        md:inset-y-auto md:left-auto md:right-3 md:top-3 md:rounded-2xl ${desktopWidth}
        ${collapsed ? "" : `${maxHeight} md:bottom-3 md:max-h-none`}`}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={collapsed ? "Expand" : "Collapse"}
        aria-expanded={!collapsed}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onCollapsedChange(!collapsed)}
        onPointerDown={(e) => {
          // Let buttons and inputs inside the peek row work normally.
          if ((e.target as HTMLElement).closest("button, a, input, select")) return;
          startY.current = e.clientY;
          setDrag(0);
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Capture isn't essential: without it a drag that leaves the bar ends early.
          }
        }}
        onPointerMove={(e) => dragRef.current !== null && setDrag(e.clientY - startY.current)}
        onPointerUp={end}
        onPointerCancel={() => setDrag(null)}
        className="cursor-grab touch-none select-none"
      >
        <div className="flex justify-center pb-1 pt-2">
          <span className="h-1 w-10 rounded-full bg-neutral-300" />
        </div>
        <div className={`px-4 ${collapsed ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]" : "pb-2"}`}>{peek}</div>
      </div>
      {/* Kept mounted while collapsed so scroll position and half-filled forms survive. */}
      <div hidden={collapsed} className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </section>
  );
}
