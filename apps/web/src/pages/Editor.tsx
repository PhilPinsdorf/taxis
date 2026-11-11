import { AlertTriangle, FilePlus2, ImageUp, Loader2, Ruler, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Field, Input, Modal } from '../components/ui';
import { PlanCanvas } from '../editor/Canvas';
import { duplicateSelection, finishDraft, rotateSelection, undoDraftPoint } from '../editor/actions';
import { useDerived } from '../editor/derived';
import { Palette } from '../editor/panels/Palette';
import { Properties } from '../editor/panels/Properties';
import { StatusBar, newSheet } from '../editor/panels/StatusBar';
import { ToolOptionsBar, Toolbar } from '../editor/panels/Toolbar';
import { VersionsPanel } from '../editor/panels/Versions';
import { editor, useEditor, useSheet, type Tool } from '../editor/store';
import { api, ApiError } from '../lib/api';
import { uploadPlanFile } from '../lib/images';
import { toastError } from '../lib/toast';

function useAutosave(projectId: string) {
  const running = useRef<Promise<boolean> | null>(null);
  const version = useEditor((s) => s.version);
  const saveState = useEditor((s) => s.saveState);

  const save = useCallback(async (): Promise<boolean> => {
    if (running.current) await running.current;
    const s = useEditor.getState();
    if (!s.doc || s.projectId !== projectId || s.version === s.savedVersion) return true;
    if (s.saveState === 'conflict') return false;
    const v = s.version;
    useEditor.setState({ saveState: 'saving' });
    const p = (async () => {
      try {
        const r = await api.savePlan(projectId, s.doc!, s.revision);
        const now = useEditor.getState();
        useEditor.setState({ revision: r.revision, savedVersion: v, saveState: now.version === v ? 'saved' : 'dirty' });
        return true;
      } catch (e) {
        useEditor.setState({ saveState: e instanceof ApiError && e.status === 409 ? 'conflict' : 'error' });
        return false;
      }
    })();
    running.current = p;
    const ok = await p;
    running.current = null;
    return ok;
  }, [projectId]);

  useEffect(() => {
    const s = useEditor.getState();
    if (s.version === s.savedVersion || saveState === 'conflict') return;
    const t = setTimeout(save, saveState === 'error' ? 5000 : 700);
    return () => clearTimeout(t);
  }, [version, saveState, save]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      const s = useEditor.getState();
      if (s.version !== s.savedVersion) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      void save();
    };
  }, [save]);

  return save;
}

const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'pan', k: 'cable', l: 'linear', r: 'rect', o: 'ellipse', t: 'text', m: 'scale' };

function useShortcuts(derived: ReturnType<typeof useDerived>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return;
      if (document.querySelector('.fixed.inset-0.z-50')) return; // Dialog offen
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        editor.redo();
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        if (!s.preview) duplicateSelection(derived);
        return;
      }
      if (mod) return;
      if (e.key === 'Escape') {
        if (s.draft) useEditor.setState({ draft: null });
        else if (s.tool !== 'select') editor.setTool('select');
        else if (s.preview) useEditor.setState({ preview: null });
        else editor.select(null);
        return;
      }
      if (e.key === 'Enter') {
        finishDraft();
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (s.draft) undoDraftPoint();
        else if (!s.preview) editor.deleteSelection();
        return;
      }
      if (key === '0') {
        window.dispatchEvent(new Event('taxis:fit'));
        return;
      }
      if (key === 'q' || key === 'e') {
        if (!s.preview) rotateSelection((key === 'e' ? 1 : -1) * (e.shiftKey ? 90 : 15));
        return;
      }
      const tool = TOOL_KEYS[key];
      if (tool && (!s.preview || tool === 'select' || tool === 'pan')) editor.setTool(tool);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [derived]);
}

export function EditorPage() {
  const { projectId = '' } = useParams();
  const doc = useEditor((s) => (s.projectId === projectId ? s.doc : null));
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const state = await api.plan(projectId);
      editor.load(projectId, state.doc, state.revision);
      const sel = new URLSearchParams(window.location.search).get('sel');
      const sheet = sel ? state.doc.sheets.find((s) => s.items.some((i) => i.id === sel)) : undefined;
      if (sel && sheet) useEditor.setState({ sheetId: sheet.id, selection: { kind: 'item', id: sel } });
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    useEditor.setState({ doc: null, projectId: null });
    load();
  }, [load]);

  const save = useAutosave(projectId);
  const derived = useDerived();
  useShortcuts(derived);

  if (loadError) return <div className="p-8 text-sm text-red-600">{loadError}</div>;
  if (!doc)
    return (
      <div className="flex h-full items-center justify-center text-zinc-400">
        <Loader2 className="animate-spin" />
      </div>
    );

  return (
    <EditorLayout projectId={projectId} derived={derived} save={save} reload={load} />
  );
}

