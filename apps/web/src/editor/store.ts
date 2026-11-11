import { create } from 'zustand';
import type { Endpoint, PlanDoc, Point, Sheet } from '@taxis/shared';

export type Tool = 'select' | 'pan' | 'scale' | 'cable' | 'linear' | 'rect' | 'ellipse' | 'text' | 'place';
export type SelKind = 'item' | 'cable' | 'linear' | 'shape';
export interface Selection {
  kind: SelKind;
  id: string;
}

export interface CableOptions {
  materialId: string | null;
  mode: 'free' | 'fixed';
  fixedLength: number | null;
  heightStart: number;
  heightEnd: number;
  reservePct: number | null;
}

export interface Draft {
  points: Point[];
  from: Endpoint | null;
}

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

interface EditorState {
  projectId: string | null;
  doc: PlanDoc | null;
  revision: number;
  version: number;
  savedVersion: number;
  saveState: SaveState;
  past: PlanDoc[];
  future: PlanDoc[];
  sheetId: string | null;
  preview: { id: string; name: string; doc: PlanDoc } | null;

  tool: Tool;
  placeMaterialId: string | null;
  linearMaterialId: string | null;
  cable: CableOptions;
  draft: Draft | null;
  cursor: Point | null;
  selection: Selection | null;
  hiddenCategories: string[];
  showLabels: boolean;
  zoom: number;
  rightPanel: 'props' | 'versions';
}

const HISTORY_LIMIT = 100;

export const useEditor = create<EditorState>(() => ({
  projectId: null,
  doc: null,
  revision: 0,
  version: 0,
  savedVersion: 0,
  saveState: 'saved',
  past: [],
  future: [],
  sheetId: null,
  preview: null,
  tool: 'select',
  placeMaterialId: null,
  linearMaterialId: null,
  cable: { materialId: null, mode: 'free', fixedLength: null, heightStart: 0, heightEnd: 0, reservePct: null },
  draft: null,
  cursor: null,
  selection: null,
  hiddenCategories: [],
  showLabels: true,
  zoom: 1,
  rightPanel: 'props',
}));

const set = useEditor.setState;
const get = useEditor.getState;

export const editor = {
  load(projectId: string, doc: PlanDoc, revision: number) {
    const prev = get();
    const keepSheet = prev.projectId === projectId && doc.sheets.some((s) => s.id === prev.sheetId);
    set({
      projectId,
      doc,
      revision,
      version: 0,
      savedVersion: 0,
      saveState: 'saved',
      past: [],
      future: [],
      preview: null,
      draft: null,
      selection: null,
      sheetId: keepSheet ? prev.sheetId : (doc.sheets[0]?.id ?? null),
    });
  },

  /** Änderung am Dokument. history=false für fortlaufende Änderungen (Drag) nach checkpoint() */
  update(recipe: (doc: PlanDoc) => void, opts: { history?: boolean } = {}) {
    const { doc, past, preview } = get();
    if (!doc || preview) return;
    const next = structuredClone(doc);
    recipe(next);
    set((s) => ({
      doc: next,
      past: opts.history === false ? past : [...past, doc].slice(-HISTORY_LIMIT),
      future: opts.history === false ? s.future : [],
      version: s.version + 1,
      saveState: s.saveState === 'conflict' ? 'conflict' : 'dirty',
    }));
  },

  updateSheet(recipe: (sheet: Sheet, doc: PlanDoc) => void, opts?: { history?: boolean }) {
    const id = get().sheetId;
    editor.update((d) => {
      const sheet = d.sheets.find((s) => s.id === id);
      if (sheet) recipe(sheet, d);
    }, opts);
  },

  checkpoint() {
    const { doc, past } = get();
    if (doc) set({ past: [...past, doc].slice(-HISTORY_LIMIT), future: [] });
  },

  undo() {
    const { past, doc, future } = get();
    if (!past.length || !doc) return;
    set((s) => ({
      doc: past[past.length - 1],
      past: past.slice(0, -1),
      future: [doc, ...future],
      version: s.version + 1,
      saveState: 'dirty',
      selection: null,
    }));
  },

  redo() {
    const { past, doc, future } = get();
    if (!future.length || !doc) return;
    set((s) => ({
      doc: future[0],
      past: [...past, doc],
      future: future.slice(1),
      version: s.version + 1,
      saveState: 'dirty',
      selection: null,
    }));
  },

  setTool(tool: Tool) {
    set({ tool, draft: null });
  },

  select(selection: Selection | null) {
    set({ selection, rightPanel: selection ? 'props' : get().rightPanel });
  },

  deleteSelection() {
    const sel = get().selection;
    if (!sel) return;
    editor.update((d) => {
      for (const s of d.sheets) {
        if (sel.kind === 'item') {
          s.items = s.items.filter((i) => i.id !== sel.id);
          for (const c of s.cables) {
            if (c.from?.type === 'port' && c.from.itemId === sel.id) c.from = null;
            if (c.to?.type === 'port' && c.to.itemId === sel.id) c.to = null;
          }
        }
        if (sel.kind === 'cable') {
          s.cables = s.cables.filter((c) => c.id !== sel.id);
          for (const c of s.cables) {
            if (c.from?.type === 'cable' && c.from.cableId === sel.id) c.from = null;
            if (c.to?.type === 'cable' && c.to.cableId === sel.id) c.to = null;
          }
        }
        if (sel.kind === 'linear') s.linears = s.linears.filter((l) => l.id !== sel.id);
        if (sel.kind === 'shape') s.shapes = s.shapes.filter((x) => x.id !== sel.id);
      }
    });
    set({ selection: null });
  },
};

export function currentSheet(s: Pick<EditorState, 'doc' | 'preview' | 'sheetId'>): Sheet | null {
  const doc = s.preview?.doc ?? s.doc;
  if (!doc) return null;
  return doc.sheets.find((x) => x.id === s.sheetId) ?? doc.sheets[0] ?? null;
}

export const useViewDoc = () => useEditor((s) => s.preview?.doc ?? s.doc);
export const useSheet = () => useEditor(currentSheet);

/** Pixel pro Meter – Fallback, wenn kein Maßstab gesetzt ist */
export function ppmOf(sheet: Sheet | null): number {
  if (!sheet) return 20;
  return sheet.scale?.pxPerMeter ?? Math.max(sheet.imageW, sheet.imageH) / 100;
}
