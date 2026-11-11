import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Cable, Box, Plus, Search, Settings2, Trash2, Waypoints } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  CATEGORIES,
  MaterialInputSchema,
  newId,
  type Material,
  type MaterialInput,
  type MaterialKind,
  type Port,
} from '@taxis/shared';
import {
  Badge,
  Button,
  Checkbox,
  Drawer,
  EmptyState,
  Field,
  Input,
  Modal,
  NumberInput,
  Segmented,
  Select,
  SectionTitle,
  Swatch,
  Textarea,
} from '../components/ui';
import { api } from '../lib/api';
import { qk, useConnectors, useMaterials } from '../lib/queries';
import { toast, toastError } from '../lib/toast';

export const KIND_LABEL: Record<MaterialKind, string> = { item: 'Objekt', cable: 'Kabel', linear: 'Strecke' };
const KIND_ICON: Record<MaterialKind, typeof Box> = { item: Box, cable: Cable, linear: Waypoints };

function stockSummary(m: Material): string {
  if (m.kind === 'cable') {
    const total = m.stockLengths.reduce((s, l) => s + l.length * l.qty, 0);
    if (m.stockLengths.length === 0) return '–';
    return `${m.stockLengths
      .filter((l) => l.qty > 0)
      .map((l) => `${l.qty}×${l.length} m`)
      .join(', ') || 'keine'} · ${total} m`;
  }
  return `${m.stockQty} ${m.kind === 'linear' ? 'Segm.' : 'Stk'}`;
}

function sizeSummary(m: Material): string {
  if (m.kind === 'cable') return m.connector ? `${m.connector}${m.channels ? ` · ${m.channels} Kan.` : ''}` : '';
  if (m.kind === 'linear') return `${m.segmentLength ?? '–'} m Segment · ${m.width} m breit`;
  return `${m.width} × ${m.depth} m${m.resizable ? ' · anpassbar' : ''}`;
}