function EditorLayout({
  projectId,
  derived,
  save,
  reload,
}: {
  projectId: string;
  derived: ReturnType<typeof useDerived>;
  save: () => Promise<boolean>;
  reload: () => Promise<void>;
}) {
  const doc = useEditor((s) => s.doc!);
  const sheet = useSheet();
  const preview = useEditor((s) => s.preview);
  const saveState = useEditor((s) => s.saveState);
  const rightPanel = useEditor((s) => s.rightPanel);
  const tool = useEditor((s) => s.tool);
  const [addSheet, setAddSheet] = useState(false);

  if (doc.sheets.length === 0) return <FirstSheet />;

  const keepMine = async () => {
    try {
      const server = await api.plan(projectId);
      useEditor.setState({ revision: server.revision, saveState: 'dirty', savedVersion: -1 });
      await save();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <Toolbar derived={derived} />
      {preview && (
        <Banner tone="blue">
          Du siehst die Version <b>„{preview.name}“</b> (nur lesen).
          <Button size="sm" className="ml-auto" onClick={() => useEditor.setState({ preview: null })}>
            <X size={14} /> Zurück zum aktuellen Stand
          </Button>
        </Banner>
      )}
      {saveState === 'conflict' && (
        <Banner tone="red">
          <AlertTriangle size={16} /> Der Plan wurde zwischenzeitlich an anderer Stelle geändert.
          <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={reload}>
              Neu laden (meine Änderungen verwerfen)
            </Button>
            <Button size="sm" variant="primary" onClick={keepMine}>
              Meinen Stand speichern
            </Button>
          </div>
        </Banner>
      )}
      {!preview && sheet && !sheet.scale && tool !== 'scale' && (
        <Banner tone="amber">
          <Ruler size={16} /> Für dieses Blatt ist noch kein Maßstab gesetzt – Größen sind geschätzt, Längen werden nicht berechnet.
          <Button size="sm" className="ml-auto" onClick={() => editor.setTool('scale')}>
            Maßstab setzen
          </Button>
        </Banner>
      )}
      <div className="flex min-h-0 flex-1">
        <Palette derived={derived} />
        <div className="relative min-w-0 flex-1">
          <PlanCanvas derived={derived} />
          <ToolOptionsBar derived={derived} />
        </div>
        <aside className="no-print flex w-80 shrink-0 flex-col border-l border-zinc-200 bg-surface">
          {rightPanel === 'versions' ? <VersionsPanel projectId={projectId} flush={save} /> : <Properties derived={derived} />}
        </aside>
      </div>
      <StatusBar onAddSheet={() => setAddSheet(true)} />
      {addSheet && <AddSheetDialog onClose={() => setAddSheet(false)} index={doc.sheets.length + 1} />}
    </div>
  );
}

function Banner({ tone, children }: { tone: 'blue' | 'amber' | 'red'; children: React.ReactNode }) {
  const cls = {
    blue: 'bg-blue-50 text-blue-900 border-blue-100',
    amber: 'bg-amber-50 text-amber-900 border-amber-100',
    red: 'bg-red-50 text-red-900 border-red-100',
  }[tone];
  return <div className={`no-print flex shrink-0 items-center gap-2 border-b px-4 py-1.5 text-[13px] ${cls}`}>{children}</div>;
}

async function createSheetFromFile(name: string, file: File | null) {
  const img = file ? await uploadPlanFile(file) : undefined;
  const sheet = newSheet(name, img);
  editor.update((d) => void d.sheets.push(sheet));
  useEditor.setState({ sheetId: sheet.id, selection: null, tool: img ? 'scale' : 'select' });
}

function FirstSheet() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const run = async (file: File | null) => {
    setBusy(true);
    try {
      await createSheetFromFile('Gelände', file);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div
        className={`w-full max-w-lg rounded-2xl border-2 border-dashed bg-surface p-10 text-center transition ${dragOver ? 'border-accent bg-accent-soft' : 'border-zinc-200'}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) run(f);
        }}
      >
        <ImageUp className="mx-auto mb-3 text-zinc-400" size={32} />
        <h2 className="text-lg font-semibold">Lageplan hinzufügen</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500">
          Bild (PNG, JPG) oder PDF hierher ziehen. Danach markierst du eine bekannte Strecke, um den Maßstab zu setzen.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ImageUp size={16} />} Datei wählen
          </Button>
          <Button disabled={busy} onClick={() => run(null)}>
            <FilePlus2 size={16} /> Ohne Bild starten
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) run(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

function AddSheetDialog({ onClose, index }: { onClose: () => void; index: number }) {
  const [name, setName] = useState(`Blatt ${index}`);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await createSheetFromFile(name.trim() || `Blatt ${index}`, file);
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Neues Blatt"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={busy} onClick={submit}>
            {busy && <Loader2 size={14} className="animate-spin" />} Anlegen
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name" hint="z.B. Bühne, Zelt-Innenraum, Backstage">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Hintergrund (optional)" hint="Ohne Bild: leeres Raster 150 × 100 m">
          <input
            type="file"
            accept="image/*,application/pdf"
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm file:font-medium"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
      </div>
    </Modal>
  );
}
