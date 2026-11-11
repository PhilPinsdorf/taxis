import { describe, expect, it } from 'vitest';
import {
  allocateCables,
  buildPatchLists,
  cableRequiredM,
  clampNextPoint,
  computeRequirements,
  findPortIssues,
  fixedMaxDrawM,
  formatPieces,
  MaterialInputSchema,
  PlanDocSchema,
  placementInfo,
  polylineLengthM,
  resolveFarEnd,
  scaleFromReference,
  type Material,
  type MaterialRequest,
  type PlanDoc,
} from './index';

const scale = scaleFromReference([0, 0], [100, 0], 10); // 10 px/m

const mat = (id: string, m: Partial<Material> & Pick<Material, 'name' | 'kind'>): Material => ({
  id,
  ...MaterialInputSchema.parse({ category: 'Test', ...m }),
});

const req = (materialId: string, qty: number, status: MaterialRequest['status'], lengthM: number | null = null): MaterialRequest => ({
  id: Math.random().toString(36),
  projectId: 'p',
  materialId,
  qty,
  lengthM,
  supplier: '',
  status,
  note: '',
  createdAt: '',
});

const doc = (sheet: Record<string, unknown>, extra: Record<string, unknown> = {}): PlanDoc =>
  PlanDocSchema.parse({ sheets: [{ id: 's1', name: 'A', scale, ...sheet }], ...extra });

describe('geometry', () => {
  it('rechnet Pixel in Meter über den Maßstab', () => {
    expect(scale.pxPerMeter).toBe(10);
    expect(polylineLengthM([[0, 0], [30, 40], [30, 140]], scale)).toBe(15);
    expect(polylineLengthM([[0, 0], [10, 0]], null)).toBeNull();
  });

  it('begrenzt den nächsten Punkt auf die Restlänge', () => {
    const p = clampNextPoint([[0, 0], [50, 0]], [50, 100], 80);
    expect(p[0]).toBeCloseTo(50);
    expect(p[1]).toBeCloseTo(30);
    expect(clampNextPoint([[0, 0]], [10, 0], 80)).toEqual([10, 0]);
  });
});

describe('cables', () => {
  const run = (points: [number, number][], extra = {}) =>
    PlanDocSchema.parse({ sheets: [{ id: 's', name: 's', cables: [{ id: 'c', materialId: 'x', points, ...extra }] }] }).sheets[0]
      .cables[0];

  it('berechnet benötigte Länge mit Höhe und Reserve', () => {
    const c = run([[0, 0], [90, 0]], { heightStart: 0, heightEnd: 0 }); // 9 m
    expect(cableRequiredM(c, scale, 10)).toBeCloseTo(10);
    const h = run([[0, 0], [80, 0]], { heightEnd: 1, reservePct: 20 }); // (8+1)/0.8
    expect(cableRequiredM(h, scale, 10)).toBeCloseTo(11.25);
  });

  it('feste Länge: zeichenbare Strecke = L × (1 − r) − Höhen', () => {
    expect(fixedMaxDrawM(10, 10, 0, 1)).toBeCloseTo(8);
    expect(fixedMaxDrawM(5, 10, 3, 3)).toBe(0);
  });

  it('ordnet kleinstes passendes Stück zu', () => {
    const r = allocateCables([{ id: 'a', requiredM: 8, fixedLength: null }], [
      { length: 5, qty: 2 },
      { length: 10, qty: 1 },
      { length: 25, qty: 1 },
    ]);
    expect(r.perRun.a).toEqual([{ length: 10, missing: false }]);
    expect(r.missingCount).toBe(0);
  });

  it('kombiniert Stücke und meldet Fehlmengen', () => {
    const r = allocateCables(
      [
        { id: 'a', requiredM: 37, fixedLength: null },
        { id: 'b', requiredM: 4, fixedLength: null },
        { id: 'f', requiredM: 10, fixedLength: 10 },
      ],
      [
        { length: 5, qty: 1 },
        { length: 10, qty: 1 },
        { length: 25, qty: 1 },
      ],
    );
    // f reserviert 10er, a: 25 + 5 + (fehlt 10er), b: fehlt 5er
    expect(r.perRun.f).toEqual([{ length: 10, missing: false }]);
    expect(formatPieces(r.perRun.a)).toBe('1× 25 m + 1× 10 m + 1× 5 m');
    expect(r.perRun.a.filter((p) => p.missing)).toHaveLength(1);
    expect(r.perRun.b).toEqual([{ length: 5, missing: true }]);
    expect(r.missingCount).toBe(2);
  });

  it('ohne Stücklängen kein Vorschlag', () => {
    const r = allocateCables([{ id: 'a', requiredM: 12, fixedLength: null }], []);
    expect(r.perRun.a).toEqual([]);
  });
});

