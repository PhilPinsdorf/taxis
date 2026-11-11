import { EPS, polylineLengthM } from './geometry';
import type { CableRun, Scale, StockLength } from './schemas';

/**
 * Reserve-Modell: Von einem Kabel der Länge L sind L × (1 − r) "nutzbar" (zeichenbar inkl. Höhe).
 * Umgekehrt braucht eine gezeichnete Strecke s (inkl. Höhe) ein Kabel von s / (1 − r).
 */
export function effectiveReservePct(cable: Pick<CableRun, 'reservePct'>, defaultReservePct: number): number {
  return cable.reservePct ?? defaultReservePct;
}

export function reserveFactor(pct: number): number {
  return 1 - Math.min(Math.max(pct, 0), 90) / 100;
}

export function cableDrawnM(cable: CableRun, scale: Scale | null): number | null {
  return polylineLengthM(cable.points, scale);
}

/** Gezeichnete Länge + Höhen (ohne Reserve) */
export function cablePathM(cable: CableRun, scale: Scale | null): number | null {
  const drawn = cableDrawnM(cable, scale);
  if (drawn == null) return null;
  return drawn + cable.heightStart + cable.heightEnd;
}

/** Benötigte Kabellänge inkl. Reserve */
export function cableRequiredM(cable: CableRun, scale: Scale | null, defaultReservePct: number): number | null {
  const path = cablePathM(cable, scale);
  if (path == null) return null;
  return path / reserveFactor(effectiveReservePct(cable, defaultReservePct));
}

/** Max. zeichenbare Strecke (Meter, ohne Höhen) für ein Kabel fester Länge */
export function fixedMaxDrawM(
  fixedLength: number,
  reservePct: number,
  heightStart: number,
  heightEnd: number,
): number {
  return Math.max(0, fixedLength * reserveFactor(reservePct) - heightStart - heightEnd);
}

export interface CablePiece {
  length: number;
  /** true = nicht im (angegebenen) Bestand vorhanden */
  missing: boolean;
}

export interface AllocationRun {
  id: string;
  requiredM: number;
  /** gesetzt bei festen Kabeln: genau dieses Stück wird gebraucht */
  fixedLength: number | null;
}

export interface AllocationResult {
  perRun: Record<string, CablePiece[]>;
  /** Je Stücklänge: wie viele gebraucht, davon aus Bestand, davon fehlend */
  byLength: { length: number; needed: number; fromStock: number; missing: number }[];
  missingCount: number;
}

/**
 * Ordnet Kabelstrecken vorhandenen Stücklängen zu.
 * 1. Feste Kabel reservieren ihre Länge.
 * 2. Freie Strecken (absteigend nach Bedarf): kleinstes passendes Einzelstück,
 *    sonst Kombination (größtes verfügbares + Rest), sonst als fehlend markiert.
 */
export function allocateCables(runs: AllocationRun[], stock: StockLength[]): AllocationResult {
  const avail = new Map<number, number>();
  for (const s of stock) avail.set(s.length, (avail.get(s.length) ?? 0) + s.qty);
  const catalogLengths = [...new Set(stock.map((s) => s.length))].sort((a, b) => a - b);

  const perRun: Record<string, CablePiece[]> = {};
  const needed = new Map<number, { needed: number; fromStock: number; missing: number }>();

  const take = (length: number): CablePiece => {
    const n = avail.get(length) ?? 0;
    const entry = needed.get(length) ?? { needed: 0, fromStock: 0, missing: 0 };
    entry.needed++;
    needed.set(length, entry);
    if (n > 0) {
      avail.set(length, n - 1);
      entry.fromStock++;
      return { length, missing: false };
    }
    entry.missing++;
    return { length, missing: true };
  };

  const availableLengths = () =>
    [...avail.entries()].filter(([, n]) => n > 0).map(([l]) => l).sort((a, b) => a - b);

  for (const run of runs.filter((r) => r.fixedLength != null)) {
    perRun[run.id] = [take(run.fixedLength!)];
  }

  const free = runs.filter((r) => r.fixedLength == null).sort((a, b) => b.requiredM - a.requiredM);
  if (catalogLengths.length === 0) {
    for (const run of free) perRun[run.id] = [];
    return { perRun, byLength: [], missingCount: 0 };
  }

  for (const run of free) {
    const pieces: CablePiece[] = [];
    let remaining = run.requiredM;
    let guard = 0;
    while (remaining > EPS && guard++ < 100) {
      const lens = availableLengths();
      const single = lens.find((l) => l + EPS >= remaining);
      if (single != null) {
        pieces.push(take(single));
        remaining = 0;
        break;
      }
      if (lens.length > 0) {
        const largest = lens[lens.length - 1];
        pieces.push(take(largest));
        remaining -= largest;
        continue;
      }
      // Bestand erschöpft → fehlendes Stück vorschlagen
      const want = catalogLengths.find((l) => l + EPS >= remaining) ?? catalogLengths[catalogLengths.length - 1];
      pieces.push(take(want));
      remaining -= want;
    }
    perRun[run.id] = pieces.sort((a, b) => b.length - a.length);
  }

  const byLength = [...needed.entries()]
    .map(([length, v]) => ({ length, ...v }))
    .sort((a, b) => b.length - a.length);
  return { perRun, byLength, missingCount: byLength.reduce((s, b) => s + b.missing, 0) };
}

export function formatPieces(pieces: CablePiece[]): string {
  if (pieces.length === 0) return '';
  const counts = new Map<number, number>();
  for (const p of pieces) counts.set(p.length, (counts.get(p.length) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([l, n]) => `${n}× ${l.toLocaleString('de-DE')} m`)
    .join(' + ');
}
