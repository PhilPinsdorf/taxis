import { allocateCables, cableRequiredM, type AllocationResult, type AllocationRun } from './cables';
import { EPS, polylineLengthM } from './geometry';
import { CATEGORIES, type Material, type MaterialRequest, type PlanDoc, type StockLength } from './schemas';

export type CoverageStatus = 'ok' | 'rented' | 'pending' | 'missing';

export const STATUS_LABEL: Record<CoverageStatus, string> = {
  ok: 'Eigenbestand',
  rented: 'Gedeckt inkl. Miete',
  pending: 'Nur mit offener Anfrage',
  missing: 'Fehlt',
};

export interface RequirementRow {
  material: Material;
  unit: 'Stk' | 'm';
  /** Aus dem Plan (Stück, Segmente oder Meter) */
  planned: number;
  /** Aus Zusatzposten */
  extra: number;
  needed: number;
  owned: number;
  confirmed: number;
  pending: number;
  /** >0: so viel fehlt auch mit allen offenen Anfragen */
  shortfall: number;
  status: CoverageStatus;
  /** Gesamtmeter (Kabel / Linear) */
  totalM: number | null;
  /** Kabel: Vorschlag der Stückzuordnung (inkl. aller nicht abgelehnten Anfragen) */
  allocation: AllocationResult | null;
  warnings: string[];
}

function activeRequests(requests: MaterialRequest[], materialId: string) {
  const forMat = requests.filter((r) => r.materialId === materialId && r.status !== 'abgelehnt');
  return {
    confirmed: forMat.filter((r) => r.status === 'bestätigt'),
    pending: forMat.filter((r) => r.status === 'angefragt'),
  };
}

function statusFor(needed: number, owned: number, confirmed: number, pending: number): CoverageStatus {
  if (needed <= owned + EPS) return 'ok';
  if (needed <= owned + confirmed + EPS) return 'rented';
  if (needed <= owned + confirmed + pending + EPS) return 'pending';
  return 'missing';
}

export function countPlacedItems(doc: PlanDoc, materialId: string): number {
  let n = 0;
  for (const s of doc.sheets) for (const it of s.items) if (it.materialId === materialId) n++;
  return n;
}

export interface PlacementInfo {
  placed: number;
  /** null = unbegrenzt */
  available: number | null;
  canPlace: boolean;
}

/** Für begrenztes Material: Eigenbestand + nicht abgelehnte Anfragen */
export function placementInfo(material: Material, doc: PlanDoc, requests: MaterialRequest[]): PlacementInfo {
  const placed = countPlacedItems(doc, material.id);
  if (material.stockMode !== 'limited') return { placed, available: null, canPlace: true };
  const { confirmed, pending } = activeRequests(requests, material.id);
  const available =
    material.stockQty + [...confirmed, ...pending].reduce((s, r) => s + r.qty, 0);
  return { placed, available, canPlace: placed < available };
}

function mergeStock(base: StockLength[], add: MaterialRequest[]): StockLength[] {
  const m = new Map<number, number>();
  for (const s of base) m.set(s.length, (m.get(s.length) ?? 0) + s.qty);
  for (const r of add) if (r.lengthM != null) m.set(r.lengthM, (m.get(r.lengthM) ?? 0) + r.qty);
  return [...m.entries()].map(([length, qty]) => ({ length, qty }));
}

function withCatalog(stock: StockLength[], catalog: number[]): StockLength[] {
  const have = new Set(stock.map((s) => s.length));
  return [...stock, ...catalog.filter((l) => !have.has(l)).map((length) => ({ length, qty: 0 }))];
}

function requestMeters(rs: MaterialRequest[]): number {
  return rs.reduce((s, r) => s + r.qty * (r.lengthM ?? 1), 0);
}

