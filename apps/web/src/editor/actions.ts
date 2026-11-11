import {
  clampNextPoint,
  dist,
  fixedMaxDrawM,
  newId,
  type CableRun,
  type Endpoint,
  type Material,
  type PlanDoc,
  type Point,
  type Sheet,
} from '@taxis/shared';
import { toast } from '../lib/toast';
import { hitCableEnd, hitItem, pickPort, type Derived } from './derived';
import { currentSheet, editor, ppmOf, useEditor } from './store';

const st = useEditor.getState;

function sheetNow(): Sheet | null {
  return currentSheet(st());
}

// ---------------------------------------------------------------------------
// Objekte
// ---------------------------------------------------------------------------

export function addItemAt(material: Material, p: Point, derived: Derived) {
  if (!derived.canPlace(material).ok) {
    toast(`Kein „${material.name}“ mehr verfügbar – Bestand oder Anfrage erhöhen.`, 'error');
    return;
  }
  const id = newId();
  editor.updateSheet((s) => {
    s.items.push({ id, materialId: material.id, x: p[0], y: p[1], rotation: 0, w: null, d: null, label: '', portCounts: {} });
  });
  editor.select({ kind: 'item', id });
}

/** Bewegt ein Item und zieht verbundene Kabelenden mit */
export function moveItem(itemId: string, x: number, y: number, history: boolean) {
  editor.updateSheet(
    (s) => {
      const it = s.items.find((i) => i.id === itemId);
      if (!it) return;
      const dx = x - it.x;
      const dy = y - it.y;
      it.x = x;
      it.y = y;
      for (const c of s.cables) {
        if (c.from?.type === 'port' && c.from.itemId === itemId && c.points[0]) {
          c.points[0] = [c.points[0][0] + dx, c.points[0][1] + dy];
        }
        const last = c.points.length - 1;
        if (c.to?.type === 'port' && c.to.itemId === itemId && last > 0) {
          c.points[last] = [c.points[last][0] + dx, c.points[last][1] + dy];
        }
      }
    },
    { history },
  );
}

export function itemHasCables(sheet: Sheet, itemId: string) {
  return sheet.cables.some(
    (c) => (c.from?.type === 'port' && c.from.itemId === itemId) || (c.to?.type === 'port' && c.to.itemId === itemId),
  );
}

export function duplicateSelection(derived: Derived) {
  const sel = st().selection;
  const sheet = sheetNow();
  if (!sel || !sheet) return;
  const off = ppmOf(sheet);
  const id = newId();
  if (sel.kind === 'item') {
    const it = sheet.items.find((i) => i.id === sel.id);
    const m = it && derived.byId.get(it.materialId);
    if (!it || !m) return;
    if (!derived.canPlace(m).ok) return toast(`Kein „${m.name}“ mehr verfügbar.`, 'error');
    editor.updateSheet((s) => s.items.push({ ...structuredClone(it), id, x: it.x + off, y: it.y + off }));
  } else if (sel.kind === 'shape') {
    const sh = sheet.shapes.find((i) => i.id === sel.id);
    if (!sh) return;
    editor.updateSheet((s) => s.shapes.push({ ...structuredClone(sh), id, x: sh.x + off, y: sh.y + off }));
  } else if (sel.kind === 'linear') {
    const l = sheet.linears.find((i) => i.id === sel.id);
    if (!l) return;
    editor.updateSheet((s) =>
      s.linears.push({ ...structuredClone(l), id, points: l.points.map(([x, y]) => [x + off, y + off] as Point) }),
    );
  } else return;
  editor.select({ kind: sel.kind, id });
}

export function rotateSelection(deg: number) {
  const sel = st().selection;
  if (!sel || (sel.kind !== 'item' && sel.kind !== 'shape')) return;
  editor.updateSheet((s) => {
    const list = sel.kind === 'item' ? s.items : s.shapes;
    const o = list.find((x) => x.id === sel.id);
    if (o) o.rotation = (((o.rotation + deg) % 360) + 360) % 360;
  });
}

// ---------------------------------------------------------------------------
// Formen
// ---------------------------------------------------------------------------

export function createShape(kind: 'rect' | 'ellipse' | 'text', p: Point) {
  const id = newId();
  editor.updateSheet((s) =>
    s.shapes.push({
      id,
      kind,
      x: p[0],
      y: p[1],
      w: kind === 'text' ? 8 : 5,
      h: kind === 'text' ? 1.5 : 4,
      rotation: 0,
      color: kind === 'text' ? '#18181b' : '#64748b',
      label: kind === 'text' ? 'Text' : '',
    }),
  );
  editor.setTool('select');
  editor.select({ kind: 'shape', id });
}

