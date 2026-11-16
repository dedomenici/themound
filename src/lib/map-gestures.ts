import { useEffect, useRef, useState, type RefObject } from "react";

export type MapPan = { x: number; y: number };

/** Keep the screen point under the cursor or pinch midpoint fixed while zooming. */
export function zoomAround(args: {
  zoom: number;
  nextZoom: number;
  pan: MapPan;
  originX: number;
  originY: number;
  pointX: number;
  pointY: number;
}): { zoom: number; pan: MapPan } {
  const ratio = args.nextZoom / args.zoom;
  return {
    zoom: args.nextZoom,
    pan: {
      x: args.pointX - args.originX - (args.pointX - args.originX - args.pan.x) * ratio,
      y: args.pointY - args.originY - (args.pointY - args.originY - args.pan.y) * ratio,
    },
  };
}

type GestureOptions = {
  minZoom?: number;
  maxZoom?: number;
  initialZoom?: number;
  /** When this value changes, zoom and pan reset to the initial view. */
  resetKey?: string;
  clampPan?: (pan: MapPan, zoom: number) => MapPan;
  ignorePointer?: (target: EventTarget | null) => boolean;
  onTap?: () => void;
};

/**
 * Pan with one finger or the mouse, pinch-zoom with two fingers, and zoom
 * with a wheel or trackpad — all around the pointer, on a frame whose
 * contents use `translate(pan) scale(zoom)` with a center origin.
 */
export function useMapGestures(frameRef: RefObject<HTMLElement | null>, options: GestureOptions = {}) {
  const minZoom = options.minZoom ?? 1;
  const maxZoom = options.maxZoom ?? 4;
  const initialZoom = options.initialZoom ?? 1;
  const [zoom, setZoomState] = useState(initialZoom);
  const [pan, setPanState] = useState<MapPan>({ x: 0, y: 0 });

  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const minRef = useRef(minZoom);
  const maxRef = useRef(maxZoom);
  minRef.current = minZoom;
  maxRef.current = maxZoom;

  useEffect(() => {
    setZoomState(initialZoom);
    setPanState({ x: 0, y: 0 });
  }, [options.resetKey, initialZoom]);

  function clampZoom(value: number) {
    return Math.min(maxRef.current, Math.max(minRef.current, Math.round(value * 100) / 100));
  }

  function applyPan(next: MapPan, nextZoom: number) {
    const clamp = optionsRef.current.clampPan;
    return clamp ? clamp(next, nextZoom) : next;
  }

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const el: HTMLElement = node;

    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { id: number; x: number; y: number; panX: number; panY: number; moved: boolean } | null = null;
    let pinch: { distance: number; zoom: number; pan: MapPan } | null = null;
    let pinched = false;

    function point(event: PointerEvent | WheelEvent) {
      const rect = el.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        originX: rect.width / 2,
        originY: rect.height / 2,
      };
    }

    function commit(nextZoom: number, nextPan: MapPan) {
      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      setZoomState(nextZoom);
      setPanState(nextPan);
    }

    function zoomAt(nextZoom: number, event: PointerEvent | WheelEvent) {
      const current = zoomRef.current;
      if (nextZoom === current) return;
      const at = point(event);
      const moved = zoomAround({
        zoom: current,
        nextZoom,
        pan: panRef.current,
        originX: at.originX,
        originY: at.originY,
        pointX: at.x,
        pointY: at.y,
      });
      commit(moved.zoom, applyPan(moved.pan, moved.zoom));
    }

    function onPointerDown(event: PointerEvent) {
      if (optionsRef.current.ignorePointer?.(event.target)) return;
      event.stopPropagation();
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        /* optional */
      }
      if (pointers.size >= 2) {
        const pts = [...pointers.values()];
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        pinch = { distance: Math.hypot(dx, dy) || 1, zoom: zoomRef.current, pan: panRef.current };
        drag = null;
        pinched = true;
        return;
      }
      pinch = null;
      pinched = false;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
        moved: false,
      };
    }

    function onPointerMove(event: PointerEvent) {
      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (pointers.size >= 2 && pinch) {
        const pts = [...pointers.values()];
        const distance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        const nextZoom = clampZoom(pinch.zoom * (distance / pinch.distance));
        const mid: Pick<PointerEvent, "clientX" | "clientY"> = {
          clientX: (pts[0].x + pts[1].x) / 2,
          clientY: (pts[0].y + pts[1].y) / 2,
        };
        const at = point(mid as PointerEvent);
        const moved = zoomAround({
          zoom: pinch.zoom,
          nextZoom,
          pan: pinch.pan,
          originX: at.originX,
          originY: at.originY,
          pointX: at.x,
          pointY: at.y,
        });
        commit(moved.zoom, applyPan(moved.pan, moved.zoom));
        return;
      }
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 5) drag.moved = true;
      commit(zoomRef.current, applyPan({ x: drag.panX + dx, y: drag.panY + dy }, zoomRef.current));
    }

    function onPointerUp(event: PointerEvent) {
      const wasDrag = drag;
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        const [id, remaining] = [...pointers.entries()][0];
        drag = {
          id,
          x: remaining.x,
          y: remaining.y,
          panX: panRef.current.x,
          panY: panRef.current.y,
          moved: true,
        };
        return;
      }
      drag = null;
      if (pointers.size === 0) {
        if (wasDrag && !wasDrag.moved && !pinched) optionsRef.current.onTap?.();
        pinched = false;
      }
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const factor = event.ctrlKey ? Math.exp(-event.deltaY * 0.01) : event.deltaY > 0 ? 0.9 : 1.12;
      zoomAt(clampZoom(zoomRef.current * factor), event);
    }

    function onTouchMove(event: TouchEvent) {
      if (event.touches.length >= 2) event.preventDefault();
    }

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [frameRef]);

  function setZoom(next: number) {
    const zoom = clampZoom(typeof next === "number" ? next : initialZoom);
    zoomRef.current = zoom;
    setZoomState(zoom);
  }

  function setPan(next: MapPan) {
    const pan = applyPan(next, zoomRef.current);
    panRef.current = pan;
    setPanState(pan);
  }

  return { zoom, pan, setZoom, setPan };
}