describe('materials', () => {
  const tent = mat('tent', { name: 'Zelt', kind: 'item', stockMode: 'limited', stockQty: 3 });
  const defender = mat('def', { name: 'Defender', kind: 'linear', segmentLength: 0.9, stockQty: 5 });
  const schuko = mat('sch', {
    name: 'Schuko',
    kind: 'cable',
    connector: 'Schuko',
    stockLengths: [
      { length: 10, qty: 1 },
      { length: 25, qty: 1 },
    ],
  });
  const xlr = mat('xlr', { name: 'XLR', kind: 'cable', connector: 'XLR' });

  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, materialId: 'tent', x: 0, y: 0 }));

  it('blockiert begrenztes Material über Bestand + Anfragen', () => {
    const d = doc({ items: items(3) });
    expect(placementInfo(tent, d, []).canPlace).toBe(false);
    expect(placementInfo(tent, d, [req('tent', 1, 'angefragt')]).canPlace).toBe(true);
    expect(placementInfo(tent, d, [req('tent', 1, 'abgelehnt')]).canPlace).toBe(false);
  });

  it('Status je nach Bestand und Anfragen', () => {
    const d = doc({ items: items(5) });
    const row = (rs: MaterialRequest[]) => computeRequirements(d, [tent], rs)[0];
    expect(row([]).status).toBe('missing');
    expect(row([]).shortfall).toBe(2);
    expect(row([req('tent', 2, 'bestätigt')]).status).toBe('rented');
    expect(row([req('tent', 1, 'bestätigt'), req('tent', 1, 'angefragt')]).status).toBe('pending');
  });

  it('zählt Defender-Segmente je Strecke', () => {
    const d = doc({
      linears: [
        { id: 'l1', materialId: 'def', points: [[0, 0], [50, 0]] }, // 5 m → 6 Stk
        { id: 'l2', materialId: 'def', points: [[0, 0], [18, 0]] }, // 1.8 m → 2 Stk
      ],
    });
    const r = computeRequirements(d, [defender], [])[0];
    expect(r.needed).toBe(8);
    expect(r.status).toBe('missing');
  });

  it('Kabel: Meter, Zusatzposten und Zuordnung', () => {
    const d = doc(
      { cables: [{ id: 'c1', materialId: 'sch', points: [[0, 0], [180, 0]] }] }, // 18 m → 20 m
      { extras: [{ id: 'e1', materialId: 'sch', qty: 1, lengthM: 10 }] },
    );
    const r = computeRequirements(d, [schuko], [])[0];
    expect(r.needed).toBeCloseTo(30);
    expect(r.allocation!.perRun.c1).toEqual([{ length: 25, missing: false }]);
    expect(r.allocation!.perRun['e1#0']).toEqual([{ length: 10, missing: false }]);
    expect(r.status).toBe('ok');

    // Zusatz "15 m" ohne 15 m-Stück im Bestand → nächstgrößeres Stück
    const odd = computeRequirements(doc({}, { extras: [{ id: 'e2', materialId: 'sch', qty: 1, lengthM: 15 }] }), [schuko], [])[0];
    expect(odd.allocation!.perRun['e2#0']).toEqual([{ length: 25, missing: false }]);

    const withReq = computeRequirements(
      doc({ cables: [{ id: 'c1', materialId: 'sch', points: [[0, 0], [400, 0]] }] }), // 40 m → 44.4
      [schuko],
      [req('sch', 1, 'bestätigt', 25)],
    )[0];
    expect(withReq.status).toBe('rented');
  });

  it('Kabel ohne Stücklängen werden nur in Metern verglichen', () => {
    const d = doc({ cables: [{ id: 'c1', materialId: 'xlr', points: [[0, 0], [90, 0]] }] });
    const r = computeRequirements(d, [xlr], [req('xlr', 1, 'angefragt', 20)])[0];
    expect(r.needed).toBeCloseTo(10);
    expect(r.status).toBe('pending');
    expect(r.allocation!.perRun.c1).toEqual([{ length: 20, missing: false }]);
  });

  it('warnt bei Blättern ohne Maßstab', () => {
    const d = PlanDocSchema.parse({
      sheets: [{ id: 's', name: 's', cables: [{ id: 'c', materialId: 'xlr', points: [[0, 0], [10, 0]] }] }],
    });
    expect(computeRequirements(d, [xlr], [])[0].warnings[0]).toMatch(/ohne Maßstab/);
  });
});

