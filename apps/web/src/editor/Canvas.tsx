import type Konva from 'konva';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Circle, Ellipse, Group, Image as KImage, Label, Layer, Line, Rect, Stage, Tag, Text, Transformer } from 'react-konva';
import {
  cableRequiredM,
  dist,
  effectiveReservePct,
  fixedMaxDrawM,
  formatMeters,
  formatPieces,
  midpointOfPolyline,
  polylineLengthM,
  polylineLengthPx,
  scaleFromReference,
  EPS,
  type CableRun,
  type Item,
  type LinearRun,
  type Material,
  type Point,
  type Shape,
  type Sheet,
} from '@taxis/shared';
import { Button, Field, Modal, NumberInput } from '../components/ui';
import { api } from '../lib/api';
import { useTheme } from '../lib/theme';
import {
  addItemAt,
  constrainDraftPoint,
  createShape,
  draftMaxPx,
  finishDraft,
  handleCableClick,
  handleLinearClick,
  itemHasCables,
  moveItem,
  reconnectCableEnd,
} from './actions';
import { hitCableEnd, hitItem, itemSizeM, type Derived } from './derived';
import { editor, ppmOf, useEditor, useSheet, useViewDoc } from './store';

const ACCENT = '#2563eb';

function useHtmlImage(url: string | null) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    setImg(null);
    if (!url) return;
    const i = new window.Image();
    i.onload = () => setImg(i);
    i.src = url;
  }, [url]);
  return img;
}

function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const flat = (pts: Point[]) => pts.flatMap((p) => [p[0], p[1]]);

function niceLength(target: number) {
  const pow = 10 ** Math.floor(Math.log10(target));
  for (const f of [1, 2, 5, 10]) if (f * pow >= target) return f * pow;
  return 10 * pow;
}

