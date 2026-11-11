import { AlertCircle, CableIcon, Copy, ImageUp, Link2, RotateCw, Ruler, Trash2, Unlink } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import {
  cableDrawnM,
  cableRequiredM,
  effectivePorts,
  effectiveReservePct,
  EPS,
  fixedMaxDrawM,
  formatMeters,
  formatPieces,
  nextFreeChannel,
  polylineLengthM,
  portKey,
  type CableRun,
  type Endpoint,
  type Item,
  type Material,
  type PlanDoc,
  type Sheet,
} from '@taxis/shared';
import { Badge, Button, Field, Input, NumberInput, Segmented, Select, SectionTitle, Swatch, cx } from '../../components/ui';
import { uploadPlanFile } from '../../lib/images';
import { toast, toastError } from '../../lib/toast';
import { duplicateSelection, rotateSelection, startExtension } from '../actions';
import type { Derived } from '../derived';
import { editor, useEditor, useSheet, useViewDoc } from '../store';

const Row = ({ label, children, strong }: { label: ReactNode; children: ReactNode; strong?: boolean }) => (
  <div className="flex items-baseline justify-between gap-3 py-0.5 text-[13px]">
    <span className="text-zinc-500">{label}</span>
    <span className={cx('text-right tabular-nums', strong ? 'font-semibold text-zinc-900' : 'text-zinc-800')}>{children}</span>
  </div>
);