describe('ports', () => {
  const box = mat('box', {
    name: 'Aktivbox',
    kind: 'item',
    ports: [
      { id: 'in', name: 'In', connector: 'XLR', direction: 'in', count: 1, required: true },
      { id: 'pwr', name: 'Strom', connector: 'Schuko', direction: 'in', count: 1, required: true },
    ],
  });
  const sb = mat('sb', {
    name: 'Stagebox',
    kind: 'item',
    ports: [{ id: 'in', name: 'Inputs', connector: 'XLR', direction: 'in', count: 16, required: false }],
  });
  const xlr = mat('xlr', { name: 'XLR', kind: 'cable', connector: 'XLR' });
  const schuko = mat('sch', { name: 'Schuko', kind: 'cable', connector: 'Schuko' });
  const mats = new Map([box, sb, xlr, schuko].map((m) => [m.id, m]));

  const d = doc({
    items: [
      { id: 'b1', materialId: 'box', x: 0, y: 0, label: 'Box links' },
      { id: 's1', materialId: 'sb', x: 0, y: 0, portCounts: { in: 8 } },
    ],
    cables: [
      { id: 'c1', materialId: 'xlr', points: [[0, 0], [10, 0]], from: { type: 'port', itemId: 's1', portId: 'in', channel: 3 } },
      { id: 'c2', materialId: 'xlr', points: [[10, 0], [20, 0]], from: { type: 'cable', cableId: 'c1', end: 'end' }, to: { type: 'port', itemId: 'b1', portId: 'in', channel: 1 } },
      { id: 'c3', materialId: 'xlr', points: [[0, 0], [5, 0]], to: { type: 'port', itemId: 'b1', portId: 'pwr', channel: 1 } },
    ],
  });

  it('folgt Verlängerungen bis zum Gerät', () => {
    expect(resolveFarEnd(d, 'c1', 'start')).toMatchObject({ itemId: 'b1', portId: 'in' });
    expect(resolveFarEnd(d, 'c2', 'end')).toMatchObject({ itemId: 's1', channel: 3 });
  });

  it('findet inkompatible Stecker', () => {
    const issues = findPortIssues(d, mats);
    expect(issues.map((i) => i.type)).toEqual(['incompatible']);
  });

  it('meldet offene Pflichtanschlüsse', () => {
    const d2 = doc({ items: [{ id: 'b1', materialId: 'box', x: 0, y: 0 }] });
    expect(findPortIssues(d2, mats).filter((i) => i.type === 'required-open')).toHaveLength(2);
  });

  it('erstellt Patchliste mit Override der Kanalzahl', () => {
    const [list] = buildPatchLists(d, mats);
    expect(list.total).toBe(8);
    expect(list.used).toBe(1);
    expect(list.rows[2].farEnd).toBe('Box links · In');
  });
});