export function MaterialsPage() {
  const qc = useQueryClient();
  const { materials, isLoading } = useMaterials();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<MaterialKind | 'all'>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Material | 'new' | null>(null);
  const [connectorsOpen, setConnectorsOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return materials.filter(
      (m) =>
        (showArchived || !m.archived) &&
        (kind === 'all' || m.kind === kind) &&
        (!q || m.name.toLowerCase().includes(q) || m.category.toLowerCase().includes(q)),
    );
  }, [materials, query, kind, showArchived]);

  const groups = useMemo(() => {
    const map = new Map<string, Material[]>();
    for (const m of filtered) map.set(m.category, [...(map.get(m.category) ?? []), m]);
    const order = (c: string) => {
      const i = (CATEGORIES as readonly string[]).indexOf(c);
      return i < 0 ? 99 : i;
    };
    return [...map.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
  }, [filtered]);

  const save = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: MaterialInput }) =>
      id ? api.updateMaterial(id, input) : api.createMaterial(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.materials });
      setEditing(null);
      toast('Material gespeichert', 'success');
    },
    onError: toastError,
  });

  const archive = async (m: Material) => {
    if (!confirm(`„${m.name}“ archivieren? Bestehende Pläne behalten die Referenz.`)) return;
    await api.archiveMaterial(m.id).catch(toastError);
    qc.invalidateQueries({ queryKey: qk.materials });
    setEditing(null);
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Material</h1>
          <p className="text-sm text-zinc-500">Katalog, Eigenbestand und Anschlüsse – gilt für alle Projekte.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setConnectorsOpen(true)}>
            <Settings2 size={16} /> Steckertypen
          </Button>
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Material
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search size={15} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-zinc-400" />
          <Input className="pl-8" placeholder="Suchen…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'Alle' },
            { value: 'item', label: 'Objekte' },
            { value: 'cable', label: 'Kabel' },
            { value: 'linear', label: 'Strecken' },
          ]}
        />
        <Checkbox checked={showArchived} onChange={setShowArchived} label="Archivierte zeigen" />
      </div>

      {!isLoading && filtered.length === 0 && (
        <EmptyState icon={<Box size={28} />} title="Kein Material gefunden" />
      )}

      <div className="space-y-6">
        {groups.map(([cat, list]) => (
          <section key={cat}>
            <SectionTitle>{cat}</SectionTitle>
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-surface shadow-xs">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-zinc-100">
                  {list.map((m) => {
                    const Icon = KIND_ICON[m.kind];
                    return (
                      <tr
                        key={m.id}
                        className="cursor-pointer transition-colors hover:bg-zinc-50"
                        onClick={() => setEditing(m)}
                      >
                        <td className="w-[34%] py-2.5 pl-4">
                          <div className="flex items-center gap-2.5">
                            <Swatch color={m.color} round={m.shape === 'circle'} />
                            <span className="font-medium">{m.name}</span>
                            {m.archived && <Badge>archiviert</Badge>}
                          </div>
                        </td>
                        <td className="w-24 text-zinc-500">
                          <span className="inline-flex items-center gap-1.5">
                            <Icon size={14} /> {KIND_LABEL[m.kind]}
                          </span>
                        </td>
                        <td className="text-zinc-600">{sizeSummary(m)}</td>
                        <td className="text-zinc-600">
                          {stockSummary(m)}
                          {m.stockMode === 'limited' && m.kind === 'item' && (
                            <Badge tone="amber" className="ml-2">
                              begrenzt
                            </Badge>
                          )}
                        </td>
                        <td className="pr-4 text-right text-zinc-500">
                          {m.ports.length > 0 && (
                            <span className="text-xs">
                              {m.ports.map((p) => `${p.count > 1 ? `${p.count}× ` : ''}${p.connector}`).join(' · ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {editing && (
        <MaterialDrawer
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(input) => save.mutate({ id: editing === 'new' ? null : editing.id, input })}
          onArchive={editing === 'new' ? undefined : () => archive(editing)}
          busy={save.isPending}
        />
      )}
      {connectorsOpen && <ConnectorDialog onClose={() => setConnectorsOpen(false)} />}
    </div>
  );
}

function MaterialDrawer({
  initial,
  onClose,
  onSave,
  onArchive,
  busy,
}: {
  initial: Material | null;
  onClose: () => void;
  onSave: (m: MaterialInput) => void;
  onArchive?: () => void;
  busy: boolean;
}) {
  const { data: connectors = [] } = useConnectors();
  const [m, setM] = useState<MaterialInput>(() => {
    if (initial) {
      const { id: _id, ...rest } = initial;
      return rest;
    }
    return MaterialInputSchema.parse({ name: '', category: 'Generisch', kind: 'item' });
  });
  const set = <K extends keyof MaterialInput>(k: K, v: MaterialInput[K]) => setM((s) => ({ ...s, [k]: v }));

  const setPort = (i: number, patch: Partial<Port>) =>
    set(
      'ports',
      m.ports.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    );

  const valid =
    m.name.trim() &&
    (m.kind !== 'cable' || m.connector) &&
    (m.kind !== 'linear' || (m.segmentLength ?? 0) > 0) &&
    m.width > 0 &&
    m.depth > 0;

  return (
    <Drawer
      open
      onClose={onClose}
      title={initial ? initial.name : 'Neues Material'}
      footer={
        <>
          {onArchive && !initial?.archived && (
            <Button variant="danger" className="mr-auto" onClick={onArchive}>
              <Archive size={15} /> Archivieren
            </Button>
          )}
          {initial?.archived && (
            <Button className="mr-auto" onClick={() => onSave({ ...m, archived: false })}>
              Wiederherstellen
            </Button>
          )}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!valid || busy} onClick={() => onSave({ ...m, name: m.name.trim() })}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="space-y-3">
          <Field label="Name">
            <Input autoFocus value={m.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label="Kategorie">
              <Input list="categories" value={m.category} onChange={(e) => set('category', e.target.value)} />
              <datalist id="categories">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Farbe">
              <input
                type="color"
                className="h-9 w-14 cursor-pointer rounded-lg border border-zinc-200 bg-surface p-1"
                value={m.color}
                onChange={(e) => set('color', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Art">
            <Segmented
              value={m.kind}
              onChange={(kind) =>
                setM((s) => ({
                  ...s,
                  kind,
                  segmentLength: kind === 'linear' ? (s.segmentLength ?? 1) : s.segmentLength,
                  width: kind === 'linear' && s.width === 1 ? 0.5 : s.width,
                  category: kind === 'cable' && s.category === 'Generisch' ? 'Kabel' : s.category,
                }))
              }
              options={[
                { value: 'item', label: 'Objekt', title: 'Wird platziert (Zelt, Tisch, Box …)' },
                { value: 'cable', label: 'Kabel', title: 'Wird als Linie gezeichnet, Länge zählt' },
                { value: 'linear', label: 'Strecke', title: 'Defender, Kabelmatten – zählt Segmente' },
              ]}
            />
          </Field>
        </div>

        {m.kind === 'item' && (
          <div className="space-y-3">
            <SectionTitle>Maße & Bestand</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Breite (m)">
                <NumberInput min={0.05} step={0.1} value={m.width} onChange={(v) => set('width', v ?? 1)} />
              </Field>
              <Field label="Tiefe (m)">
                <NumberInput min={0.05} step={0.1} value={m.depth} onChange={(v) => set('depth', v ?? 1)} />
              </Field>
              <Field label="Form">
                <Select value={m.shape} onChange={(e) => set('shape', e.target.value as 'rect' | 'circle')}>
                  <option value="rect">Rechteck</option>
                  <option value="circle">Rund</option>
                </Select>
              </Field>
            </div>
            <Checkbox
              checked={m.resizable}
              onChange={(v) => set('resizable', v)}
              label="Größe im Plan anpassbar"
              hint="z.B. Kabelmatten, Bühnenflächen, generische Flächen"
            />
            <div className="grid grid-cols-3 gap-3">
              <Field label="Eigenbestand (Stk)">
                <NumberInput min={0} step={1} value={m.stockQty} onChange={(v) => set('stockQty', Math.max(0, Math.round(v ?? 0)))} />
              </Field>
            </div>
            <Checkbox
              checked={m.stockMode === 'limited'}
              onChange={(v) => set('stockMode', v ? 'limited' : 'unlimited')}
              label="Nur verfügbare Menge verplanbar"
              hint="Eigenbestand + Anfragen begrenzen, wie viele im Plan platziert werden können."
            />
          </div>
        )}

        {m.kind === 'linear' && (
          <div className="space-y-3">
            <SectionTitle>Segmente & Bestand</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Segmentlänge (m)">
                <NumberInput
                  min={0.1}
                  step={0.1}
                  value={m.segmentLength}
                  onChange={(v) => set('segmentLength', v && v > 0 ? v : null)}
                />
              </Field>
              <Field label="Breite (m)">
                <NumberInput min={0.05} step={0.05} value={m.width} onChange={(v) => set('width', v ?? 0.5)} />
              </Field>
              <Field label="Eigenbestand (Segm.)">
                <NumberInput min={0} step={1} value={m.stockQty} onChange={(v) => set('stockQty', Math.max(0, Math.round(v ?? 0)))} />
              </Field>
            </div>
          </div>
        )}

        {m.kind === 'cable' && (
          <div className="space-y-3">
            <SectionTitle>Stecker & Bestand</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Steckertyp">
                <Select value={m.connector ?? ''} onChange={(e) => set('connector', e.target.value || null)}>
                  <option value="">– wählen –</option>
                  {connectors.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Kanäle (Multicore)" hint="leer = einfaches Kabel">
                <NumberInput
                  allowNull
                  min={1}
                  step={1}
                  value={m.channels}
                  onChange={(v) => set('channels', v && v > 0 ? Math.round(v) : null)}
                />
              </Field>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-zinc-600">Vorhandene Längen</div>
              <div className="space-y-1.5">
                {m.stockLengths.map((l, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <NumberInput
                      className="w-24"
                      min={0.5}
                      step={0.5}
                      value={l.length}
                      onChange={(v) =>
                        set('stockLengths', m.stockLengths.map((x, j) => (j === i ? { ...x, length: v && v > 0 ? v : x.length } : x)))
                      }
                    />
                    <span className="text-sm text-zinc-500">m ×</span>
                    <NumberInput
                      className="w-20"
                      min={0}
                      step={1}
                      value={l.qty}
                      onChange={(v) =>
                        set('stockLengths', m.stockLengths.map((x, j) => (j === i ? { ...x, qty: Math.max(0, Math.round(v ?? 0)) } : x)))
                      }
                    />
                    <span className="text-sm text-zinc-500">Stk</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => set('stockLengths', m.stockLengths.filter((_, j) => j !== i))}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => set('stockLengths', [...m.stockLengths, { length: 10, qty: 0 }])}
                >
                  <Plus size={14} /> Länge
                </Button>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                Längen auch mit 0 Stück eintragen – sie werden dann als Standardgrößen für Vorschläge genutzt.
              </p>
            </div>
          </div>
        )}

        {m.kind === 'item' && (
          <div className="space-y-2">
            <SectionTitle
              action={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    set('ports', [
                      ...m.ports,
                      { id: newId(6), name: 'Eingang', connector: connectors[0] ?? 'XLR', direction: 'in', count: 1, required: false },
                    ])
                  }
                >
                  <Plus size={14} /> Anschluss
                </Button>
              }
            >
              Anschlüsse
            </SectionTitle>
            {m.ports.length === 0 && <p className="text-sm text-zinc-500">Keine Anschlüsse (z.B. Zelte, Tische).</p>}
            {m.ports.length > 0 && (
              <div className="grid grid-cols-[1fr_8.5rem_7rem_4.5rem_auto_auto] items-center gap-x-2 gap-y-1.5">
                <span className="text-xs text-zinc-500">Name</span>
                <span className="text-xs text-zinc-500">Stecker</span>
                <span className="text-xs text-zinc-500">Richtung</span>
                <span className="text-xs text-zinc-500">Anzahl</span>
                <span className="text-xs text-zinc-500">Pflicht</span>
                <span />
                {m.ports.map((p, i) => (
                  <PortRow key={p.id} port={p} connectors={connectors} onChange={(patch) => setPort(i, patch)} onRemove={() => set('ports', m.ports.filter((_, j) => j !== i))} />
                ))}
              </div>
            )}
            <p className="text-xs text-zinc-500">
              Pflicht-Anschlüsse ohne Kabel werden in der Übersicht als offen gemeldet. Anzahl &gt; 1 = Kanäle (Stagebox,
              Verteiler) – im Plan pro Gerät änderbar.
            </p>
          </div>
        )}

        <Field label="Notizen">
          <Textarea value={m.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

function PortRow({
  port,
  connectors,
  onChange,
  onRemove,
}: {
  port: Port;
  connectors: string[];
  onChange: (p: Partial<Port>) => void;
  onRemove: () => void;
}) {
  const options = connectors.includes(port.connector) ? connectors : [port.connector, ...connectors];
  return (
    <>
      <Input className="h-8" value={port.name} onChange={(e) => onChange({ name: e.target.value })} />
      <Select className="h-8" value={port.connector} onChange={(e) => onChange({ connector: e.target.value })}>
        {options.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </Select>
      <Select className="h-8" value={port.direction} onChange={(e) => onChange({ direction: e.target.value as Port['direction'] })}>
        <option value="in">Eingang</option>
        <option value="out">Ausgang</option>
        <option value="io">beides</option>
      </Select>
      <NumberInput className="h-8" min={1} step={1} value={port.count} onChange={(v) => onChange({ count: Math.max(1, Math.round(v ?? 1)) })} />
      <input
        type="checkbox"
        className="h-4 w-4 justify-self-center accent-[var(--color-accent)]"
        checked={port.required}
        onChange={(e) => onChange({ required: e.target.checked })}
      />
      <Button variant="ghost" size="icon" onClick={onRemove}>
        <Trash2 size={14} />
      </Button>
    </>
  );
}

function ConnectorDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data = [] } = useConnectors();
  const [text, setText] = useState(data.join('\n'));
  const save = async () => {
    try {
      await api.saveConnectorTypes(text.split('\n').map((s) => s.trim()).filter(Boolean));
      qc.invalidateQueries({ queryKey: qk.connectors });
      onClose();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Steckertypen"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save}>
            Speichern
          </Button>
        </>
      }
    >
      <p className="mb-2 text-sm text-zinc-500">Ein Typ pro Zeile. Kabel passen auf Anschlüsse mit gleichem Typ.</p>
      <Textarea className="min-h-64 font-mono text-[13px]" value={text} onChange={(e) => setText(e.target.value)} />
    </Modal>
  );
}
