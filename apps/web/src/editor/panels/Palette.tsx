import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CATEGORIES, type Material } from '@taxis/shared';
import { Input, Swatch, cx } from '../../components/ui';
import type { Derived } from '../derived';
import { useEditor } from '../store';

export function Palette({ derived }: { derived: Derived }) {
  const [q, setQ] = useState('');
  const tool = useEditor((s) => s.tool);
  const placeId = useEditor((s) => s.placeMaterialId);
  const cableId = useEditor((s) => s.cable.materialId);
  const linearId = useEditor((s) => s.linearMaterialId);
  const readOnly = useEditor((s) => !!s.preview);

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    const list = derived.materials.filter(
      (m) => !m.archived && (!query || m.name.toLowerCase().includes(query) || m.category.toLowerCase().includes(query)),
    );
    const map = new Map<string, Material[]>();
    for (const m of list) map.set(m.category, [...(map.get(m.category) ?? []), m]);
    const order = (c: string) => {
      const i = (CATEGORIES as readonly string[]).indexOf(c);
      return i < 0 ? 99 : i;
    };
    return [...map.entries()].sort((a, b) => order(a[0]) - order(b[0]));
  }, [derived.materials, q]);

  const activate = (m: Material) => {
    if (readOnly) return;
    if (m.kind === 'item') useEditor.setState({ tool: 'place', placeMaterialId: m.id, draft: null, selection: null });
    if (m.kind === 'cable') useEditor.setState((s) => ({ tool: 'cable', cable: { ...s.cable, materialId: m.id }, draft: null }));
    if (m.kind === 'linear') useEditor.setState({ tool: 'linear', linearMaterialId: m.id, draft: null });
  };

  const isActive = (m: Material) =>
    (tool === 'place' && placeId === m.id) || (tool === 'cable' && cableId === m.id) || (tool === 'linear' && linearId === m.id);

  return (
    <aside className="no-print flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-surface">
      <div className="p-2.5">
        <div className="relative">
          <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-zinc-400" />
          <Input className="h-8 pl-8 text-[13px]" placeholder="Material suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 pb-3">
        {groups.map(([cat, list]) => (
          <div key={cat} className="mb-2">
            <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">{cat}</div>
            {list.map((m) => {
              const avail = m.kind === 'item' ? derived.canPlace(m) : { ok: true, label: '' };
              const limited = m.kind === 'item' && m.stockMode === 'limited';
              return (
                <button
                  key={m.id}
                  type="button"
                  draggable={m.kind === 'item' && avail.ok && !readOnly}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-taxis-material', m.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => activate(m)}
                  disabled={readOnly}
                  title={
                    m.kind === 'item'
                      ? avail.ok
                        ? 'Klicken oder auf den Plan ziehen'
                        : 'Nicht mehr verfügbar – Bestand oder Anfragen erhöhen'
                      : m.kind === 'cable'
                        ? 'Kabel verlegen'
                        : 'Strecke zeichnen'
                  }
                  className={cx(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                    isActive(m) ? 'bg-accent-soft text-accent' : 'text-zinc-700 hover:bg-zinc-100',
                    !avail.ok && 'opacity-45',
                  )}
                >
                  {m.kind === 'cable' ? (
                    <span className="h-0.5 w-3 shrink-0 rounded" style={{ background: m.color }} />
                  ) : (
                    <Swatch color={m.color} round={m.shape === 'circle'} />
                  )}
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  {avail.label && (
                    <span
                      className={cx(
                        'shrink-0 text-[11px] tabular-nums',
                        limited ? (avail.ok ? 'text-zinc-500' : 'font-medium text-red-600') : 'text-zinc-400',
                      )}
                    >
                      {avail.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        {groups.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-zinc-500">
            Nichts gefunden. <Link className="text-accent hover:underline" to="/material">Material anlegen</Link>
          </div>
        )}
      </div>
    </aside>
  );
}
