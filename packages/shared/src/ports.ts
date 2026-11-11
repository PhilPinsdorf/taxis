import type { CableRun, Endpoint, Item, Material, PlanDoc, Port } from './schemas';

export function effectivePorts(item: Item, material: Material | undefined): Port[] {
  if (!material) return [];
  return material.ports.map((p) => ({ ...p, count: item.portCounts[p.id] ?? p.count }));
}

export function itemDisplayName(item: Item, material: Material | undefined): string {
  return item.label || material?.name || 'Unbekannt';
}

export interface PortUse {
  cableId: string;
  channel: number;
  side: 'from' | 'to';
}

export interface PortState {
  sheetId: string;
  item: Item;
  material: Material;
  port: Port;
  uses: PortUse[];
}

export const portKey = (itemId: string, portId: string) => `${itemId}:${portId}`;

function allCables(doc: PlanDoc): CableRun[] {
  return doc.sheets.flatMap((s) => s.cables);
}

export function buildPortIndex(doc: PlanDoc, materials: Map<string, Material>): Map<string, PortState> {
  const index = new Map<string, PortState>();
  for (const sheet of doc.sheets) {
    for (const item of sheet.items) {
      const material = materials.get(item.materialId);
      if (!material) continue;
      for (const port of effectivePorts(item, material)) {
        index.set(portKey(item.id, port.id), { sheetId: sheet.id, item, material, port, uses: [] });
      }
    }
  }
  for (const cable of allCables(doc)) {
    for (const side of ['from', 'to'] as const) {
      const ep = cable[side];
      if (ep?.type !== 'port') continue;
      index.get(portKey(ep.itemId, ep.portId))?.uses.push({ cableId: cable.id, channel: ep.channel, side });
    }
  }
  return index;
}

export function nextFreeChannel(state: PortState | undefined): number | null {
  if (!state) return null;
  const used = new Set(state.uses.map((u) => u.channel));
  for (let c = 1; c <= state.port.count; c++) if (!used.has(c)) return c;
  return null;
}

/**
 * Folgt einer Kabelkette (Verlängerungen) bis zum gegenüberliegenden Port.
 * arrivedAt = Seite des Kabels, an der man "ankommt".
 */
export function resolveFarEnd(
  doc: PlanDoc,
  cableId: string,
  arrivedAt: 'start' | 'end',
  visited = new Set<string>(),
): Extract<Endpoint, { type: 'port' }> | null {
  if (visited.has(cableId)) return null;
  visited.add(cableId);
  const cables = allCables(doc);
  const cable = cables.find((c) => c.id === cableId);
  if (!cable) return null;
  const exit = arrivedAt === 'start' ? 'end' : 'start';
  const ep = exit === 'end' ? cable.to : cable.from;
  if (ep?.type === 'port') return ep;
  if (ep?.type === 'cable') return resolveFarEnd(doc, ep.cableId, ep.end, visited);
  for (const o of cables) {
    if (visited.has(o.id)) continue;
    if (o.from?.type === 'cable' && o.from.cableId === cable.id && o.from.end === exit)
      return resolveFarEnd(doc, o.id, 'start', visited);
    if (o.to?.type === 'cable' && o.to.cableId === cable.id && o.to.end === exit)
      return resolveFarEnd(doc, o.id, 'end', visited);
  }
  return null;
}

export type PortIssueType = 'required-open' | 'overbooked' | 'incompatible';

export interface PortIssue {
  type: PortIssueType;
  sheetId: string;
  itemId: string;
  itemName: string;
  portName: string;
  message: string;
}

export function findPortIssues(doc: PlanDoc, materials: Map<string, Material>): PortIssue[] {
  const index = buildPortIndex(doc, materials);
  const cables = new Map(allCables(doc).map((c) => [c.id, c]));
  const issues: PortIssue[] = [];
  for (const st of index.values()) {
    const base = {
      sheetId: st.sheetId,
      itemId: st.item.id,
      itemName: itemDisplayName(st.item, st.material),
      portName: st.port.name,
    };
    if (st.port.required && st.uses.length === 0) {
      issues.push({ ...base, type: 'required-open', message: `${st.port.name} (${st.port.connector}) nicht angeschlossen` });
    }
    if (st.uses.length > st.port.count) {
      issues.push({ ...base, type: 'overbooked', message: `${st.port.name}: ${st.uses.length} von ${st.port.count} belegt` });
    }
    for (const u of st.uses) {
      const cable = cables.get(u.cableId);
      const cm = cable ? materials.get(cable.materialId) : undefined;
      if (cm?.connector && cm.connector !== st.port.connector) {
        issues.push({
          ...base,
          type: 'incompatible',
          message: `${cm.name} (${cm.connector}) an ${st.port.name} (${st.port.connector})`,
        });
      }
    }
  }
  return issues;
}

export interface PatchRow {
  port: Port;
  channel: number;
  cableId: string | null;
  cableLabel: string;
  farEnd: string;
}

export interface PatchList {
  sheetId: string;
  item: Item;
  material: Material;
  name: string;
  rows: PatchRow[];
  used: number;
  total: number;
}

/** Belegungslisten für alle Geräte mit Mehrfach-Ports (Stageboxen, Verteiler, Pulte) */
export function buildPatchLists(doc: PlanDoc, materials: Map<string, Material>): PatchList[] {
  const index = buildPortIndex(doc, materials);
  const cables = new Map(allCables(doc).map((c) => [c.id, c]));
  const itemsById = new Map(doc.sheets.flatMap((s) => s.items).map((i) => [i.id, i]));
  const lists = new Map<string, PatchList>();

  for (const st of index.values()) {
    const ports = effectivePorts(st.item, st.material);
    const total = ports.reduce((s, p) => s + p.count, 0);
    if (total < 4) continue;
    let list = lists.get(st.item.id);
    if (!list) {
      list = {
        sheetId: st.sheetId,
        item: st.item,
        material: st.material,
        name: itemDisplayName(st.item, st.material),
        rows: [],
        used: 0,
        total,
      };
      lists.set(st.item.id, list);
    }
    for (let ch = 1; ch <= st.port.count; ch++) {
      const use = st.uses.find((u) => u.channel === ch);
      let farEnd = '';
      let cableLabel = '';
      if (use) {
        list.used++;
        const cable = cables.get(use.cableId);
        const cm = cable ? materials.get(cable.materialId) : undefined;
        cableLabel = cable?.label || cm?.name || '';
        const far = resolveFarEnd(doc, use.cableId, use.side === 'from' ? 'start' : 'end');
        if (far) {
          const it = itemsById.get(far.itemId);
          const m = it ? materials.get(it.materialId) : undefined;
          const p = m?.ports.find((x) => x.id === far.portId);
          farEnd = `${it ? itemDisplayName(it, m) : '?'} · ${p?.name ?? far.portId}`;
        } else {
          farEnd = 'offen';
        }
      }
      list.rows.push({ port: st.port, channel: ch, cableId: use?.cableId ?? null, cableLabel, farEnd });
    }
  }
  return [...lists.values()].sort((a, b) => a.name.localeCompare(b.name));
}