export function Properties({ derived }: { derived: Derived }) {
  const selection = useEditor((s) => s.selection);
  const sheet = useSheet();
  const doc = useViewDoc();
  const readOnly = useEditor((s) => !!s.preview);
  if (!sheet || !doc) return null;

  let body: ReactNode = <SheetProps sheet={sheet} doc={doc} readOnly={readOnly} />;
  if (selection?.kind === 'item') {
    const it = sheet.items.find((i) => i.id === selection.id);
    if (it) body = <ItemProps item={it} sheet={sheet} derived={derived} readOnly={readOnly} />;
  } else if (selection?.kind === 'cable') {
    const c = sheet.cables.find((i) => i.id === selection.id);
    if (c) body = <CableProps cable={c} sheet={sheet} doc={doc} derived={derived} readOnly={readOnly} />;
  } else if (selection?.kind === 'linear') {
    const l = sheet.linears.find((i) => i.id === selection.id);
    if (l) {
      const m = derived.byId.get(l.materialId);
      const len = polylineLengthM(l.points, sheet.scale);
      body = (
        <Section title={m?.name ?? 'Strecke'} color={m?.color} readOnly={readOnly}>
          <Field label="Typ">
            <Select
              disabled={readOnly}
              value={l.materialId}
              onChange={(e) =>
                editor.updateSheet((s) => {
                  const x = s.linears.find((o) => o.id === l.id);
                  if (x) x.materialId = e.target.value;
                })
              }
            >
              {derived.materials
                .filter((x) => x.kind === 'linear' && (!x.archived || x.id === l.materialId))
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="mt-3 rounded-lg bg-zinc-50 p-3">
            <Row label="Länge">{formatMeters(len)}</Row>
            {m?.segmentLength && len != null && (
              <Row label="Segmente" strong>
                {Math.ceil(len / m.segmentLength - EPS)} × {m.segmentLength.toLocaleString('de-DE')} m
              </Row>
            )}
          </div>
          <p className="mt-2 text-xs text-zinc-500">Punkte ziehen zum Anpassen, Doppelklick auf Punkt entfernt ihn.</p>
        </Section>
      );
    }
  } else if (selection?.kind === 'shape') {
    const sh = sheet.shapes.find((i) => i.id === selection.id);
    if (sh)
      body = (
        <Section title={sh.kind === 'text' ? 'Text' : sh.kind === 'rect' ? 'Rechteck' : 'Ellipse'} readOnly={readOnly} canRotate>
          <div className="space-y-3">
            <Field label={sh.kind === 'text' ? 'Text' : 'Beschriftung'}>
              <Input
                disabled={readOnly}
                value={sh.label}
                onChange={(e) =>
                  editor.updateSheet((s) => {
                    const x = s.shapes.find((o) => o.id === sh.id);
                    if (x) x.label = e.target.value;
                  })
                }
              />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Breite (m)">
                <NumberInput disabled={readOnly} min={0.1} step={0.5} value={sh.w} onChange={(v) => v && v > 0 && editor.updateSheet((s) => { const x = s.shapes.find((o) => o.id === sh.id); if (x) x.w = v; })} />
              </Field>
              <Field label="Höhe (m)">
                <NumberInput disabled={readOnly} min={0.1} step={0.5} value={sh.h} onChange={(v) => v && v > 0 && editor.updateSheet((s) => { const x = s.shapes.find((o) => o.id === sh.id); if (x) x.h = v; })} />
              </Field>
              <Field label="Farbe">
                <input
                  type="color"
                  disabled={readOnly}
                  className="h-9 w-full cursor-pointer rounded-lg border border-zinc-200 bg-surface p-1"
                  value={sh.color}
                  onChange={(e) => editor.updateSheet((s) => { const x = s.shapes.find((o) => o.id === sh.id); if (x) x.color = e.target.value; })}
                />
              </Field>
            </div>
            <Field label="Drehung (°)">
              <NumberInput disabled={readOnly} step={15} value={sh.rotation} onChange={(v) => editor.updateSheet((s) => { const x = s.shapes.find((o) => o.id === sh.id); if (x) x.rotation = (((v ?? 0) % 360) + 360) % 360; })} />
            </Field>
            <p className="text-xs text-zinc-500">Formen erscheinen nicht in der Materialliste.</p>
          </div>
        </Section>
      );
  }

  return <div className="flex-1 overflow-y-auto p-4">{body}</div>;
}

function Section({
  title,
  color,
  children,
  readOnly,
  canRotate,
  sub,
}: {
  title: ReactNode;
  color?: string;
  children: ReactNode;
  readOnly: boolean;
  canRotate?: boolean;
  sub?: ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {color && <Swatch color={color} />}
            <h2 className="truncate text-[15px] font-semibold">{title}</h2>
          </div>
          {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
        </div>
        {!readOnly && (
          <div className="flex shrink-0 gap-0.5">
            {canRotate && (
              <Button variant="ghost" size="icon" title="90° drehen (Umschalt+E)" onClick={() => rotateSelection(90)}>
                <RotateCw size={15} />
              </Button>
            )}
            <Button variant="ghost" size="icon" title="Löschen (Entf)" onClick={editor.deleteSelection}>
              <Trash2 size={15} />
            </Button>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SheetProps({ sheet, doc, readOnly }: { sheet: Sheet; doc: PlanDoc; readOnly: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const replaceImage = async (file: File) => {
    setBusy(true);
    try {
      const img = await uploadPlanFile(file);
      editor.updateSheet((s) => {
        const keepScale = s.imageW === img.width && s.imageH === img.height;
        s.imageId = img.id;
        s.imageW = img.width;
        s.imageH = img.height;
        if (!keepScale) s.scale = null;
      });
      window.dispatchEvent(new Event('taxis:fit'));
      toast('Bild ersetzt');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <SectionTitle>Blatt</SectionTitle>
        <Field label="Name">
          <Input
            disabled={readOnly}
            value={sheet.name}
            onChange={(e) => editor.updateSheet((s) => void (s.name = e.target.value))}
          />
        </Field>
      </div>

      <div>
        <SectionTitle>Maßstab</SectionTitle>
        {sheet.scale ? (
          <div className="rounded-lg bg-zinc-50 p-3">
            <Row label="Referenz">{formatMeters(sheet.scale.meters, 2)}</Row>
            <Row label="Auflösung">{sheet.scale.pxPerMeter.toFixed(1)} px/m</Row>
            <Row label="Fläche">
              {formatMeters(sheet.imageW / sheet.scale.pxPerMeter, 0)} × {formatMeters(sheet.imageH / sheet.scale.pxPerMeter, 0)}
            </Row>
          </div>
        ) : (
          <div className="flex gap-2 rounded-lg bg-amber-50 p-3 text-[13px] text-amber-900">
            <AlertCircle size={16} className="mt-0.5 shrink-0" /> Kein Maßstab – Längen werden nicht berechnet.
          </div>
        )}
        {!readOnly && (
          <Button className="mt-2 w-full justify-center" size="sm" onClick={() => editor.setTool('scale')}>
            <Ruler size={14} /> Maßstab {sheet.scale ? 'neu ' : ''}setzen
          </Button>
        )}
      </div>

      {!readOnly && (
        <div>
          <SectionTitle>Hintergrund</SectionTitle>
          <Button className="w-full justify-center" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            <ImageUp size={14} /> {busy ? 'Lädt…' : sheet.imageId ? 'Bild ersetzen' : 'Bild / PDF hochladen'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) replaceImage(f);
              e.target.value = '';
            }}
          />
        </div>
      )}

      <div>
        <SectionTitle>Projekt</SectionTitle>
        <Field label="Standard-Reserve für Kabel (%)" hint="Von einem 10 m-Kabel werden bei 10 % nur 9 m verplant.">
          <NumberInput
            disabled={readOnly}
            min={0}
            max={90}
            step={5}
            value={doc.settings.defaultReservePct}
            onChange={(v) => editor.update((d) => void (d.settings.defaultReservePct = Math.min(90, Math.max(0, v ?? 0))))}
          />
        </Field>
      </div>

      <div>
        <SectionTitle>Auf diesem Blatt</SectionTitle>
        <div className="rounded-lg bg-zinc-50 p-3">
          <Row label="Objekte">{sheet.items.length}</Row>
          <Row label="Kabel">{sheet.cables.length}</Row>
          <Row label="Strecken">{sheet.linears.length}</Row>
          <Row label="Formen">{sheet.shapes.length}</Row>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ItemProps({ item, sheet, derived, readOnly }: { item: Item; sheet: Sheet; derived: Derived; readOnly: boolean }) {
  const m = derived.byId.get(item.materialId);
  const upd = (fn: (it: Item) => void) =>
    editor.updateSheet((s) => {
      const it = s.items.find((i) => i.id === item.id);
      if (it) fn(it);
    });
  const ports = effectivePorts(item, m);
  const cablesById = new Map(sheet.cables.map((c) => [c.id, c]));

  return (
    <Section
      title={item.label || m?.name || 'Objekt'}
      color={m?.color}
      readOnly={readOnly}
      canRotate
      sub={
        <>
          {m?.name} · {m?.category}
          {m?.archived && <Badge tone="amber" className="ml-1">archiviert</Badge>}
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Bezeichnung">
          <Input disabled={readOnly} placeholder={m?.name} value={item.label} onChange={(e) => upd((it) => void (it.label = e.target.value))} />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Breite (m)">
            <NumberInput
              disabled={readOnly || !m?.resizable}
              min={0.1}
              step={0.5}
              value={item.w ?? m?.width ?? 1}
              onChange={(v) => v && v > 0 && upd((it) => void (it.w = v))}
            />
          </Field>
          <Field label="Tiefe (m)">
            <NumberInput
              disabled={readOnly || !m?.resizable}
              min={0.1}
              step={0.5}
              value={item.d ?? m?.depth ?? 1}
              onChange={(v) => v && v > 0 && upd((it) => void (it.d = v))}
            />
          </Field>
          <Field label="Drehung (°)">
            <NumberInput
              disabled={readOnly}
              step={15}
              value={item.rotation}
              onChange={(v) => upd((it) => void (it.rotation = (((v ?? 0) % 360) + 360) % 360))}
            />
          </Field>
        </div>
        {m?.resizable && (item.w != null || item.d != null) && !readOnly && (
          <button className="text-xs text-accent hover:underline" onClick={() => upd((it) => { it.w = null; it.d = null; })}>
            Auf Standardmaß zurücksetzen
          </button>
        )}
      </div>

      {ports.length > 0 && (
        <div className="mt-5">
          <SectionTitle>Anschlüsse</SectionTitle>
          <div className="space-y-2">
            {ports.map((p) => {
              const st = derived.portIndex.get(portKey(item.id, p.id));
              const used = st?.uses.length ?? 0;
              const missing = p.required && used === 0;
              const over = used > p.count;
              return (
                <div key={p.id} className={cx('rounded-lg border p-2.5', missing ? 'border-red-200 bg-red-50/50' : 'border-zinc-200')}>
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="font-medium">
                      {p.name} <span className="font-normal text-zinc-500">· {p.connector}</span>
                    </span>
                    {p.count > 1 ? (
                      <span className="flex items-center gap-1 text-xs text-zinc-500">
                        <span className={cx('tabular-nums', over && 'font-semibold text-red-600')}>{used} /</span>
                        <NumberInput
                          className="h-7 w-14 px-1.5 text-xs"
                          disabled={readOnly}
                          min={1}
                          step={1}
                          value={p.count}
                          onChange={(v) => v && v >= 1 && upd((it) => void (it.portCounts[p.id] = Math.round(v)))}
                          title="Anzahl Kanäle für dieses Gerät"
                        />
                      </span>
                    ) : missing ? (
                      <Badge tone="red">fehlt</Badge>
                    ) : used ? (
                      <Badge tone="green">verbunden</Badge>
                    ) : (
                      <span className="text-xs text-zinc-400">frei</span>
                    )}
                  </div>
                  {st && st.uses.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-xs text-zinc-600">
                      {[...st.uses]
                        .sort((a, b) => a.channel - b.channel)
                        .map((u) => {
                          const c = cablesById.get(u.cableId);
                          const cm = c && derived.byId.get(c.materialId);
                          return (
                            <li key={`${u.cableId}${u.side}`}>
                              <button className="hover:text-accent" onClick={() => editor.select({ kind: 'cable', id: u.cableId })}>
                                {p.count > 1 && <span className="mr-1 tabular-nums text-zinc-400">#{u.channel}</span>}
                                {c?.label || cm?.name || 'Kabel'}
                              </button>
                            </li>
                          );
                        })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
          {!readOnly && <p className="mt-2 text-xs text-zinc-500">Kabelwerkzeug (K): am Gerät starten oder enden, um anzuschließen.</p>}
        </div>
      )}

      {!readOnly && (
        <Button size="sm" className="mt-5" onClick={() => duplicateSelection(derived)}>
          <Copy size={14} /> Duplizieren
        </Button>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------

function CableProps({
  cable,
  sheet,
  doc,
  derived,
  readOnly,
}: {
  cable: CableRun;
  sheet: Sheet;
  doc: PlanDoc;
  derived: Derived;
  readOnly: boolean;
}) {
  const m = derived.byId.get(cable.materialId);
  const upd = (fn: (c: CableRun) => void) =>
    editor.updateSheet((s) => {
      const c = s.cables.find((x) => x.id === cable.id);
      if (c) fn(c);
    });
  const reserve = effectiveReservePct(cable, doc.settings.defaultReservePct);
  const drawn = cableDrawnM(cable, sheet.scale);
  const required = cableRequiredM(cable, sheet.scale, doc.settings.defaultReservePct);
  const pieces = derived.piecesByCable.get(cable.id) ?? [];
  const lengths = m ? [...new Set(m.stockLengths.map((l) => l.length))].sort((a, b) => a - b) : [];
  const maxDraw = cable.mode === 'fixed' && cable.fixedLength ? fixedMaxDrawM(cable.fixedLength, reserve, cable.heightStart, cable.heightEnd) : null;
  const over = maxDraw != null && drawn != null && drawn > maxDraw + 0.05;

  return (
    <Section title={cable.label || m?.name || 'Kabel'} color={m?.color} readOnly={readOnly} sub={m?.connector ?? undefined}>
      <div className="space-y-3">
        <Field label="Kabeltyp">
          <Select
            disabled={readOnly}
            value={cable.materialId}
            onChange={(e) => upd((c) => void (c.materialId = e.target.value))}
          >
            {derived.materials
              .filter((x) => x.kind === 'cable' && (!x.archived || x.id === cable.materialId))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Bezeichnung">
          <Input disabled={readOnly} placeholder="z.B. Box links" value={cable.label} onChange={(e) => upd((c) => void (c.label = e.target.value))} />
        </Field>
        <Field label="Länge">
          <div className="flex items-center gap-2">
            <Segmented
              size="sm"
              value={cable.mode}
              onChange={(mode) =>
                !readOnly &&
                upd((c) => {
                  c.mode = mode;
                  if (mode === 'fixed' && !c.fixedLength) c.fixedLength = lengths.find((l) => l + EPS >= (required ?? 0)) ?? lengths[lengths.length - 1] ?? 10;
                })
              }
              options={[
                { value: 'free', label: 'Frei' },
                { value: 'fixed', label: 'Fest' },
              ]}
            />
            {cable.mode === 'fixed' && (
              <NumberInput
                className="h-8 w-20"
                disabled={readOnly}
                min={0.5}
                step={5}
                value={cable.fixedLength}
                onChange={(v) => v && v > 0 && upd((c) => void (c.fixedLength = v))}
              />
            )}
            {cable.mode === 'fixed' && <span className="text-sm text-zinc-500">m</span>}
          </div>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Höhe Start">
            <NumberInput disabled={readOnly} min={0} step={0.5} value={cable.heightStart} onChange={(v) => upd((c) => void (c.heightStart = Math.max(0, v ?? 0)))} />
          </Field>
          <Field label="Höhe Ende">
            <NumberInput disabled={readOnly} min={0} step={0.5} value={cable.heightEnd} onChange={(v) => upd((c) => void (c.heightEnd = Math.max(0, v ?? 0)))} />
          </Field>
          <Field label="Reserve %">
            <NumberInput
              disabled={readOnly}
              allowNull
              min={0}
              max={90}
              step={5}
              placeholder={String(doc.settings.defaultReservePct)}
              value={cable.reservePct}
              onChange={(v) => upd((c) => void (c.reservePct = v == null ? null : Math.min(90, Math.max(0, v))))}
            />
          </Field>
        </div>
      </div>

      <div className={cx('mt-4 rounded-lg p-3', over ? 'bg-red-50' : 'bg-zinc-50')}>
        <Row label="Gezeichnet">{formatMeters(drawn)}</Row>
        {(cable.heightStart > 0 || cable.heightEnd > 0) && <Row label="+ Höhe">{formatMeters(cable.heightStart + cable.heightEnd)}</Row>}
        <Row label="Reserve">{reserve} %</Row>
        {cable.mode === 'fixed' ? (
          <>
            <Row label="Max. zeichenbar">{formatMeters(maxDraw)}</Row>
            <Row label="Kabel" strong>
              {cable.fixedLength?.toLocaleString('de-DE')} m{pieces[0]?.missing && <Badge tone="red" className="ml-1.5">nicht im Bestand</Badge>}
            </Row>
            {over && <div className="mt-1 text-xs font-medium text-red-700">Strecke ist {formatMeters((drawn ?? 0) - (maxDraw ?? 0))} zu lang.</div>}
          </>
        ) : (
          <>
            <Row label="Benötigt" strong>
              {formatMeters(required)}
            </Row>
            {pieces.length > 0 && (
              <Row label="Vorschlag">
                {formatPieces(pieces)}
                {pieces.some((p) => p.missing) && <Badge tone="red" className="ml-1.5">fehlt</Badge>}
              </Row>
            )}
          </>
        )}
      </div>

      <div className="mt-5">
        <SectionTitle>Verbindungen</SectionTitle>
        <div className="space-y-2">
          <EndpointRow label="Start" side="from" cable={cable} sheet={sheet} derived={derived} readOnly={readOnly} />
          <EndpointRow label="Ende" side="to" cable={cable} sheet={sheet} derived={derived} readOnly={readOnly} />
        </div>
      </div>

      {!readOnly && (
        <Button size="sm" className="mt-4" disabled={!!cable.to} onClick={() => startExtension(cable)} title="Neues Kabel am Ende anknüpfen">
          <CableIcon size={14} /> Am Ende anknüpfen
        </Button>
      )}
      {!readOnly && <p className="mt-2 text-xs text-zinc-500">Punkte ziehen · Mittelpunkte klicken fügt Punkt ein · Doppelklick entfernt Punkt.</p>}
    </Section>
  );
}

function EndpointRow({
  label,
  side,
  cable,
  sheet,
  derived,
  readOnly,
}: {
  label: string;
  side: 'from' | 'to';
  cable: CableRun;
  sheet: Sheet;
  derived: Derived;
  readOnly: boolean;
}) {
  const ep = cable[side];
  const cm = derived.byId.get(cable.materialId);
  const disconnect = () =>
    editor.updateSheet((s) => {
      const c = s.cables.find((x) => x.id === cable.id);
      if (c) c[side] = null;
    });

  if (!ep) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-dashed border-zinc-200 px-2.5 py-2 text-[13px]">
        <span className="text-zinc-500">{label}</span>
        <span className="text-zinc-400">offen</span>
      </div>
    );
  }

  if (ep.type === 'cable') {
    const other = sheet.cables.find((c) => c.id === ep.cableId);
    const om = other && derived.byId.get(other.materialId);
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-2.5 py-2 text-[13px]">
        <span className="text-zinc-500">{label}</span>
        <button className="flex min-w-0 items-center gap-1 truncate hover:text-accent" onClick={() => editor.select({ kind: 'cable', id: ep.cableId })}>
          <Link2 size={13} /> {other?.label || om?.name || 'Kabel'}
        </button>
        {!readOnly && (
          <Button variant="ghost" size="icon" title="Lösen" onClick={disconnect}>
            <Unlink size={14} />
          </Button>
        )}
      </div>
    );
  }

  const item = sheet.items.find((i) => i.id === ep.itemId);
  const im = item && derived.byId.get(item.materialId);
  const ports = item ? effectivePorts(item, im).filter((p) => !cm?.connector || p.connector === cm.connector) : [];
  const port = ports.find((p) => p.id === ep.portId);
  const setPort = (patch: Partial<Extract<Endpoint, { type: 'port' }>>) =>
    editor.updateSheet((s) => {
      const c = s.cables.find((x) => x.id === cable.id);
      const e = c?.[side];
      if (c && e?.type === 'port') c[side] = { ...e, ...patch };
    });

  return (
    <div className="rounded-lg border border-zinc-200 px-2.5 py-2 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-zinc-500">{label}</span>
        <button className="min-w-0 truncate font-medium hover:text-accent" onClick={() => item && editor.select({ kind: 'item', id: item.id })}>
          {item ? item.label || im?.name : 'gelöscht'}
        </button>
        {!readOnly && (
          <Button variant="ghost" size="icon" title="Lösen" onClick={disconnect}>
            <Unlink size={14} />
          </Button>
        )}
      </div>
      {item && (
        <div className="mt-1.5 flex gap-1.5">
          <Select
            className="h-8 flex-1 text-xs"
            disabled={readOnly}
            value={ep.portId}
            onChange={(e) => {
              const st = derived.portIndex.get(portKey(item.id, e.target.value));
              setPort({ portId: e.target.value, channel: nextFreeChannel(st) ?? 1 });
            }}
          >
            {!port && <option value={ep.portId}>? ({ep.portId})</option>}
            {ports.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.connector})
              </option>
            ))}
          </Select>
          {port && port.count > 1 && (
            <Select
              className="h-8 w-20 text-xs"
              disabled={readOnly}
              value={ep.channel}
              onChange={(e) => setPort({ channel: Number(e.target.value) })}
              title="Kanal"
            >
              {Array.from({ length: port.count }, (_, i) => i + 1).map((ch) => {
                const taken = derived.portIndex
                  .get(portKey(item.id, port.id))
                  ?.uses.some((u) => u.channel === ch && !(u.cableId === cable.id && u.side === side));
                return (
                  <option key={ch} value={ch} disabled={taken}>
                    #{ch}
                    {taken ? ' ·' : ''}
                  </option>
                );
              })}
            </Select>
          )}
        </div>
      )}
    </div>
  );
}