// ---------------------------------------------------------------------------
// Kabel & Strecken zeichnen
// ---------------------------------------------------------------------------

export function cableReserve(doc: PlanDoc | null): number {
  const o = st().cable;
  return o.reservePct ?? doc?.settings.defaultReservePct ?? 10;
}

/** Max. zeichenbare Länge in px für den aktuellen Entwurf (null = unbegrenzt) */
export function draftMaxPx(sheet: Sheet): number | null {
  const s = st();
  if (s.tool !== 'cable' || s.cable.mode !== 'fixed' || !s.cable.fixedLength) return null;
  const m = fixedMaxDrawM(s.cable.fixedLength, cableReserve(s.doc), s.cable.heightStart, s.cable.heightEnd);
  return m * ppmOf(sheet);
}

export function constrainDraftPoint(p: Point, sheet: Sheet): Point {
  const draft = st().draft;
  const max = draftMaxPx(sheet);
  if (!draft || max == null) return p;
  return clampNextPoint(draft.points, p, max);
}

function cableMaterial(derived: Derived): Material | undefined {
  const id = st().cable.materialId;
  return id ? derived.byId.get(id) : undefined;
}

export function handleCableClick(raw: Point, derived: Derived, tolPx: number) {
  const s = st();
  const sheet = sheetNow();
  const material = cableMaterial(derived);
  if (!sheet) return;
  if (!material) return toast('Bitte zuerst einen Kabeltyp wählen.', 'error');
  if (s.cable.mode === 'fixed' && !s.cable.fixedLength) return toast('Bitte eine Kabellänge wählen.', 'error');
  const hidden = s.hiddenCategories;

  // --- Start ---
  if (!s.draft) {
    const end = hitCableEnd(sheet, raw, tolPx);
    if (end) {
      const taken = sheet.cables.some(
        (c) =>
          (c.from?.type === 'cable' && c.from.cableId === end.cable.id && c.from.end === end.end) ||
          (c.to?.type === 'cable' && c.to.cableId === end.cable.id && c.to.end === end.end),
      );
      const own = end.end === 'end' ? end.cable.to : end.cable.from;
      if (!taken && !own) {
        useEditor.setState({ draft: { points: [end.point], from: { type: 'cable', cableId: end.cable.id, end: end.end } } });
        return;
      }
    }
    const item = hitItem(sheet, derived.byId, raw, tolPx, hidden);
    if (item) {
      const m = derived.byId.get(item.materialId);
      const port = pickPort(item, m, material.connector, 'out', derived.portIndex);
      if (port) {
        useEditor.setState({
          draft: { points: [[item.x, item.y]], from: { type: 'port', itemId: item.id, ...port } },
        });
        return;
      }
      if (m?.ports.some((p) => p.connector === material.connector)) {
        toast(`Alle ${material.connector}-Anschlüsse an „${item.label || m.name}“ sind belegt.`);
      }
    }
    useEditor.setState({ draft: { points: [raw], from: null } });
    return;
  }

  // --- Weitere Punkte ---
  const draft = s.draft;
  const max = draftMaxPx(sheet);
  const item = hitItem(sheet, derived.byId, raw, tolPx, hidden);
  const fromItemId = draft.from?.type === 'port' ? draft.from.itemId : null;
  if (item && item.id !== fromItemId) {
    const m = derived.byId.get(item.materialId);
    const port = pickPort(item, m, material.connector, 'in', derived.portIndex);
    if (port) {
      const target: Point = [item.x, item.y];
      const clamped = max == null ? target : clampNextPoint(draft.points, target, max);
      if (dist(clamped, target) < 0.5) {
        finishCable({ type: 'port', itemId: item.id, ...port }, target);
        return;
      }
      toast(`Das ${s.cable.fixedLength} m-Kabel reicht nicht bis „${item.label || m?.name}“.`);
    } else if (m?.ports.some((p) => p.connector === material.connector)) {
      toast(`Alle ${material.connector}-Anschlüsse an „${item.label || m.name}“ sind belegt.`);
    }
  }
  const end = hitCableEnd(sheet, raw, tolPx);
  if (end && !(draft.from?.type === 'cable' && draft.from.cableId === end.cable.id)) {
    const own = end.end === 'end' ? end.cable.to : end.cable.from;
    const clamped = max == null ? end.point : clampNextPoint(draft.points, end.point, max);
    if (!own && dist(clamped, end.point) < 0.5) {
      finishCable({ type: 'cable', cableId: end.cable.id, end: end.end }, end.point);
      return;
    }
  }
  const p = max == null ? raw : clampNextPoint(draft.points, raw, max);
  const last = draft.points[draft.points.length - 1];
  if (dist(last, p) < 0.5) return;
  useEditor.setState({ draft: { ...draft, points: [...draft.points, p] } });
}

