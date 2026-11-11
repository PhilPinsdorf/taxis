import { Check, CloudOff, Loader2, Plus, X } from 'lucide-react';
import { newId, type Sheet } from '@taxis/shared';
import { cx } from '../../components/ui';
import { editor, ppmOf, useEditor, useSheet, useViewDoc } from '../store';

export function StatusBar({ onAddSheet }: { onAddSheet: () => void }) {
  const doc = useViewDoc();
  const sheet = useSheet();
  const cursor = useEditor((s) => s.cursor);
  const zoom = useEditor((s) => s.zoom);
  const saveState = useEditor((s) => s.saveState);
  const readOnly = useEditor((s) => !!s.preview);
  const ppm = ppmOf(sheet);

  const removeSheet = (s: Sheet) => {
    if (!doc || doc.sheets.length <= 1) return;
    if (!confirm(`Blatt „${s.name}“ mit allen Objekten löschen?`)) return;
    editor.update((d) => void (d.sheets = d.sheets.filter((x) => x.id !== s.id)));
    useEditor.setState({ sheetId: doc.sheets.find((x) => x.id !== s.id)?.id ?? null, selection: null });
  };

  return (
    <div className="no-print flex h-9 shrink-0 items-center gap-3 border-t border-zinc-200 bg-surface px-2 text-xs text-zinc-500">
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {doc?.sheets.map((s) => (
          <div
            key={s.id}
            className={cx(
              'group flex h-7 items-center gap-1 rounded-md px-2.5 text-[13px] whitespace-nowrap',
              s.id === sheet?.id ? 'bg-zinc-100 font-medium text-zinc-900' : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800',
            )}
          >
            <button onClick={() => useEditor.setState({ sheetId: s.id, selection: null, draft: null })}>{s.name}</button>
            {!readOnly && doc.sheets.length > 1 && s.id === sheet?.id && (
              <button className="opacity-0 group-hover:opacity-60 hover:opacity-100!" title="Blatt löschen" onClick={() => removeSheet(s)}>
                <X size={12} />
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button className="flex h-7 items-center gap-1 rounded-md px-2 hover:bg-zinc-50 hover:text-zinc-800" onClick={onAddSheet} title="Blatt hinzufügen">
            <Plus size={14} /> Blatt
          </button>
        )}
      </div>
      <div className="flex-1" />
      {cursor && (
        <span className="tabular-nums">
          {(cursor[0] / ppm).toLocaleString('de-DE', { maximumFractionDigits: 1 })} ·{' '}
          {(cursor[1] / ppm).toLocaleString('de-DE', { maximumFractionDigits: 1 })} m
        </span>
      )}
      <span className="w-12 text-right tabular-nums">{Math.round(zoom * 100)} %</span>
      <span className="flex w-28 items-center justify-end gap-1">
        {readOnly ? (
          <span>Nur ansehen</span>
        ) : saveState === 'saved' ? (
          <>
            <Check size={13} className="text-emerald-600" /> Gespeichert
          </>
        ) : saveState === 'saving' || saveState === 'dirty' ? (
          <>
            <Loader2 size={13} className="animate-spin" /> Speichert…
          </>
        ) : (
          <span className="flex items-center gap-1 text-red-600">
            <CloudOff size={13} /> {saveState === 'conflict' ? 'Konflikt' : 'Nicht gespeichert'}
          </span>
        )}
      </span>
    </div>
  );
}

export function newSheet(name: string, image?: { id: string; width: number; height: number }): Sheet {
  if (image) {
    return {
      id: newId(),
      name,
      imageId: image.id,
      imageW: image.width,
      imageH: image.height,
      scale: null,
      items: [],
      cables: [],
      linears: [],
      shapes: [],
    };
  }
  // Leeres Blatt: 150 × 100 m bei 20 px/m, Maßstab bekannt
  return {
    id: newId(),
    name,
    imageId: null,
    imageW: 3000,
    imageH: 2000,
    scale: { pxPerMeter: 20, a: [0, 0], b: [200, 0], meters: 10 },
    items: [],
    cables: [],
    linears: [],
    shapes: [],
  };
}
