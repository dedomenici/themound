import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

export type MapPan = { x: number; y: number };
export type GeoPoint = { lat: number; lng: number };

export const MIN_MAP_ZOOM = 2;
export const MAX_MAP_ZOOM = 19;

const TILE = 256;

export function clampMapZoom(value: number, min = MIN_MAP_ZOOM, max = MAX_MAP_ZOOM) {
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

export function splitZoom(zoom: number) {
  const zInt = Math.round(clampMapZoom(zoom));
  return { zInt, scale: 2 ** (zoom - zInt) };
}

function worldSize(zInt: number) {
  return TILE * 2 ** zInt;
}

export function lngToWorldX(lng: number, zInt: number) {
  return ((lng + 180) / 360) * worldSize(zInt);
}

export function latToWorldY(lat: number, zInt: number) {
  const clamped = Math.min(85.05112878, Math.max(-85.05112878, lat));
  const r = (clamped * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * worldSize(zInt);
}

export function worldXToLng(x: number, zInt: number) {
  const n = worldSize(zInt);
  const t = ((x / n) % 1 + 1) % 1;
  return t * 360 - 180;
}

export function worldYToLat(y: number, zInt: number) {
  const n = worldSize(zInt);
  const t = Math.min(1, Math.max(0, y / n));
  const r = Math.PI * (1 - 2 * t);
  return (180 / Math.PI) * Math.atan(Math.sinh(r));
}

function wrapDeltaX(dx: number, zInt: number) {
  const n = worldSize(zInt);
  if (dx > n / 2) return dx - n;
  if (dx < -n / 2) return dx + n;
  return dx;
}

export function fitView(
  points: GeoPoint[],
  width: number,
  height: number,
  padding = 0.25,
  fallbackZoom = 15,
  minZoom = MIN_MAP_ZOOM,
  maxZoom = MAX_MAP_ZOOM,
): { center: GeoPoint; zoom: number } {
  if (!points.length) return { center: { lat: 0, lng: 0 }, zoom: fallbackZoom };
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  if (!width || !height) return { center, zoom: fallbackZoom };
  const latPad = Math.max(maxLat - minLat, 0.002) * padding;
  const lngPad = Math.max(maxLng - minLng, 0.002) * padding;
  const bounds = {
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
    minLng: minLng - lngPad,
    maxLng: maxLng + lngPad,
  };
  let zoom = maxZoom;
  while (zoom > minZoom) {
    const { zInt, scale } = splitZoom(zoom);
    const dx = Math.abs(lngToWorldX(bounds.maxLng, zInt) - lngToWorldX(bounds.minLng, zInt)) * scale;
    const dy = Math.abs(latToWorldY(bounds.maxLat, zInt) - latToWorldY(bounds.minLat, zInt)) * scale;
    if (dx <= width && dy <= height) break;
    zoom -= 0.25;
  }
  return { center, zoom: clampMapZoom(zoom, minZoom, maxZoom) };
}

export type TileCover = {
  zInt: number;
  scale: number;
  cx: number;
  cy: number;
  tiles: { x: number; y: number; left: number; top: number }[];
};

export function coverTiles(center: GeoPoint, zoom: number, width: number, height: number, pad = TILE): TileCover {
  const { zInt, scale } = splitZoom(zoom);
  const n = 2 ** zInt;
  const cx = lngToWorldX(center.lng, zInt);
  const cy = latToWorldY(center.lat, zInt);
  const halfW = width / scale / 2 + pad;
  const halfH = height / scale / 2 + pad;
  const x0 = Math.floor((cx - halfW) / TILE);
  const x1 = Math.floor((cx + halfW) / TILE);
  const y0 = Math.max(0, Math.floor((cy - halfH) / TILE));
  const y1 = Math.min(n - 1, Math.floor((cy + halfH) / TILE));
  const tiles: TileCover["tiles"] = [];
  for (let x = x0; x <= x1; x += 1) {
    const wrappedX = ((x % n) + n) % n;
    for (let y = y0; y <= y1; y += 1) {
      tiles.push({ x: wrappedX, y, left: x * TILE, top: y * TILE });
    }
  }
  return { zInt, scale, cx, cy, tiles };
}

export function projectToScreen(
  point: GeoPoint,
  center: GeoPoint,
  zoom: number,
  width: number,
  height: number,
): { left: number; top: number } {
  const { zInt, scale } = splitZoom(zoom);
  const dx = wrapDeltaX(lngToWorldX(point.lng, zInt) - lngToWorldX(center.lng, zInt), zInt);
  const dy = latToWorldY(point.lat, zInt) - latToWorldY(center.lat, zInt);
  return { left: width / 2 + dx * scale, top: height / 2 + dy * scale };
}

export function layerTransform(view: TileCover, width: number, height: number) {
  return `translate(${width / 2 - view.cx * view.scale}px, ${height / 2 - view.cy * view.scale}px) scale(${view.scale})`;
}

function screenToGeo(
  sx: number,
  sy: number,
  center: GeoPoint,
  zoom: number,
  width: number,
  height: number,
): GeoPoint {
  const { zInt, scale } = splitZoom(zoom);
  const wx = lngToWorldX(center.lng, zInt) + (sx - width / 2) / scale;
  const wy = latToWorldY(center.lat, zInt) + (sy - height / 2) / scale;
  return { lat: worldYToLat(wy, zInt), lng: worldXToLng(wx, zInt) };
}

function geoAtScreen(center: GeoPoint, zoom: number, point: GeoPoint, sx: number, sy: number, width: number, height: number): GeoPoint {
  const { zInt, scale } = splitZoom(zoom);
  const wx = lngToWorldX(point.lng, zInt) - (sx - width / 2) / scale;
  const wy = Math.min(worldSize(zInt), Math.max(0, latToWorldY(point.lat, zInt) - (sy - height / 2) / scale));
  return { lat: worldYToLat(wy, zInt), lng: worldXToLng(wx, zInt) };
}

function panCenter(center: GeoPoint, zoom: number, dx: number, dy: number): GeoPoint {
  const { zInt, scale } = splitZoom(zoom);
  const wx = lngToWorldX(center.lng, zInt) - dx / scale;
  const wy = Math.min(worldSize(zInt), Math.max(0, latToWorldY(center.lat, zInt) - dy / scale));
  return { lat: worldYToLat(wy, zInt), lng: worldXToLng(wx, zInt) };
}

type SlippyOptions = {
  minZoom?: number;
  maxZoom?: number;
  resetKey?: string;
  getInitialView: (frame: { w: number; h: number }) => { center: GeoPoint; zoom: number };
  ignorePointer?: (target: EventTarget | null) => boolean;
  onTap?: () => void;
};

export function useSlippyMap(frameRef: RefObject<HTMLElement | null>, options: SlippyOptions) {
  const minZoom = options.minZoom ?? MIN_MAP_ZOOM;
  const maxZoom = options.maxZoom ?? MAX_MAP_ZOOM;
  const [center, setCenter] = useState<GeoPoint>({ lat: 0, lng: 0 });
  const [zoom, setZoomState] = useState(15);
  const [frame, setFrame] = useState({ w: 0, h: 0 });

  const centerRef = useRef(center);
  const zoomRef = useRef(zoom);
  const frameRefSize = useRef(frame);
  centerRef.current = center;
  zoomRef.current = zoom;
  frameRefSize.current = frame;

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const minRef = useRef(minZoom);
  const maxRef = useRef(maxZoom);
  minRef.current = minZoom;
  maxRef.current = maxZoom;

  const appliedKey = useRef<string | null>(null);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w && h) setFrame({ w, h });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [frameRef]);

  useEffect(() => {
    if (!frame.w || !frame.h) return;
    const key = options.resetKey ?? "";
    if (appliedKey.current === key) return;
    appliedKey.current = key;
    const view = optionsRef.current.getInitialView(frame);
    const nextZoom = clampMapZoom(view.zoom, minRef.current, maxRef.current);
    setCenter(view.center);
    setZoomState(nextZoom);
    centerRef.current = view.center;
    zoomRef.current = nextZoom;
  }, [options.resetKey, frame.w, frame.h]);

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const el: HTMLElement = node;

    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
    let pinch: { distance: number; zoom: number; center: GeoPoint; midX: number; midY: number } | null = null;
    let pinched = false;

    function size() {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height, left: rect.left, top: rect.top };
    }

    function commit(nextCenter: GeoPoint, nextZoom: number) {
      centerRef.current = nextCenter;
      zoomRef.current = nextZoom;
      setCenter(nextCenter);
      setZoomState(nextZoom);
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
        const box = size();
        pinch = {
          distance: Math.hypot(dx, dy) || 1,
          zoom: zoomRef.current,
          center: centerRef.current,
          midX: (pts[0].x + pts[1].x) / 2 - box.left,
          midY: (pts[0].y + pts[1].y) / 2 - box.top,
        };
        drag = null;
        pinched = true;
        return;
      }
      pinch = null;
      pinched = false;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    }

    function onPointerMove(event: PointerEvent) {
      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (pointers.size >= 2 && pinch) {
        const pts = [...pointers.values()];
        const distance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        const nextZoom = clampMapZoom(pinch.zoom + Math.log2(distance / pinch.distance), minRef.current, maxRef.current);
        const box = size();
        const midX = (pts[0].x + pts[1].x) / 2 - box.left;
        const midY = (pts[0].y + pts[1].y) / 2 - box.top;
        const held = screenToGeo(pinch.midX, pinch.midY, pinch.center, pinch.zoom, box.width, box.height);
        commit(geoAtScreen(pinch.center, nextZoom, held, midX, midY, box.width, box.height), nextZoom);
        return;
      }
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 5) drag.moved = true;
      drag.x = event.clientX;
      drag.y = event.clientY;
      commit(panCenter(centerRef.current, zoomRef.current, dx, dy), zoomRef.current);
    }

    function onPointerUp(event: PointerEvent) {
      const wasDrag = drag;
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        const [id, remaining] = [...pointers.entries()][0];
        drag = { id, x: remaining.x, y: remaining.y, moved: true };
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
      const current = zoomRef.current;
      const nextZoom = clampMapZoom(current + Math.log2(factor), minRef.current, maxRef.current);
      if (nextZoom === current) return;
      const box = size();
      const sx = event.clientX - box.left;
      const sy = event.clientY - box.top;
      const held = screenToGeo(sx, sy, centerRef.current, current, box.width, box.height);
      commit(geoAtScreen(centerRef.current, nextZoom, held, sx, sy, box.width, box.height), nextZoom);
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
    const zoom = clampMapZoom(next, minRef.current, maxRef.current);
    zoomRef.current = zoom;
    setZoomState(zoom);
  }

  const view = useMemo(
    () => coverTiles(center, zoom, frame.w || 1, frame.h || 1),
    [center, zoom, frame.w, frame.h],
  );

  function project(point: GeoPoint) {
    return projectToScreen(point, center, zoom, frame.w || 1, frame.h || 1);
  }

  return { center, zoom, setZoom, frame, view, project, minZoom, maxZoom };
}