export function finishCable(to: Endpoint | null = null, finalPoint?: Point) {
  const s = st();
  const draft = s.draft;
  if (!draft || !s.cable.materialId) return;
  const points = [...draft.points];
  if (finalPoint) points.push(finalPoint);
  const clean = points.filter((p, i) => i === 0 || dist(p, points[i - 1]) >= 0.5);
  if (clean.length < 2) {
    useEditor.setState({ draft: null });
    return;
  }
  const id = newId();
  const cable: CableRun = {
    id,
    materialId: s.cable.materialId,
    points: clean,
    mode: s.cable.mode,
    fixedLength: s.cable.mode === 'fixed' ? s.cable.fixedLength : null,
    heightStart: s.cable.heightStart,
    heightEnd: s.cable.heightEnd,
    reservePct: s.cable.reservePct,
    from: draft.from,
    to,
    label: '',
  };
  editor.updateSheet((sh) => sh.cables.push(cable));
  useEditor.setState({ draft: null });
  editor.select({ kind: 'cable', id });
}

/** Neues Kabel am Ende eines bestehenden anknüpfen */
export function startExtension(cable: CableRun) {
  if (cable.to) return toast('Das Kabelende ist bereits verbunden.');
  useEditor.setState({
    tool: 'cable',
    cable: { ...st().cable, materialId: cable.materialId },
    draft: { points: [cable.points[cable.points.length - 1]], from: { type: 'cable', cableId: cable.id, end: 'end' } },
  });
}

export function handleLinearClick(p: Point) {
  const s = st();
  if (!s.linearMaterialId) return toast('Bitte zuerst Defender/Kabelmatte wählen.', 'error');
  if (!s.draft) {
    useEditor.setState({ draft: { points: [p], from: null } });
    return;
  }
  const last = s.draft.points[s.draft.points.length - 1];
  if (dist(last, p) < 0.5) return;
  useEditor.setState({ draft: { ...s.draft, points: [...s.draft.points, p] } });
}

export function finishLinear() {
  const s = st();
  if (!s.draft || !s.linearMaterialId) return;
  const pts = s.draft.points;
  if (pts.length < 2) {
    useEditor.setState({ draft: null });
    return;
  }
  const id = newId();
  editor.updateSheet((sh) => sh.linears.push({ id, materialId: s.linearMaterialId!, points: pts, label: '' }));
  useEditor.setState({ draft: null });
  editor.select({ kind: 'linear', id });
}

export function finishDraft() {
  const t = st().tool;
  if (t === 'cable') finishCable();
  if (t === 'linear') finishLinear();
}

export function undoDraftPoint() {
  const d = st().draft;
  if (!d) return;
  useEditor.setState({ draft: d.points.length <= 1 ? null : { ...d, points: d.points.slice(0, -1) } });
}

// ---------------------------------------------------------------------------
// Kabel-Endpunkte nachträglich verbinden (Vertex-Drag)
// ---------------------------------------------------------------------------

export function reconnectCableEnd(cableId: string, side: 'from' | 'to', derived: Derived, tolPx: number) {
  const sheet = sheetNow();
  if (!sheet) return;
  const cable = sheet.cables.find((c) => c.id === cableId);
  if (!cable) return;
  const material = derived.byId.get(cable.materialId);
  const idx = side === 'from' ? 0 : cable.points.length - 1;
  const p = cable.points[idx];
  const item = hitItem(sheet, derived.byId, p, tolPx, st().hiddenCategories);
  const current = cable[side];
  if (item && current?.type === 'port' && current.itemId === item.id) {
    editor.updateSheet((s) => {
      const c = s.cables.find((x) => x.id === cableId)!;
      c.points[idx] = [item.x, item.y];
    }, { history: false });
    return;
  }
  let next: Endpoint | null = null;
  let snap: Point | null = null;
  if (item) {
    // Port-Index ohne dieses Kabelende, damit der eigene Kanal frei ist
    const port = pickPort(item, derived.byId.get(item.materialId), material?.connector ?? null, side === 'from' ? 'out' : 'in', derived.portIndex);
    if (port) {
      next = { type: 'port', itemId: item.id, ...port };
      snap = [item.x, item.y];
    }
  }
  if (!next && current?.type === 'cable') return; // Verlängerungen bleiben verbunden
  editor.updateSheet((s) => {
    const c = s.cables.find((x) => x.id === cableId)!;
    c[side] = next;
    if (snap) c.points[idx] = snap;
  }, { history: false });
}
