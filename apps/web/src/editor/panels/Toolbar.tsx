import {
  Cable,
  Circle,
  Eye,
  Hand,
  History,
  Maximize,
  MousePointer2,
  Redo2,
  Ruler,
  Square,
  Type,
  Undo2,
  Waypoints,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CATEGORIES, fixedMaxDrawM, formatMeters } from '@taxis/shared';
import { Button, Checkbox, Kbd, NumberInput, Segmented, Select, cx } from '../../components/ui';
import { cableReserve } from '../actions';
import type { Derived } from '../derived';
import { editor, useEditor, type Tool } from '../store';

function ToolButton({ tool, icon, label, shortcut }: { tool: Tool; icon: ReactNode; label: string; shortcut: string }) {
  const active = useEditor((s) => s.tool === tool);
  const readOnly = useEditor((s) => !!s.preview);
  const disabled = readOnly && tool !== 'select' && tool !== 'pan';
  return (
    <Button
      variant="ghost"
      size="icon"
      active={active}
      disabled={disabled}
      title={`${label} (${shortcut})`}
      aria-label={label}
      onClick={() => editor.setTool(tool)}
    >
      {icon}
    </Button>
  );
}

const Sep = () => <span className="mx-1 h-5 w-px bg-zinc-200" />;

export function Toolbar({ derived }: { derived: Derived }) {
  const canUndo = useEditor((s) => s.past.length > 0 && !s.preview);
  const canRedo = useEditor((s) => s.future.length > 0 && !s.preview);
  const rightPanel = useEditor((s) => s.rightPanel);

  return (
    <>
    <div className="no-print flex h-11 shrink-0 items-center gap-0.5 border-b border-zinc-200 bg-surface px-2">
      <ToolButton tool="select" icon={<MousePointer2 size={16} />} label="Auswählen" shortcut="V" />
      <ToolButton tool="pan" icon={<Hand size={16} />} label="Verschieben" shortcut="H / Leertaste" />
      <Sep />
      <ToolButton tool="cable" icon={<Cable size={16} />} label="Kabel verlegen" shortcut="K" />
      <ToolButton tool="linear" icon={<Waypoints size={16} />} label="Defender / Kabelmatte" shortcut="L" />
      <Sep />
      <ToolButton tool="rect" icon={<Square size={16} />} label="Rechteck" shortcut="R" />
      <ToolButton tool="ellipse" icon={<Circle size={16} />} label="Kreis / Ellipse" shortcut="O" />
      <ToolButton tool="text" icon={<Type size={16} />} label="Text" shortcut="T" />
      <Sep />
      <ToolButton tool="scale" icon={<Ruler size={16} />} label="Maßstab setzen" shortcut="M" />

      <div className="min-w-0 flex-1 px-2">
        <ToolHint />
      </div>

      <Button variant="ghost" size="icon" title="Verkleinern" onClick={() => window.dispatchEvent(new CustomEvent('taxis:zoom', { detail: 1 / 1.25 }))}>
        <ZoomOut size={16} />
      </Button>
      <Button variant="ghost" size="icon" title="Vergrößern" onClick={() => window.dispatchEvent(new CustomEvent('taxis:zoom', { detail: 1.25 }))}>
        <ZoomIn size={16} />
      </Button>
      <Button variant="ghost" size="icon" title="Einpassen (0)" onClick={() => window.dispatchEvent(new Event('taxis:fit'))}>
        <Maximize size={16} />
      </Button>
      <Sep />
      <Button variant="ghost" size="icon" title="Rückgängig (Strg+Z)" disabled={!canUndo} onClick={editor.undo}>
        <Undo2 size={16} />
      </Button>
      <Button variant="ghost" size="icon" title="Wiederholen (Strg+Umschalt+Z)" disabled={!canRedo} onClick={editor.redo}>
        <Redo2 size={16} />
      </Button>
      <Sep />
      <LayersMenu />
      <Button
        variant="ghost"
        size="sm"
        active={rightPanel === 'versions'}
        onClick={() => useEditor.setState({ rightPanel: rightPanel === 'versions' ? 'props' : 'versions' })}
      >
        <History size={15} /> Versionen
      </Button>
    </div>
    </>
  );
}

