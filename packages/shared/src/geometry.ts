import type { Point, Scale } from './schemas';

export const EPS = 1e-6;

export function dist(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function polylineLengthPx(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += dist(points[i - 1], points[i]);
  return len;
}

/** Länge einer Polylinie in Metern; null wenn kein Maßstab gesetzt ist. */
export function polylineLengthM(points: Point[], scale: Scale | null): number | null {
  if (!scale) return null;
  return polylineLengthPx(points) / scale.pxPerMeter;
}

export function scaleFromReference(a: Point, b: Point, meters: number): Scale {
  const px = dist(a, b);
  if (px <= 0 || meters <= 0) throw new Error('Ungültige Referenzstrecke');
  return { a, b, meters, pxPerMeter: px / meters };
}

/**
 * Begrenzt einen neuen Punkt so, dass die Polylinie (inkl. neuem Punkt)
 * höchstens maxLenPx lang ist. Liefert den (ggf. gekürzten) Punkt.
 */
export function clampNextPoint(points: Point[], next: Point, maxLenPx: number): Point {
  if (points.length === 0) return next;
  const used = polylineLengthPx(points);
  const remaining = Math.max(0, maxLenPx - used);
  const last = points[points.length - 1];
  const d = dist(last, next);
  if (d <= remaining || d === 0) return next;
  const t = remaining / d;
  return [last[0] + (next[0] - last[0]) * t, last[1] + (next[1] - last[1]) * t];
}

export function midpointOfPolyline(points: Point[]): Point {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return points[0];
  const half = polylineLengthPx(points) / 2;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = dist(points[i - 1], points[i]);
    if (acc + seg >= half) {
      const t = seg === 0 ? 0 : (half - acc) / seg;
      const a = points[i - 1];
      const b = points[i];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    acc += seg;
  }
  return points[points.length - 1];
}

export function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function formatMeters(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '–';
  return `${round(n, digits).toLocaleString('de-DE')} m`;
}