export function PlanCanvas({ derived }: { derived: Derived }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [scaleA, setScaleA] = useState<Point | null>(null);
  const [scaleDialog, setScaleDialog] = useState<{ a: Point; b: Point } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const panRef = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);

  const sheet = useSheet();
  const doc = useViewDoc();
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  const draft = useEditor((s) => s.draft);
  const cursor = useEditor((s) => s.cursor);
  const hidden = useEditor((s) => s.hiddenCategories);
  const showLabels = useEditor((s) => s.showLabels);
  const readOnly = useEditor((s) => !!s.preview);
  const placeMaterialId = useEditor((s) => s.placeMaterialId);
  const linearMaterialId = useEditor((s) => s.linearMaterialId);
  const cableOpts = useEditor((s) => s.cable);

  const image = useHtmlImage(sheet?.imageId ? api.imageUrl(sheet.imageId) : null);
  const dark = useTheme((s) => s.dark);
  // Schrift auf der Zeichenfläche: auf (meist hellen) Plänen dunkel, auf leerem Blatt im Dark Mode hell
  const ink = dark && !sheet?.imageId ? '#e4e4e7' : '#27272a';
  const ppm = ppmOf(sheet);
  const k = 1 / view.scale; // Welt-Einheiten pro Bildschirm-Pixel
  const { byId } = derived;
  const visible = useCallback((materialId: string) => !hidden.includes(byId.get(materialId)?.category ?? ''), [hidden, byId]);

  // --- Größe & Einpassen ---
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!sheet || !size.w || !size.h) return;
    const scale = Math.min(size.w / sheet.imageW, size.h / sheet.imageH) * 0.94;
    setView({ scale, x: (size.w - sheet.imageW * scale) / 2, y: (size.h - sheet.imageH * scale) / 2 });
  }, [sheet?.id, sheet?.imageW, sheet?.imageH, size.w > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => fit(), [fit]);
  useEffect(() => {
    const onFit = () => fit();
    window.addEventListener('taxis:fit', onFit);
    return () => window.removeEventListener('taxis:fit', onFit);
  }, [fit]);

  // --- Leertaste = Hand ---
  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(t.tagName);
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isField(e.target)) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceDown(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    if (tool !== 'scale') setScaleA(null);
  }, [tool]);

  // --- Transformer an Auswahl hängen ---
  const selectedNodeKind = selection?.kind === 'item' || selection?.kind === 'shape' ? selection : null;
  const selectedItem = selection?.kind === 'item' ? sheet?.items.find((i) => i.id === selection.id) : undefined;
  const selectedResizable =
    selection?.kind === 'shape' || (selectedItem ? !!byId.get(selectedItem.materialId)?.resizable : false);
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const node = selectedNodeKind && !readOnly && tool === 'select' ? stage.findOne(`#${selectedNodeKind.id}`) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  });

  const world = (): Point | null => {
    const p = stageRef.current?.getRelativePointerPosition();
    return p ? [p.x, p.y] : null;
  };

  // --- Zoom ---
  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const factor = Math.exp(-e.evt.deltaY * (e.evt.ctrlKey ? 0.01 : 0.0015));
    const scale = Math.min(Math.max(view.scale * factor, 0.01), 40);
    const wx = (pointer.x - view.x) / view.scale;
    const wy = (pointer.y - view.y) / view.scale;
    setView({ scale, x: pointer.x - wx * scale, y: pointer.y - wy * scale });
  };

  useEffect(() => {
    const onZoom = (e: Event) => {
      const f = (e as CustomEvent<number>).detail;
      setView((v) => {
        const scale = Math.min(Math.max(v.scale * f, 0.01), 40);
        const cx = size.w / 2;
        const cy = size.h / 2;
        return { scale, x: cx - ((cx - v.x) / v.scale) * scale, y: cy - ((cy - v.y) / v.scale) * scale };
      });
    };
    window.addEventListener('taxis:zoom', onZoom);
    return () => window.removeEventListener('taxis:zoom', onZoom);
  }, [size.w, size.h]);

  useEffect(() => {
    useEditor.setState({ zoom: view.scale });
  }, [view.scale]);

  // --- Maus ---
  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // Konva verhindert den Fokuswechsel – Formularfelder sonst weiter fokussiert (Enter/Entf ginge ins Feld)
    const active = document.activeElement;
    if (active instanceof HTMLElement && /INPUT|TEXTAREA|SELECT|BUTTON/.test(active.tagName)) active.blur();
    if (e.evt.button === 1) {
      e.evt.preventDefault();
      panRef.current = { px: e.evt.clientX, py: e.evt.clientY, vx: view.x, vy: view.y };
    }
  };
  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (panRef.current) {
      const p = panRef.current;
      setView((v) => ({ ...v, x: p.vx + e.evt.clientX - p.px, y: p.vy + e.evt.clientY - p.py }));
      return;
    }
    const p = world();
    if (p) useEditor.setState({ cursor: p });
  };
  const onMouseUp = () => {
    panRef.current = null;
  };

  const onClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0 || spaceDown || !sheet || readOnly) {
      if (readOnly && (e.target === e.target.getStage() || e.target.name() === 'bg')) editor.select(null);
      return;
    }
    const p = world();
    if (!p) return;
    const onEmpty = e.target === e.target.getStage() || e.target.name() === 'bg';
    switch (tool) {
      case 'select':
        if (onEmpty) editor.select(null);
        break;
      case 'place': {
        const m = placeMaterialId ? byId.get(placeMaterialId) : undefined;
        if (m) addItemAt(m, p, derived);
        break;
      }
      case 'scale':
        if (!scaleA) setScaleA(p);
        else {
          if (dist(scaleA, p) > 2) setScaleDialog({ a: scaleA, b: p });
          setScaleA(null);
        }
        break;
      case 'cable':
        handleCableClick(p, derived, 8 * k);
        break;
      case 'linear':
        handleLinearClick(p);
        break;
      case 'rect':
      case 'ellipse':
      case 'text':
        createShape(tool, p);
        break;
    }
  };

  const onDblClick = () => {
    // Nur abschließen, wenn schon eine Strecke existiert (sonst wäre der Startklick ein "Doppelklick")
    const d = useEditor.getState().draft;
    if ((tool === 'cable' || tool === 'linear') && d && d.points.length >= 2) finishDraft();
  };

  // --- Drop aus Palette ---
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('application/x-taxis-material');
    const m = byId.get(id);
    const stage = stageRef.current;
    if (!m || !stage || readOnly) return;
    stage.setPointersPositions(e.nativeEvent);
    const p = world();
    if (p) addItemAt(m, p, derived);
  };

  const stageDraggable = !readOnly ? tool === 'select' || tool === 'pan' || spaceDown : true;
  const cursorStyle = spaceDown || tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';

  // --- Entwurfsvorschau ---
  const preview = useMemo(() => {
    if (!sheet || !draft || !cursor || (tool !== 'cable' && tool !== 'linear')) return null;
    const p = constrainDraftPoint(cursor, sheet);
    return [...draft.points, p];
  }, [sheet, draft, cursor, tool]);

  const snapItem = useMemo(() => {
    if (!sheet || !cursor || tool !== 'cable') return null;
    return hitItem(sheet, byId, cursor, 8 * k, hidden);
  }, [sheet, cursor, tool, byId, k, hidden]);
  const snapEnd = useMemo(() => {
    if (!sheet || !cursor || tool !== 'cable') return null;
    return hitCableEnd(sheet, cursor, 8 * k);
  }, [sheet, cursor, tool, k]);

  if (!sheet || !doc) return <div ref={wrapRef} className="h-full w-full" />;

  const defaultReserve = doc.settings.defaultReservePct;
  const items = sheet.items.filter((i) => visible(i.materialId));
  const cables = sheet.cables.filter((c) => visible(c.materialId));
  const linears = sheet.linears.filter((l) => visible(l.materialId));
  const scaleBarM = niceLength(110 / (ppm * view.scale));

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden bg-zinc-100"
      style={{ cursor: cursorStyle }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable={stageDraggable}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
        }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => useEditor.setState({ cursor: null })}
        onClick={onClick}
        onTap={onClick as never}
        onDblClick={onDblClick}
      >
        <Layer>
          {image ? (
            <KImage name="bg" image={image} width={sheet.imageW} height={sheet.imageH} />
          ) : (
            <BlankGround sheet={sheet} ppm={ppm} k={k} />
          )}
        </Layer>

        <Layer>
          {sheet.shapes.map((s) => (
            <ShapeNode key={s.id} shape={s} ppm={ppm} k={k} ink={ink} selected={selection?.id === s.id} interactive={tool === 'select' && !readOnly} />
          ))}
          {linears.map((l) => (
            <LinearNode
              key={l.id}
              run={l}
              material={byId.get(l.materialId)}
              sheet={sheet}
              k={k}
              selected={selection?.id === l.id}
              interactive={tool === 'select' && !readOnly}
              showLabel={showLabels}
            />
          ))}
          {cables.map((c) => (
            <CableNode
              key={c.id}
              cable={c}
              material={byId.get(c.materialId)}
              sheet={sheet}
              k={k}
              selected={selection?.id === c.id}
              selectable={tool === 'select'}
              pieces={formatPieces(derived.piecesByCable.get(c.id) ?? [])}
              defaultReserve={defaultReserve}
              showLabel={showLabels}
            />
          ))}
          {items.map((it) => (
            <ItemNode
              ink={ink}
              key={it.id}
              item={it}
              material={byId.get(it.materialId)}
              sheet={sheet}
              ppm={ppm}
              k={k}
              open={derived.openItems.has(it.id)}
              interactive={tool === 'select' && !readOnly}
              selectable={tool === 'select'}
              selected={selection?.id === it.id || hoverId === it.id}
              onHover={(h) => setHoverId(h ? it.id : null)}
            />
          ))}
        </Layer>

        <Layer>
          <Transformer
            ref={trRef}
            rotateEnabled
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            rotationSnapTolerance={6}
            enabledAnchors={
              selectedResizable
                ? ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']
                : []
            }
            keepRatio={false}
            flipEnabled={false}
            ignoreStroke
            anchorSize={8}
            anchorCornerRadius={2}
            borderStroke={ACCENT}
            anchorStroke={ACCENT}
            rotateAnchorOffset={24}
            boundBoxFunc={(o, n) => (n.width < 4 || n.height < 4 ? o : n)}
          />

          {!readOnly && tool === 'select' && selection?.kind === 'cable' && (
            <VertexHandles kind="cable" sheet={sheet} id={selection.id} k={k} derived={derived} />
          )}
          {!readOnly && tool === 'select' && selection?.kind === 'linear' && (
            <VertexHandles kind="linear" sheet={sheet} id={selection.id} k={k} derived={derived} />
          )}

          {/* Snap-Hinweise beim Kabelzeichnen */}
          {snapItem && (
            <SnapRing item={snapItem} material={byId.get(snapItem.materialId)} ppm={ppm} k={k} />
          )}
          {snapEnd && !snapItem && (
            <Circle x={snapEnd.point[0]} y={snapEnd.point[1]} radius={7 * k} stroke={ACCENT} strokeWidth={2 * k} listening={false} />
          )}

          {preview && (
            <DraftPreview points={preview} sheet={sheet} k={k} tool={tool} cableColor={byId.get(cableOpts.materialId ?? '')?.color} linear={byId.get(linearMaterialId ?? '')} defaultReserve={defaultReserve} />
          )}

          {/* Platzieren-Vorschau */}
          {tool === 'place' && cursor && placeMaterialId && byId.get(placeMaterialId) && (
            <GhostItem material={byId.get(placeMaterialId)!} p={cursor} ppm={ppm} ok={derived.canPlace(byId.get(placeMaterialId)!).ok} />
          )}

          {/* Maßstab */}
          {tool === 'scale' && sheet.scale && !scaleA && (
            <ScaleLine a={sheet.scale.a} b={sheet.scale.b} k={k} label={formatMeters(sheet.scale.meters, 2)} />
          )}
          {tool === 'scale' && scaleA && cursor && <ScaleLine a={scaleA} b={cursor} k={k} label="" />}
        </Layer>
      </Stage>

      {/* Maßstabsleiste */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-surface/90 px-2 py-1 text-[11px] font-medium text-zinc-700 shadow-sm ring-1 ring-zinc-900/5">
        <div className="mb-0.5 h-1.5 border-x-2 border-b-2 border-zinc-700" style={{ width: scaleBarM * ppm * view.scale }} />
        {scaleBarM.toLocaleString('de-DE')} m{!sheet.scale && ' (geschätzt)'}
      </div>

      {scaleDialog && (
        <ScaleDialog
          onClose={() => setScaleDialog(null)}
          pixels={dist(scaleDialog.a, scaleDialog.b)}
          onSave={(meters) => {
            editor.updateSheet((s) => {
              s.scale = scaleFromReference(scaleDialog.a, scaleDialog.b, meters);
            });
            setScaleDialog(null);
            editor.setTool('select');
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function BlankGround({ sheet, ppm, k }: { sheet: Sheet; ppm: number; k: number }) {
  const dark = useTheme((s) => s.dark);
  const step = 5 * ppm;
  const lines: number[][] = [];
  for (let x = 0; x <= sheet.imageW + 0.1; x += step) lines.push([x, 0, x, sheet.imageH]);
  for (let y = 0; y <= sheet.imageH + 0.1; y += step) lines.push([0, y, sheet.imageW, y]);
  return (
    <Group>
      <Rect name="bg" width={sheet.imageW} height={sheet.imageH} fill={dark ? '#1f1f24' : '#ffffff'} shadowColor="#000" shadowOpacity={dark ? 0.4 : 0.06} shadowBlur={12 * k} />
      {lines.map((l, i) => (
        <Line key={i} points={l} stroke={dark ? '#2e2e35' : '#e4e4e7'} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      ))}
    </Group>
  );
}

function ItemNode({
  item,
  material,
  sheet,
  ppm,
  k,
  open,
  interactive,
  selectable,
  selected,
  onHover,
  ink,
}: {
  ink: string;
  item: Item;
  material: Material | undefined;
  sheet: Sheet;
  ppm: number;
  k: number;
  open: boolean;
  interactive: boolean;
  selectable: boolean;
  selected: boolean;
  onHover: (hover: boolean) => void;
}) {
  const { w, d } = itemSizeM(item, material);
  const W = w * ppm;
  const D = d * ppm;
  const color = material?.color ?? '#71717a';
  const name = item.label || material?.name || '?';
  const screenMin = Math.min(W, D) / k;
  const small = screenMin < 46;
  const showName = !small || screenMin >= 14 || selected;
  const fontSize = small ? 11 * k : Math.min(Math.max(Math.min(W, D) * 0.16, 11 * k), 15 * k);
  const hasCables = itemHasCables(sheet, item.id);
  const rad = (item.rotation * Math.PI) / 180;
  const halfH = Math.abs((W / 2) * Math.sin(rad)) + Math.abs((D / 2) * Math.cos(rad));

  // Außen: Position + Drag. Innen (id = Transformer-Ziel): Form, Drehung, Größe. Kleines Label außerhalb,
  // damit der Auswahlrahmen nur die Form umschließt und das Label waagerecht bleibt.
  return (
    <Group
      x={item.x}
      y={item.y}
      draggable={interactive}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={(e) => {
        if (!selectable) return;
        e.cancelBubble = true;
        editor.select({ kind: 'item', id: item.id });
      }}
      onTap={() => selectable && editor.select({ kind: 'item', id: item.id })}
      onDragStart={() => {
        editor.checkpoint();
        editor.select({ kind: 'item', id: item.id });
      }}
      onDragMove={(e) => hasCables && moveItem(item.id, e.target.x(), e.target.y(), false)}
      onDragEnd={(e) => moveItem(item.id, e.target.x(), e.target.y(), false)}
    >
      <Group
        id={item.id}
        rotation={item.rotation}
        onTransformStart={() => editor.checkpoint()}
        onTransformEnd={(e) => {
          const n = e.target;
          const sx = n.scaleX();
          const sy = n.scaleY();
          const cx = item.x + n.x();
          const cy = item.y + n.y();
          n.position({ x: 0, y: 0 });
          n.scale({ x: 1, y: 1 });
          const rot = ((n.rotation() % 360) + 360) % 360;
          editor.updateSheet(
            (s) => {
              const it = s.items.find((i) => i.id === item.id);
              if (!it) return;
              it.rotation = Math.round(rot * 10) / 10;
              if (material?.resizable && (Math.abs(sx - 1) > EPS || Math.abs(sy - 1) > EPS)) {
                it.w = Math.round(((W * sx) / ppm) * 100) / 100;
                it.d = Math.round(((D * sy) / ppm) * 100) / 100;
              }
            },
            { history: false },
          );
          moveItem(item.id, cx, cy, false);
        }}
      >
        {material?.shape === 'circle' ? (
          <Ellipse radiusX={W / 2} radiusY={D / 2} fill={hexA(color, 0.22)} stroke={color} strokeWidth={1.5} strokeScaleEnabled={false} />
        ) : (
          <Rect
            x={-W / 2}
            y={-D / 2}
            width={W}
            height={D}
            cornerRadius={Math.min(W, D) * 0.04}
            fill={hexA(color, 0.2)}
            stroke={color}
            strokeWidth={1.5}
            strokeScaleEnabled={false}
          />
        )}
        {showName && !small && (
          <Text
            text={name}
            x={-W / 2 + 2 * k}
            y={-D / 2}
            width={W - 4 * k}
            height={D}
            align="center"
            verticalAlign="middle"
            fontSize={fontSize}
            fontStyle="500"
            fill={ink}
            wrap="word"
            ellipsis
            listening={false}
          />
        )}
        {open && <Circle x={W / 2} y={-D / 2} radius={4 * k} fill="#ef4444" stroke="#fff" strokeWidth={1.5 * k} listening={false} />}
      </Group>
      {showName && small && (
        <Text
          text={name}
          x={-100 * k}
          y={halfH + 3 * k}
          width={200 * k}
          align="center"
          fontSize={fontSize}
          fontStyle="500"
          fill={ink}
          listening={false}
        />
      )}
    </Group>
  );
}

function GhostItem({ material, p, ppm, ok }: { material: Material; p: Point; ppm: number; ok: boolean }) {
  const W = material.width * ppm;
  const D = material.depth * ppm;
  const color = ok ? material.color : '#ef4444';
  return material.shape === 'circle' ? (
    <Ellipse x={p[0]} y={p[1]} radiusX={W / 2} radiusY={D / 2} fill={hexA(color, 0.15)} stroke={color} dash={[4, 3]} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
  ) : (
    <Rect x={p[0] - W / 2} y={p[1] - D / 2} width={W} height={D} fill={hexA(color, 0.15)} stroke={color} dash={[4, 3]} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
  );
}

function SnapRing({ item, material, ppm, k }: { item: Item; material: Material | undefined; ppm: number; k: number }) {
  const { w, d } = itemSizeM(item, material);
  const pad = 4 * k;
  return (
    <Group x={item.x} y={item.y} rotation={item.rotation} listening={false}>
      <Rect
        x={(-w * ppm) / 2 - pad}
        y={(-d * ppm) / 2 - pad}
        width={w * ppm + 2 * pad}
        height={d * ppm + 2 * pad}
        stroke={ACCENT}
        strokeWidth={2}
        strokeScaleEnabled={false}
        cornerRadius={4 * k}
      />
    </Group>
  );
}

function TextTag({ x, y, text, k, tone = 'neutral' }: { x: number; y: number; text: string; k: number; tone?: 'neutral' | 'red' | 'accent' }) {
  const fill = tone === 'red' ? '#dc2626' : tone === 'accent' ? ACCENT : '#ffffff';
  const color = tone === 'neutral' ? '#18181b' : '#ffffff';
  return (
    <Label x={x} y={y} listening={false}>
      <Tag fill={fill} opacity={0.95} cornerRadius={4 * k} pointerDirection="down" pointerWidth={6 * k} pointerHeight={4 * k} shadowColor="#000" shadowOpacity={0.12} shadowBlur={4 * k} />
      <Text text={text} fontSize={11 * k} padding={4 * k} fill={color} fontStyle="500" />
    </Label>
  );
}

function CableNode({
  cable,
  material,
  sheet,
  k,
  selected,
  selectable,
  pieces,
  defaultReserve,
  showLabel,
}: {
  cable: CableRun;
  material: Material | undefined;
  sheet: Sheet;
  k: number;
  selected: boolean;
  selectable: boolean;
  pieces: string;
  defaultReserve: number;
  showLabel: boolean;
}) {
  const color = material?.color ?? '#71717a';
  const pts = flat(cable.points);
  const mid = midpointOfPolyline(cable.points);
  let text = '';
  let over = false;
  if (cable.mode === 'fixed' && cable.fixedLength) {
    const drawn = polylineLengthM(cable.points, sheet.scale) ?? 0;
    const max = fixedMaxDrawM(cable.fixedLength, effectiveReservePct(cable, defaultReserve), cable.heightStart, cable.heightEnd);
    over = drawn > max + 0.05;
    text = `${cable.fixedLength.toLocaleString('de-DE')} m${over ? ` · ${formatMeters(drawn - max)} zu lang` : ''}`;
  } else {
    const req = cableRequiredM(cable, sheet.scale, defaultReserve);
    text = req == null ? '? m' : `${formatMeters(req)}${pieces ? ` → ${pieces.replace(/^1× /, '')}` : ''}`;
  }
  if (cable.label) text = `${cable.label} · ${text}`;
  const select = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!selectable) return;
    e.cancelBubble = true;
    editor.select({ kind: 'cable', id: cable.id });
  };
  return (
    <Group>
      {selected && <Line points={pts} stroke={ACCENT} opacity={0.3} strokeWidth={9} strokeScaleEnabled={false} lineCap="round" lineJoin="round" listening={false} />}
      <Line
        points={pts}
        stroke={over ? '#dc2626' : color}
        strokeWidth={2.5}
        strokeScaleEnabled={false}
        lineCap="round"
        lineJoin="round"
        dash={cable.mode === 'fixed' ? undefined : undefined}
        hitStrokeWidth={14 * k}
        onClick={select}
        onTap={select}
      />
      {cable.points.length > 0 && (
        <>
          <Circle x={cable.points[0][0]} y={cable.points[0][1]} radius={2.5 * k} fill={cable.from ? color : '#fff'} stroke={color} strokeWidth={1.2 * k} listening={false} />
          <Circle
            x={cable.points[cable.points.length - 1][0]}
            y={cable.points[cable.points.length - 1][1]}
            radius={2.5 * k}
            fill={cable.to ? color : '#fff'}
            stroke={color}
            strokeWidth={1.2 * k}
            listening={false}
          />
        </>
      )}
      {(showLabel || selected) && <TextTag x={mid[0]} y={mid[1] - 3 * k} text={text} k={k} tone={over ? 'red' : selected ? 'accent' : 'neutral'} />}
    </Group>
  );
}

function LinearNode({
  run,
  material,
  sheet,
  k,
  selected,
  interactive,
  showLabel,
}: {
  run: LinearRun;
  material: Material | undefined;
  sheet: Sheet;
  k: number;
  selected: boolean;
  interactive: boolean;
  showLabel: boolean;
}) {
  const ppm = ppmOf(sheet);
  const color = material?.color ?? '#a1a1aa';
  const width = Math.max((material?.width ?? 0.5) * ppm, 3 * k);
  const seg = (material?.segmentLength ?? 0) * ppm;
  const len = polylineLengthM(run.points, sheet.scale);
  const count = material?.segmentLength && len != null ? Math.ceil(len / material.segmentLength - EPS) : null;
  const mid = midpointOfPolyline(run.points);
  const select = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!interactive) return;
    e.cancelBubble = true;
    editor.select({ kind: 'linear', id: run.id });
  };
  return (
    <Group
      draggable={interactive && selected}
      onDragStart={() => editor.checkpoint()}
      onDragEnd={(e) => {
        const dx = e.target.x();
        const dy = e.target.y();
        e.target.position({ x: 0, y: 0 });
        editor.updateSheet(
          (s) => {
            const l = s.linears.find((x) => x.id === run.id);
            if (l) l.points = l.points.map(([x, y]) => [x + dx, y + dy] as Point);
          },
          { history: false },
        );
      }}
    >
      {selected && <Line points={flat(run.points)} stroke={ACCENT} opacity={0.3} strokeWidth={width + 8 * k} lineJoin="round" listening={false} />}
      <Line
        points={flat(run.points)}
        stroke={color}
        opacity={0.85}
        strokeWidth={width}
        lineJoin="round"
        dash={seg > 6 * k ? [seg - 1.5 * k, 1.5 * k] : undefined}
        onClick={select}
        onTap={select}
      />
      {(showLabel || selected) && (
        <TextTag x={mid[0]} y={mid[1] - width / 2 - 2 * k} k={k} text={`${count != null ? `${count}× ` : ''}${material?.name ?? '?'} · ${formatMeters(len)}`} tone={selected ? 'accent' : 'neutral'} />
      )}
    </Group>
  );
}

function ShapeNode({
  shape,
  ppm,
  k,
  ink,
  selected,
  interactive,
}: {
  shape: Shape;
  ppm: number;
  k: number;
  ink: string;
  selected: boolean;
  interactive: boolean;
}) {
  const W = shape.w * ppm;
  const H = shape.h * ppm;
  return (
    <Group
      id={shape.id}
      x={shape.x}
      y={shape.y}
      rotation={shape.rotation}
      draggable={interactive}
      onClick={(e) => {
        if (!interactive) return;
        e.cancelBubble = true;
        editor.select({ kind: 'shape', id: shape.id });
      }}
      onDragStart={() => {
        editor.checkpoint();
        editor.select({ kind: 'shape', id: shape.id });
      }}
      onDragEnd={(e) =>
        editor.updateSheet(
          (s) => {
            const x = s.shapes.find((o) => o.id === shape.id);
            if (x) {
              x.x = e.target.x();
              x.y = e.target.y();
            }
          },
          { history: false },
        )
      }
      onTransformStart={() => editor.checkpoint()}
      onTransformEnd={(e) => {
        const n = e.target;
        const sx = n.scaleX();
        const sy = n.scaleY();
        n.scaleX(1);
        n.scaleY(1);
        editor.updateSheet(
          (s) => {
            const x = s.shapes.find((o) => o.id === shape.id);
            if (!x) return;
            x.x = n.x();
            x.y = n.y();
            x.rotation = Math.round((((n.rotation() % 360) + 360) % 360) * 10) / 10;
            x.w = Math.max(0.1, Math.round(((W * sx) / ppm) * 100) / 100);
            x.h = Math.max(0.1, Math.round(((H * sy) / ppm) * 100) / 100);
          },
          { history: false },
        );
      }}
    >
      {shape.kind === 'text' ? (
        <>
          <Rect x={-W / 2} y={-H / 2} width={W} height={H} fill="transparent" stroke={selected ? undefined : undefined} />
          <Text
            text={shape.label || 'Text'}
            x={-W / 2}
            y={-H / 2}
            width={W}
            height={H}
            align="center"
            verticalAlign="middle"
            fontSize={H * 0.7}
            fontStyle="600"
            fill={shape.color}
          />
        </>
      ) : (
        <>
          {shape.kind === 'rect' ? (
            <Rect x={-W / 2} y={-H / 2} width={W} height={H} fill={hexA(shape.color, 0.12)} stroke={shape.color} strokeWidth={1.5} strokeScaleEnabled={false} dash={[6, 4]} />
          ) : (
            <Ellipse radiusX={W / 2} radiusY={H / 2} fill={hexA(shape.color, 0.12)} stroke={shape.color} strokeWidth={1.5} strokeScaleEnabled={false} dash={[6, 4]} />
          )}
          {shape.label && (
            <Text
              text={shape.label}
              x={-W / 2}
              y={-H / 2}
              width={W}
              height={H}
              align="center"
              verticalAlign="middle"
              fontSize={Math.max(Math.min(W, H) * 0.14, 11 * k)}
              fill={ink}
              listening={false}
            />
          )}
        </>
      )}
    </Group>
  );
}

function VertexHandles({ kind, sheet, id, k, derived }: { kind: 'cable' | 'linear'; sheet: Sheet; id: string; k: number; derived: Derived }) {
  const run = kind === 'cable' ? sheet.cables.find((c) => c.id === id) : sheet.linears.find((l) => l.id === id);
  if (!run) return null;
  const update = (i: number, p: Point) =>
    editor.updateSheet(
      (s) => {
        const list = kind === 'cable' ? s.cables : s.linears;
        const r = list.find((x) => x.id === id);
        if (r) r.points[i] = p;
      },
      { history: false },
    );
  return (
    <>
      {run.points.map((p, i) => {
        const isEnd = i === 0 || i === run.points.length - 1;
        return (
          <Circle
            key={i}
            x={p[0]}
            y={p[1]}
            radius={(isEnd ? 5.5 : 4.5) * k}
            fill="#fff"
            stroke={ACCENT}
            strokeWidth={2 * k}
            draggable
            hitStrokeWidth={8 * k}
            onMouseEnter={(e) => {
              const c = e.target.getStage()?.container();
              if (c) c.style.cursor = 'move';
            }}
            onMouseLeave={(e) => {
              const c = e.target.getStage()?.container();
              if (c) c.style.cursor = '';
            }}
            onDragStart={() => editor.checkpoint()}
            onDragMove={(e) => update(i, [e.target.x(), e.target.y()])}
            onDragEnd={(e) => {
              update(i, [e.target.x(), e.target.y()]);
              if (kind === 'cable' && isEnd) reconnectCableEnd(id, i === 0 ? 'from' : 'to', derived, 8 * k);
            }}
            onDblClick={(e) => {
              e.cancelBubble = true;
              if (run.points.length <= 2) return;
              editor.updateSheet((s) => {
                const list = kind === 'cable' ? s.cables : s.linears;
                const r = list.find((x) => x.id === id);
                if (r) r.points.splice(i, 1);
              });
            }}
          />
        );
      })}
      {/* Zwischenpunkte einfügen */}
      {run.points.slice(1).map((p, i) => {
        const a = run.points[i];
        const m: Point = [(a[0] + p[0]) / 2, (a[1] + p[1]) / 2];
        if (dist(a, p) < 24 * k) return null;
        return (
          <Circle
            key={`m${i}`}
            x={m[0]}
            y={m[1]}
            radius={3.5 * k}
            fill={ACCENT}
            opacity={0.5}
            onClick={(e) => {
              e.cancelBubble = true;
              editor.updateSheet((s) => {
                const list = kind === 'cable' ? s.cables : s.linears;
                const r = list.find((x) => x.id === id);
                if (r) r.points.splice(i + 1, 0, m);
              });
            }}
          />
        );
      })}
    </>
  );
}

function DraftPreview({
  points,
  sheet,
  k,
  tool,
  cableColor,
  linear,
  defaultReserve,
}: {
  points: Point[];
  sheet: Sheet;
  k: number;
  tool: string;
  cableColor?: string;
  linear?: Material;
  defaultReserve: number;
}) {
  const ppm = ppmOf(sheet);
  const opts = useEditor.getState().cable;
  const lenPx = polylineLengthPx(points);
  const lenM = sheet.scale ? lenPx / ppm : null;
  const end = points[points.length - 1];
  let text = formatMeters(lenM);
  if (tool === 'cable') {
    const max = draftMaxPx(sheet);
    if (max != null) {
      const rest = Math.max(0, (max - lenPx) / ppm);
      text = `${formatMeters(lenM)} · Rest ${formatMeters(rest)}`;
    } else if (lenM != null) {
      const reserve = opts.reservePct ?? defaultReserve;
      const req = (lenM + opts.heightStart + opts.heightEnd) / (1 - reserve / 100);
      text = `${formatMeters(lenM)} → benötigt ${formatMeters(req)}`;
    }
  } else if (linear?.segmentLength && lenM != null) {
    text = `${formatMeters(lenM)} · ${Math.ceil(lenM / linear.segmentLength - EPS)}× ${linear.name}`;
  }
  const max = tool === 'cable' ? draftMaxPx(sheet) : null;
  return (
    <Group listening={false}>
      {tool === 'linear' && linear ? (
        <Line points={flat(points)} stroke={linear.color} opacity={0.5} strokeWidth={Math.max(linear.width * ppm, 3 * k)} lineJoin="round" />
      ) : (
        <Line points={flat(points)} stroke={cableColor ?? ACCENT} strokeWidth={2.5} strokeScaleEnabled={false} dash={[6, 4]} lineCap="round" lineJoin="round" />
      )}
      {points.slice(0, -1).map((p, i) => (
        <Circle key={i} x={p[0]} y={p[1]} radius={3 * k} fill="#fff" stroke={cableColor ?? ACCENT} strokeWidth={1.5 * k} />
      ))}
      {max != null && points.length > 1 && (
        <Circle x={points[points.length - 2][0]} y={points[points.length - 2][1]} radius={Math.max(0, max - polylineLengthPx(points.slice(0, -1)))} stroke="#a1a1aa" strokeWidth={1} strokeScaleEnabled={false} dash={[3, 4]} />
      )}
      <TextTag x={end[0]} y={end[1] - 8 * k} text={text} k={k} tone="accent" />
    </Group>
  );
}

function ScaleLine({ a, b, k, label }: { a: Point; b: Point; k: number; label: string }) {
  const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return (
    <Group listening={false}>
      <Line points={[...a, ...b]} stroke="#f97316" strokeWidth={2.5} strokeScaleEnabled={false} dash={[8, 4]} />
      <Circle x={a[0]} y={a[1]} radius={4 * k} fill="#f97316" />
      <Circle x={b[0]} y={b[1]} radius={4 * k} fill="#f97316" />
      {label && <TextTag x={mid[0]} y={mid[1] - 4 * k} text={label} k={k} />}
    </Group>
  );
}

function ScaleDialog({ onClose, onSave, pixels }: { onClose: () => void; onSave: (m: number) => void; pixels: number }) {
  const [m, setM] = useState<number | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title="Maßstab festlegen"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!m || m <= 0} onClick={() => m && onSave(m)}>
            Übernehmen
          </Button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (m && m > 0) onSave(m);
        }}
      >
        <Field label="Wie lang ist die markierte Strecke in Wirklichkeit?" hint={`${Math.round(pixels)} px im Bild`}>
          <div className="flex items-center gap-2">
            <NumberInput autoFocus min={0.01} step={0.1} value={m} allowNull onChange={setM} className="w-32" />
            <span className="text-sm text-zinc-500">Meter</span>
          </div>
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
