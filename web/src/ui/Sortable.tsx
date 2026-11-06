/**
 * A list you can reorder by dragging a grip handle. Works with mouse and touch
 * (pointer events, so it does not depend on HTML5 drag and drop, which phones lack),
 * scrolls the page when you drag near the top or bottom, and supports the keyboard:
 * focus a grip and press ↑ / ↓.
 *
 * Items can only move within this list, so callers keep separate lists for things
 * that must not mix (sections, staples vs. this week's items).
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

export interface GripProps {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  'data-sort-key': string;
}

interface Props<T> {
  items: T[];
  getKey: (item: T) => string;
  onReorder: (keys: string[]) => void;
  render: (item: T, grip: GripProps, dragging: boolean) => ReactNode;
}

interface DragInfo {
  from: number;
  startPageY: number;
  clientY: number;
  mids: number[];
  height: number;
}

const EDGE = 90; // px from the top/bottom of the window where dragging scrolls the page

export function Sortable<T>({ items, getKey, onReorder, render }: Props<T>) {
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const info = useRef<DragInfo | null>(null);
  const raf = useRef<number | null>(null);
  const focusAfter = useRef<string | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number; dy: number; height: number } | null>(null);

  const keys = items.map(getKey);

  useEffect(() => {
    if (!focusAfter.current) return;
    const el = document.querySelector<HTMLElement>(`[data-sort-key="${CSS.escape(focusAfter.current)}"]`);
    el?.focus();
    focusAfter.current = null;
  });

  /** Where the dragged row would land: how many other rows' midpoints are above its center. */
  const measure = (d: DragInfo) => {
    const dy = d.clientY + window.scrollY - d.startPageY;
    const center = d.mids[d.from] + dy;
    let over = 0;
    d.mids.forEach((m, j) => { if (j !== d.from && m < center) over += 1; });
    return { dy, over };
  };

  const update = () => {
    const d = info.current;
    if (!d) return;
    const { dy, over } = measure(d);
    setDrag({ from: d.from, over, dy, height: d.height });
  };

  const tick = () => {
    const d = info.current;
    if (!d) return;
    const topEdge = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 0) + EDGE;
    if (d.clientY < topEdge) window.scrollBy(0, -Math.ceil((topEdge - d.clientY) / 6));
    else if (d.clientY > window.innerHeight - EDGE) window.scrollBy(0, Math.ceil((d.clientY - (window.innerHeight - EDGE)) / 6));
    update();
    raf.current = requestAnimationFrame(tick);
  };

  const finish = (commit: boolean) => {
    const d = info.current;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    info.current = null;
    document.body.classList.remove('is-sorting');
    const over = d ? measure(d).over : -1;
    if (d && commit && over !== d.from) {
      const next = [...keys];
      const [moved] = next.splice(d.from, 1);
      next.splice(over, 0, moved);
      onReorder(next);
    }
    setDrag(null);
  };

  const gripFor = (i: number): GripProps => ({
    'data-sort-key': keys[i],
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      const rects = rowRefs.current.slice(0, items.length).map((el) => el!.getBoundingClientRect());
      info.current = {
        from: i,
        startPageY: e.clientY + window.scrollY,
        clientY: e.clientY,
        mids: rects.map((r) => r.top + window.scrollY + r.height / 2),
        height: rects[i].height
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.classList.add('is-sorting');
      setDrag({ from: i, over: i, dy: 0, height: rects[i].height });
      raf.current = requestAnimationFrame(tick);
    },
    onPointerMove: (e) => {
      if (!info.current) return;
      info.current.clientY = e.clientY;
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    onKeyDown: (e) => {
      const j = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
      if (j < 0 || j >= items.length) return;
      e.preventDefault();
      const next = [...keys];
      [next[i], next[j]] = [next[j], next[i]];
      focusAfter.current = keys[i];
      onReorder(next);
    }
  });

  const offsetFor = (j: number): number => {
    if (!drag) return 0;
    if (j === drag.from) return drag.dy;
    if (drag.from < drag.over && j > drag.from && j <= drag.over) return -drag.height;
    if (drag.from > drag.over && j >= drag.over && j < drag.from) return drag.height;
    return 0;
  };

  return (
    <>
      {items.map((item, j) => {
        const dragging = drag?.from === j;
        return (
          <div
            key={keys[j]}
            ref={(el) => { rowRefs.current[j] = el; }}
            className={`sort-item${dragging ? ' dragging' : ''}${drag ? ' sorting' : ''}`}
            style={drag ? { transform: `translateY(${offsetFor(j)}px)` } : undefined}
          >
            {render(item, gripFor(j), dragging)}
          </div>
        );
      })}
    </>
  );
}
