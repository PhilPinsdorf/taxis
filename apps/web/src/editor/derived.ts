import { useMemo } from 'react';
import {
  buildPortIndex,
  computeRequirements,
  effectivePorts,
  findPortIssues,
  nextFreeChannel,
  placementInfo,
  portKey,
  type CablePiece,
  type Item,
  type Material,
  type MaterialRequest,
  type PlanDoc,
  type PortState,
  type Sheet,
} from '@taxis/shared';
import { useMaterials, useRequests } from '../lib/queries';
import { ppmOf, useEditor, useViewDoc } from './store';

export interface Derived {
  materials: Material[];
  byId: Map<string, Material>;
  requests: MaterialRequest[];
  piecesByCable: Map<string, CablePiece[]>;
  portIndex: Map<string, PortState>;
  openItems: Set<string>;
  canPlace: (m: Material) => { ok: boolean; label: string };
}

export function useDerived(): Derived {
  const doc = useViewDoc();
  const projectId = useEditor((s) => s.projectId);
  const { materials, byId } = useMaterials();
  const { data: requests = [] } = useRequests(projectId ?? '');

  return useMemo(() => {
    const empty = !doc;
    const d = doc as PlanDoc;
    const piecesByCable = new Map<string, CablePiece[]>();
    if (!empty) {
      for (const row of computeRequirements(d, materials.filter((m) => m.kind === 'cable'), requests)) {
        if (!row.allocation) continue;
        for (const [id, pieces] of Object.entries(row.allocation.perRun)) piecesByCable.set(id, pieces);
      }
    }
    const portIndex = empty ? new Map() : buildPortIndex(d, byId);
    const openItems = new Set(empty ? [] : findPortIssues(d, byId).map((i) => i.itemId));
    const canPlace = (m: Material) => {
      if (empty) return { ok: false, label: '' };
      const info = placementInfo(m, d, requests);
      if (info.available == null) return { ok: true, label: info.placed ? `${info.placed}` : '' };
      return { ok: info.canPlace, label: `${info.placed}/${info.available}` };
    };
    return { materials, byId, requests, piecesByCable, portIndex, openItems, canPlace };
  }, [doc, materials, byId, requests]);
}

export function itemSizeM(item: Item, m: Material | undefined): { w: number; d: number } {
  return { w: item.w ?? m?.width ?? 1, d: item.d ?? m?.depth ?? 1 };
}

/** Punkt im lokalen Koordinatensystem eines Items? (Toleranz in px) */
export function hitItem(sheet: Sheet, byId: Map<string, Material>, p: [number, number], tolPx: number, hidden: string[]) {
  const ppm = ppmOf(sheet);
  for (let i = sheet.items.length - 1; i >= 0; i--) {
    const it = sheet.items[i];
    const m = byId.get(it.materialId);
    if (m && hidden.includes(m.category)) continue;
    const { w, d } = itemSizeM(it, m);
    const rad = (-it.rotation * Math.PI) / 180;
    const dx = p[0] - it.x;
    const dy = p[1] - it.y;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    const hw = (w * ppm) / 2 + tolPx;
    const hd = (d * ppm) / 2 + tolPx;
    if (m?.shape === 'circle') {
      if ((lx * lx) / (hw * hw) + (ly * ly) / (hd * hd) <= 1) return it;
    } else if (Math.abs(lx) <= hw && Math.abs(ly) <= hd) return it;
  }
  return null;
}

export function hitCableEnd(sheet: Sheet, p: [number, number], tolPx: number) {
  for (const c of sheet.cables) {
    if (c.points.length < 2) continue;
    const ends = [
      ['start', c.points[0]],
      ['end', c.points[c.points.length - 1]],
    ] as const;
    for (const [end, pt] of ends) {
      if (Math.hypot(pt[0] - p[0], pt[1] - p[1]) <= tolPx) return { cable: c, end, point: pt };
    }
  }
  return null;
}

/** Wählt einen passenden freien Anschluss (bevorzugte Richtung zuerst) */
export function pickPort(
  item: Item,
  m: Material | undefined,
  connector: string | null,
  prefer: 'in' | 'out',
  portIndex: Map<string, PortState>,
): { portId: string; channel: number } | null {
  if (!m || !connector) return null;
  const rank = (dir: string) => (dir === prefer ? 0 : dir === 'io' ? 1 : 2);
  const ports = effectivePorts(item, m)
    .filter((p) => p.connector === connector)
    .sort((a, b) => rank(a.direction) - rank(b.direction));
  for (const p of ports) {
    const st = portIndex.get(portKey(item.id, p.id));
    const ch = st ? nextFreeChannel(st) : 1;
    if (ch != null) return { portId: p.id, channel: ch };
  }
  return null;
}