/** Schwebende Optionsleiste über der Zeichenfläche (Kabel / Strecken) */
export function ToolOptionsBar({ derived }: { derived: Derived }) {
  const tool = useEditor((s) => s.tool);
  if (tool !== 'cable' && tool !== 'linear') return null;
  return (
    <div className="no-print pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-center">
      <div className="pointer-events-auto flex max-w-full items-center rounded-xl border border-zinc-200 bg-surface/95 px-2.5 py-1.5 shadow-lg backdrop-blur">
        {tool === 'cable' ? <CableOptions derived={derived} /> : <LinearOptions derived={derived} />}
      </div>
    </div>
  );
}

function LayersMenu() {
  const [open, setOpen] = useState(false);
  const hidden = useEditor((s) => s.hiddenCategories);
  const showLabels = useEditor((s) => s.showLabels);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="sm" active={open} onClick={() => setOpen(!open)}>
        <Eye size={15} /> Ebenen{hidden.length > 0 && <span className="text-xs text-zinc-400">({hidden.length} aus)</span>}
      </Button>
      {open && (
        <div className="absolute top-10 right-0 z-30 w-56 space-y-2 rounded-xl border border-zinc-200 bg-surface p-3 shadow-lg">
          {CATEGORIES.filter((c) => c !== 'Generisch').map((c) => (
            <Checkbox
              key={c}
              label={c}
              checked={!hidden.includes(c)}
              onChange={(v) =>
                useEditor.setState({ hiddenCategories: v ? hidden.filter((x) => x !== c) : [...hidden, c], selection: null })
              }
            />
          ))}
          <div className="border-t border-zinc-100 pt-2">
            <Checkbox label="Beschriftungen" checked={showLabels} onChange={(v) => useEditor.setState({ showLabels: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

function ToolHint() {
  const tool = useEditor((s) => s.tool);
  const draft = useEditor((s) => s.draft);
  const hints: Partial<Record<Tool, ReactNode>> = {
    select: (
      <>
        Klicken = auswählen · Ziehen = verschieben · <Kbd>Q</Kbd>/<Kbd>E</Kbd> drehen · <Kbd>Strg</Kbd>+<Kbd>D</Kbd> duplizieren
      </>
    ),
    pan: 'Ziehen zum Verschieben, Mausrad zum Zoomen',
    scale: 'Zwei Punkte einer bekannten Strecke anklicken, dann Länge eingeben',
    rect: 'Klicken, um ein Rechteck zu platzieren',
    ellipse: 'Klicken, um eine Ellipse zu platzieren',
    text: 'Klicken, um einen Text zu platzieren',
    place: (
      <>
        Klicken zum Platzieren · <Kbd>Esc</Kbd> beendet
      </>
    ),
    cable: 'Kabel verlegen',
    linear: 'Defender / Kabelmatte verlegen',
  };
  return <div className={cx('truncate text-xs text-zinc-500', draft && 'text-zinc-700')}>{hints[tool]}</div>;
}

function CableOptions({ derived }: { derived: Derived }) {
  const opts = useEditor((s) => s.cable);
  const doc = useEditor((s) => s.doc);
  const draft = useEditor((s) => s.draft);
  const cables = derived.materials.filter((m) => m.kind === 'cable' && !m.archived);
  const material = opts.materialId ? derived.byId.get(opts.materialId) : undefined;
  // Typ-/Moduswechsel verwirft einen angefangenen Entwurf (Stecker/Länge passen sonst nicht)
  const set = (patch: Partial<typeof opts>) => {
    const resets = 'materialId' in patch || 'mode' in patch || 'fixedLength' in patch;
    useEditor.setState({ cable: { ...opts, ...patch }, ...(resets ? { draft: null } : {}) });
  };

  useEffect(() => {
    if (!opts.materialId && cables[0]) set({ materialId: cables[0].id });
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const lengths = material ? [...new Set(material.stockLengths.map((l) => l.length))].sort((a, b) => a - b) : [];
  const reserve = cableReserve(doc);
  const maxDraw =
    opts.mode === 'fixed' && opts.fixedLength ? fixedMaxDrawM(opts.fixedLength, reserve, opts.heightStart, opts.heightEnd) : null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
      <Select
        className="h-8 w-44 text-[13px]"
        value={opts.materialId ?? ''}
        onChange={(e) => set({ materialId: e.target.value })}
        title="Kabeltyp"
      >
        {cables.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Segmented
        size="sm"
        value={opts.mode}
        onChange={(mode) => set({ mode, fixedLength: mode === 'fixed' ? (opts.fixedLength ?? lengths[0] ?? 10) : opts.fixedLength })}
        options={[
          { value: 'free', label: 'Frei', title: 'Beliebige Länge – Bedarf wird berechnet' },
          { value: 'fixed', label: 'Feste Länge', title: 'Konkretes Kabel – kann nicht länger gezogen werden' },
        ]}
      />
      {opts.mode === 'fixed' && (
        <Select
          className="h-8 w-24 text-[13px]"
          title="Kabellänge"
          value={opts.fixedLength ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'custom') {
              const n = Number(prompt('Kabellänge in m', String(opts.fixedLength ?? 10))?.replace(',', '.'));
              if (n > 0) set({ fixedLength: n });
            } else set({ fixedLength: Number(v) });
          }}
        >
          {[...new Set([...lengths, ...(opts.fixedLength ? [opts.fixedLength] : [])])]
            .sort((a, b) => a - b)
            .map((l) => (
              <option key={l} value={l}>
                {l.toLocaleString('de-DE')} m
              </option>
            ))}
          <option value="custom">Andere…</option>
        </Select>
      )}
      <span className="ml-1 text-zinc-500" title="Höhe am Start / Ende, z.B. Traverse">
        Höhe
      </span>
      <NumberInput className="h-8 w-14 text-[13px]" min={0} step={0.5} value={opts.heightStart} onChange={(v) => set({ heightStart: Math.max(0, v ?? 0) })} title="Höhe am Start (m)" />
      <NumberInput className="h-8 w-14 text-[13px]" min={0} step={0.5} value={opts.heightEnd} onChange={(v) => set({ heightEnd: Math.max(0, v ?? 0) })} title="Höhe am Ende (m)" />
      <span className="ml-1 text-zinc-500">Reserve</span>
      <NumberInput
        className="h-8 w-14 text-[13px]"
        min={0}
        max={90}
        step={5}
        allowNull
        placeholder={String(doc?.settings.defaultReservePct ?? 10)}
        value={opts.reservePct}
        onChange={(v) => set({ reservePct: v == null ? null : Math.min(90, Math.max(0, v)) })}
        title="Reserve in % (leer = Projektstandard)"
      />
      <span className="text-zinc-500">%</span>
      <span className="pl-2 whitespace-nowrap text-zinc-500">
        {maxDraw != null && <>max. {formatMeters(maxDraw)} · </>}
        {draft ? (
          <>
            <Kbd>Enter</Kbd> beendet · <Kbd>⌫</Kbd> Punkt zurück
          </>
        ) : (
          'Start: Gerät oder Kabelende anklicken'
        )}
      </span>
    </div>
  );
}

function LinearOptions({ derived }: { derived: Derived }) {
  const id = useEditor((s) => s.linearMaterialId);
  const draft = useEditor((s) => s.draft);
  const list = derived.materials.filter((m) => m.kind === 'linear' && !m.archived);
  useEffect(() => {
    if (!id && list[0]) useEditor.setState({ linearMaterialId: list[0].id });
  }); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex items-center gap-2 text-xs">
      <Select className="h-8 w-44 text-[13px]" value={id ?? ''} onChange={(e) => useEditor.setState({ linearMaterialId: e.target.value })}>
        {list.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
      <span className="whitespace-nowrap text-zinc-500">
        {draft ? (
          <>
            <Kbd>Enter</Kbd>/Doppelklick beendet
          </>
        ) : (
          'Punkte entlang der Strecke klicken'
        )}
      </span>
    </div>
  );
}