export function computeRequirements(
  doc: PlanDoc,
  materials: Material[],
  requests: MaterialRequest[],
): RequirementRow[] {
  const rows: RequirementRow[] = [];
  const reserve = doc.settings.defaultReservePct;

  for (const material of materials) {
    const { confirmed, pending } = activeRequests(requests, material.id);
    const extras = doc.extras.filter((e) => e.materialId === material.id);
    const warnings: string[] = [];

    if (material.kind === 'item') {
      const planned = countPlacedItems(doc, material.id);
      const extra = extras.reduce((s, e) => s + e.qty, 0);
      const needed = planned + extra;
      const c = confirmed.reduce((s, r) => s + r.qty, 0);
      const p = pending.reduce((s, r) => s + r.qty, 0);
      if (needed === 0 && c + p === 0) continue;
      rows.push({
        material,
        unit: 'Stk',
        planned,
        extra,
        needed,
        owned: material.stockQty,
        confirmed: c,
        pending: p,
        shortfall: Math.max(0, needed - material.stockQty - c - p),
        status: statusFor(needed, material.stockQty, c, p),
        totalM: null,
        allocation: null,
        warnings,
      });
      continue;
    }

    if (material.kind === 'linear') {
      let segments = 0;
      let totalM = 0;
      let unscaled = 0;
      for (const sheet of doc.sheets) {
        for (const run of sheet.linears) {
          if (run.materialId !== material.id) continue;
          const len = polylineLengthM(run.points, sheet.scale);
          if (len == null) {
            unscaled++;
            continue;
          }
          totalM += len;
          segments += material.segmentLength ? Math.ceil(len / material.segmentLength - EPS) : 0;
        }
      }
      if (unscaled) warnings.push(`${unscaled} Strecke(n) ohne Maßstab nicht berechnet`);
      const bySegments = material.segmentLength != null;
      const planned = bySegments ? segments : totalM;
      const extra = extras.reduce((s, e) => s + e.qty, 0);
      const needed = planned + extra;
      const c = confirmed.reduce((s, r) => s + r.qty, 0);
      const p = pending.reduce((s, r) => s + r.qty, 0);
      if (needed === 0 && c + p === 0 && !unscaled) continue;
      rows.push({
        material,
        unit: bySegments ? 'Stk' : 'm',
        planned,
        extra,
        needed,
        owned: material.stockQty,
        confirmed: c,
        pending: p,
        shortfall: Math.max(0, needed - material.stockQty - c - p),
        status: statusFor(needed, material.stockQty, c, p),
        totalM,
        allocation: null,
        warnings,
      });
      continue;
    }

    // ---- Kabel ----
    const runs: AllocationRun[] = [];
    let plannedM = 0;
    let unscaled = 0;
    for (const sheet of doc.sheets) {
      for (const cable of sheet.cables) {
        if (cable.materialId !== material.id) continue;
        if (cable.mode === 'fixed' && cable.fixedLength) {
          runs.push({ id: cable.id, requiredM: cable.fixedLength, fixedLength: cable.fixedLength });
          plannedM += cable.fixedLength;
          continue;
        }
        const req = cableRequiredM(cable, sheet.scale, reserve);
        if (req == null) {
          unscaled++;
          continue;
        }
        runs.push({ id: cable.id, requiredM: req, fixedLength: null });
        plannedM += req;
      }
    }
    let extraM = 0;
    for (const e of extras) {
      for (let i = 0; i < e.qty; i++) {
        if (e.lengthM != null) {
          // "wir brauchen dort ein 15 m-Kabel" = mindestens 15 m → auch ein 25 m-Stück passt
          runs.push({ id: `${e.id}#${i}`, requiredM: e.lengthM, fixedLength: null });
          extraM += e.lengthM;
        }
      }
      if (e.lengthM == null) {
        runs.push({ id: e.id, requiredM: e.qty, fixedLength: null });
        extraM += e.qty;
      }
    }
    if (unscaled) warnings.push(`${unscaled} Kabel ohne Maßstab nicht berechnet`);
    if (runs.length === 0 && confirmed.length + pending.length === 0 && !unscaled) continue;

    const neededM = plannedM + extraM;
    const ownedM = material.stockLengths.reduce((s, l) => s + l.length * l.qty, 0);
    const cM = requestMeters(confirmed);
    const pM = requestMeters(pending);

    const catalog = [
      ...new Set([
        ...material.stockLengths.map((s) => s.length),
        ...[...confirmed, ...pending].filter((r) => r.lengthM != null).map((r) => r.lengthM!),
      ]),
    ];

    let allocation: AllocationResult | null = null;
    let status: CoverageStatus;
    let shortfall: number;
    if (catalog.length > 0) {
      const a = allocateCables(runs, withCatalog(material.stockLengths, catalog));
      const b = allocateCables(runs, withCatalog(mergeStock(material.stockLengths, confirmed), catalog));
      const all = allocateCables(
        runs,
        withCatalog(mergeStock(material.stockLengths, [...confirmed, ...pending]), catalog),
      );
      allocation = all;
      status = a.missingCount === 0 ? 'ok' : b.missingCount === 0 ? 'rented' : all.missingCount === 0 ? 'pending' : 'missing';
      shortfall = all.byLength.reduce((s, x) => s + x.missing * x.length, 0);
    } else {
      status = statusFor(neededM, ownedM, cM, pM);
      shortfall = Math.max(0, neededM - ownedM - cM - pM);
    }

    rows.push({
      material,
      unit: 'm',
      planned: plannedM,
      extra: extraM,
      needed: neededM,
      owned: ownedM,
      confirmed: cM,
      pending: pM,
      shortfall,
      status,
      totalM: neededM,
      allocation,
      warnings,
    });
  }

  const order: Record<CoverageStatus, number> = { missing: 0, pending: 1, rented: 2, ok: 3 };
  const catIndex = (c: string) => {
    const i = (CATEGORIES as readonly string[]).indexOf(c);
    return i < 0 ? CATEGORIES.length : i;
  };
  return rows.sort(
    (a, b) =>
      catIndex(a.material.category) - catIndex(b.material.category) ||
      a.material.category.localeCompare(b.material.category) ||
      order[a.status] - order[b.status] ||
      a.material.name.localeCompare(b.material.name),
  );
}
