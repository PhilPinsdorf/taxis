import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Download, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  buildPatchLists,
  computeRequirements,
  findPortIssues,
  formatMeters,
  newId,
  RequestInputSchema,
  STATUS_LABEL,
  type CoverageStatus,
  type Extra,
  type Material,
  type MaterialRequest,
  type PlanDoc,
  type RequestInput,
  type RequirementRow,
} from '@taxis/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  NumberInput,
  Segmented,
  Select,
  Swatch,
  cx,
  type Tone,
} from '../components/ui';
import { api, ApiError } from '../lib/api';
import { qk, useMaterials, useProject, useRequests } from '../lib/queries';
import { toast, toastError } from '../lib/toast';

type Tab = 'list' | 'requests' | 'extras' | 'ports';

const STATUS_TONE: Record<CoverageStatus, Tone> = { ok: 'green', rented: 'blue', pending: 'amber', missing: 'red' };
const REQ_TONE: Record<MaterialRequest['status'], Tone> = { angefragt: 'amber', bestätigt: 'green', abgelehnt: 'neutral' };

const fmtQty = (n: number, unit: 'Stk' | 'm') => (unit === 'm' ? formatMeters(n) : `${Math.round(n)}`);

export function OverviewPage() {
  const { projectId = '' } = useParams();
  const [tab, setTab] = useState<Tab>('list');
  const { data: project } = useProject(projectId);
  const plan = useQuery({ queryKey: qk.plan(projectId), queryFn: () => api.plan(projectId), staleTime: 0 });
  const { materials, byId } = useMaterials();
  const { data: requests = [] } = useRequests(projectId);
  const [requestDraft, setRequestDraft] = useState<(RequestInput & { id?: string }) | null>(null);

  const doc = plan.data?.doc;
  const rows = useMemo(() => (doc ? computeRequirements(doc, materials, requests) : []), [doc, materials, requests]);
  const issues = useMemo(() => (doc ? findPortIssues(doc, byId) : []), [doc, byId]);
  const patchLists = useMemo(() => (doc ? buildPatchLists(doc, byId) : []), [doc, byId]);

  if (!doc) return null;

  const counts = rows.reduce(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
    {} as Partial<Record<CoverageStatus, number>>,
  );
  const openRequests = requests.filter((r) => r.status === 'angefragt').length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Übersicht</h1>
          <p className="text-sm text-zinc-500">
            {project?.name}
            {project?.location && ` · ${project.location}`}
          </p>
        </div>
        <div className="no-print flex gap-2">
          <Button onClick={() => exportCsv(rows, project?.name ?? 'materialliste')}>
            <Download size={15} /> CSV
          </Button>
          <Button onClick={() => window.print()}>
            <Printer size={15} /> Drucken
          </Button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Fehlt" value={counts.missing ?? 0} tone="red" />
        <Stat label="Nur mit offener Anfrage" value={counts.pending ?? 0} tone="amber" />
        <Stat label="Offene Anfragen" value={openRequests} tone="neutral" />
        <Stat label="Offene Anschlüsse" value={issues.length} tone={issues.length ? 'red' : 'green'} />
      </div>

      <div className="no-print mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'list', label: 'Materialliste' },
            { value: 'requests', label: `Anfragen${requests.length ? ` (${requests.length})` : ''}` },
            { value: 'extras', label: `Zusatzposten${doc.extras.length ? ` (${doc.extras.length})` : ''}` },
            { value: 'ports', label: `Anschlüsse${issues.length ? ` (${issues.length})` : ''}` },
          ]}
        />
      </div>

      {tab === 'list' && (
        <MaterialList
          rows={rows}
          onRequest={(r) => setRequestDraft(prefillRequest(r))}
        />
      )}
      {tab === 'requests' && (
        <RequestsTab
          projectId={projectId}
          requests={requests}
          byId={byId}
          onEdit={(r) => setRequestDraft(r)}
          onNew={() => setRequestDraft(RequestInputSchema.parse({ materialId: materials.find((m) => !m.archived)?.id ?? '', qty: 1 }))}
        />
      )}
      {tab === 'extras' && <ExtrasTab projectId={projectId} doc={doc} revision={plan.data!.revision} materials={materials} byId={byId} />}
      {tab === 'ports' && <PortsTab projectId={projectId} issues={issues} patchLists={patchLists} />}

      {requestDraft && (
        <RequestDialog
          projectId={projectId}
          initial={requestDraft}
          materials={materials}
          onClose={() => setRequestDraft(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  const color = { red: 'text-red-600', amber: 'text-amber-600', green: 'text-emerald-600', blue: 'text-blue-600', neutral: 'text-zinc-900' }[tone];
  return (
    <Card className="px-4 py-3">
      <div className={cx('text-2xl font-semibold tabular-nums', value === 0 ? 'text-zinc-300' : color)}>{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </Card>
  );
}

function prefillRequest(r: RequirementRow): RequestInput {
  const base = RequestInputSchema.parse({ materialId: r.material.id, qty: 1 });
  if (r.material.kind === 'cable') {
    const missing = r.allocation?.byLength.find((b) => b.missing > 0);
    if (missing) return { ...base, qty: missing.missing, lengthM: missing.length };
    return { ...base, qty: 1, lengthM: Math.ceil(r.shortfall) || null };
  }
  return { ...base, qty: Math.max(1, Math.ceil(r.shortfall)) };
}

// ---------------------------------------------------------------------------

function MaterialList({ rows, onRequest }: { rows: RequirementRow[]; onRequest: (r: RequirementRow) => void }) {
  if (rows.length === 0)
    return (
      <EmptyState icon={<CheckCircle2 size={28} />} title="Noch nichts verplant">
        Platziere Objekte und verlege Kabel im Plan – hier erscheint dann automatisch die Materialliste.
      </EmptyState>
    );
  const groups = new Map<string, RequirementRow[]>();
  for (const r of rows) groups.set(r.material.category, [...(groups.get(r.material.category) ?? []), r]);

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50/80 text-left text-xs text-zinc-500">
          <tr>
            <th className="py-2 pl-4 font-medium">Material</th>
            <th className="px-2 text-right font-medium">Bedarf</th>
            <th className="px-2 text-right font-medium">Eigen</th>
            <th className="px-2 text-right font-medium">Bestätigt</th>
            <th className="px-2 text-right font-medium">Angefragt</th>
            <th className="px-2 text-right font-medium">Fehlt</th>
            <th className="px-2 font-medium">Status</th>
            <th className="no-print w-10 pr-3" />
          </tr>
        </thead>
        {[...groups.entries()].map(([cat, list]) => (
          <tbody key={cat} className="divide-y divide-zinc-100">
            <tr className="bg-zinc-50/50">
              <td colSpan={8} className="py-1.5 pl-4 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
                {cat}
              </td>
            </tr>
            {list.map((r) => (
              <tr key={r.material.id} className="align-top">
                <td className="py-2.5 pl-4">
                  <div className="flex items-center gap-2">
                    <Swatch color={r.material.color} round={r.material.shape === 'circle'} />
                    <span className="font-medium">{r.material.name}</span>
                  </div>
                  <div className="mt-0.5 space-y-0.5 pl-5 text-xs text-zinc-500">
                    {r.extra > 0 && (
                      <div>
                        Plan {fmtQty(r.planned, r.unit)} + Zusatz {fmtQty(r.extra, r.unit)}
                      </div>
                    )}
                    {r.material.kind === 'linear' && r.totalM != null && r.totalM > 0 && <div>Strecke gesamt {formatMeters(r.totalM)}</div>}
                    {r.allocation && r.allocation.byLength.length > 0 && (
                      <div>
                        Stücke:{' '}
                        {r.allocation.byLength.map((b, i) => (
                          <span key={b.length}>
                            {i > 0 && ', '}
                            {b.needed}× {b.length.toLocaleString('de-DE')} m
                            {b.missing > 0 && <span className="font-medium text-red-600"> ({b.missing} fehlen)</span>}
                          </span>
                        ))}
                      </div>
                    )}
                    {r.warnings.map((w) => (
                      <div key={w} className="flex items-center gap-1 text-amber-700">
                        <AlertCircle size={12} /> {w}
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-2 py-2.5 text-right font-semibold tabular-nums">{fmtQty(r.needed, r.unit)}</td>
                <td className="px-2 py-2.5 text-right text-zinc-600 tabular-nums">{fmtQty(r.owned, r.unit)}</td>
                <td className="px-2 py-2.5 text-right text-zinc-600 tabular-nums">{r.confirmed ? fmtQty(r.confirmed, r.unit) : '–'}</td>
                <td className="px-2 py-2.5 text-right text-zinc-600 tabular-nums">{r.pending ? fmtQty(r.pending, r.unit) : '–'}</td>
                <td className={cx('px-2 py-2.5 text-right tabular-nums', r.shortfall > 0 ? 'font-semibold text-red-600' : 'text-zinc-300')}>
                  {r.shortfall > 0 ? fmtQty(r.shortfall, r.allocation ? 'm' : r.unit) : '–'}
                </td>
                <td className="px-2 py-2.5">
                  <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                </td>
                <td className="no-print py-2 pr-3 text-right">
                  {r.status !== 'ok' && (
                    <Button variant="ghost" size="icon" title="Anfrage anlegen" onClick={() => onRequest(r)}>
                      <Plus size={15} />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </Card>
  );
}

function exportCsv(rows: RequirementRow[], name: string) {
  const esc = (v: string | number) => {
    const s = typeof v === 'number' ? v.toLocaleString('de-DE', { maximumFractionDigits: 2, useGrouping: false }) : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['Kategorie', 'Material', 'Einheit', 'Bedarf', 'Plan', 'Zusatz', 'Eigenbestand', 'Bestätigt', 'Angefragt', 'Fehlt', 'Status', 'Stücke'];
  const lines = rows.map((r) =>
    [
      r.material.category,
      r.material.name,
      r.unit,
      r.needed,
      r.planned,
      r.extra,
      r.owned,
      r.confirmed,
      r.pending,
      r.shortfall,
      STATUS_LABEL[r.status],
      r.allocation ? r.allocation.byLength.map((b) => `${b.needed}x${b.length}m${b.missing ? ` (${b.missing} fehlen)` : ''}`).join(', ') : '',
    ]
      .map(esc)
      .join(';'),
  );
  const blob = new Blob(['﻿' + [header.join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim() || 'materialliste'}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------------------

function RequestsTab({
  projectId,
  requests,
  byId,
  onEdit,
  onNew,
}: {
  projectId: string;
  requests: MaterialRequest[];
  byId: Map<string, Material>;
  onEdit: (r: MaterialRequest) => void;
  onNew: () => void;
}) {
  const qc = useQueryClient();
  const update = async (r: MaterialRequest, patch: Partial<RequestInput>) => {
    const { id, projectId: _p, createdAt: _c, ...input } = r;
    await api.updateRequest(projectId, id, { ...input, ...patch }).catch(toastError);
    qc.invalidateQueries({ queryKey: qk.requests(projectId) });
  };
  const remove = async (r: MaterialRequest) => {
    if (!confirm('Anfrage löschen?')) return;
    await api.deleteRequest(projectId, r.id).catch(toastError);
    qc.invalidateQueries({ queryKey: qk.requests(projectId) });
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">Angefragtes Material (Miete, Leihe). Bestätigte und offene Anfragen fließen in den Abgleich ein.</p>
        <Button variant="primary" className="no-print" onClick={onNew}>
          <Plus size={15} /> Anfrage
        </Button>
      </div>
      {requests.length === 0 ? (
        <EmptyState icon={<Plus size={28} />} title="Keine Anfragen">
          Tipp: In der Materialliste über „+“ direkt aus einer Fehlmenge eine Anfrage erstellen.
        </EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50/80 text-left text-xs text-zinc-500">
              <tr>
                <th className="py-2 pl-4 font-medium">Material</th>
                <th className="px-2 text-right font-medium">Menge</th>
                <th className="px-2 font-medium">Lieferant</th>
                <th className="px-2 font-medium">Status</th>
                <th className="px-2 font-medium">Notiz</th>
                <th className="no-print w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {requests.map((r) => {
                const m = byId.get(r.materialId);
                return (
                  <tr key={r.id}>
                    <td className="py-2 pl-4">
                      <div className="flex items-center gap-2">
                        {m && <Swatch color={m.color} />}
                        <span className="font-medium">{m?.name ?? 'Unbekannt'}</span>
                      </div>
                    </td>
                    <td className="px-2 text-right tabular-nums">
                      {r.qty}
                      {r.lengthM != null ? ` × ${r.lengthM.toLocaleString('de-DE')} m` : ' Stk'}
                    </td>
                    <td className="px-2 text-zinc-600">{r.supplier || '–'}</td>
                    <td className="px-2">
                      <select
                        className={cx(
                          'no-print rounded-md border-0 py-0.5 pr-6 pl-1.5 text-xs font-medium ring-1 ring-inset',
                          r.status === 'bestätigt' && 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
                          r.status === 'angefragt' && 'bg-amber-50 text-amber-800 ring-amber-600/20',
                          r.status === 'abgelehnt' && 'bg-zinc-100 text-zinc-600 ring-zinc-300',
                        )}
                        value={r.status}
                        onChange={(e) => update(r, { status: e.target.value as RequestInput['status'] })}
                      >
                        <option value="angefragt">angefragt</option>
                        <option value="bestätigt">bestätigt</option>
                        <option value="abgelehnt">abgelehnt</option>
                      </select>
                      <Badge tone={REQ_TONE[r.status]} className="hidden print:inline-flex">
                        {r.status}
                      </Badge>
                    </td>
                    <td className="max-w-56 truncate px-2 text-zinc-600">{r.note}</td>
                    <td className="no-print pr-3 text-right">
                      <Button variant="ghost" size="icon" onClick={() => onEdit(r)}>
                        <Pencil size={14} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(r)}>
                        <Trash2 size={14} />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function RequestDialog({
  projectId,
  initial,
  materials,
  onClose,
}: {
  projectId: string;
  initial: RequestInput & { id?: string };
  materials: Material[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [r, setR] = useState<RequestInput>(() => RequestInputSchema.parse(initial));
  const m = materials.find((x) => x.id === r.materialId);
  const isCable = m?.kind === 'cable';
  const save = useMutation({
    mutationFn: () => {
      const input = { ...r, lengthM: isCable ? r.lengthM : null };
      return initial.id ? api.updateRequest(projectId, initial.id, input) : api.createRequest(projectId, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.requests(projectId) });
      toast('Anfrage gespeichert', 'success');
      onClose();
    },
    onError: toastError,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={initial.id ? 'Anfrage bearbeiten' : 'Neue Anfrage'}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!r.materialId || r.qty < 1 || (isCable && !r.lengthM) || save.isPending} onClick={() => save.mutate()}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Material">
          <Select value={r.materialId} onChange={(e) => setR({ ...r, materialId: e.target.value })}>
            {materials
              .filter((x) => !x.archived || x.id === r.materialId)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.category} · {x.name}
                </option>
              ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={isCable ? 'Anzahl Kabel' : 'Menge'}>
            <NumberInput min={1} step={1} value={r.qty} onChange={(v) => setR({ ...r, qty: Math.max(1, Math.round(v ?? 1)) })} />
          </Field>
          {isCable && (
            <Field label="Länge je Kabel (m)">
              <NumberInput allowNull min={0.5} step={5} value={r.lengthM} onChange={(v) => setR({ ...r, lengthM: v && v > 0 ? v : null })} />
            </Field>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lieferant / Verleiher">
            <Input value={r.supplier} onChange={(e) => setR({ ...r, supplier: e.target.value })} />
          </Field>
          <Field label="Status">
            <Select value={r.status} onChange={(e) => setR({ ...r, status: e.target.value as RequestInput['status'] })}>
              <option value="angefragt">angefragt</option>
              <option value="bestätigt">bestätigt</option>
              <option value="abgelehnt">abgelehnt</option>
            </Select>
          </Field>
        </div>
        <Field label="Notiz">
          <Input value={r.note} onChange={(e) => setR({ ...r, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function ExtrasTab({
  projectId,
  doc,
  revision,
  materials,
  byId,
}: {
  projectId: string;
  doc: PlanDoc;
  revision: number;
  materials: Material[];
  byId: Map<string, Material>;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Extra | null>(null);

  const saveDoc = async (next: PlanDoc) => {
    try {
      const r = await api.savePlan(projectId, next, revision);
      qc.setQueryData(qk.plan(projectId), { doc: next, revision: r.revision });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast('Plan wurde zwischenzeitlich geändert – bitte erneut versuchen.', 'error');
        qc.invalidateQueries({ queryKey: qk.plan(projectId) });
      } else toastError(e);
    }
  };

  const upsert = (x: Extra) => {
    const exists = doc.extras.some((e) => e.id === x.id);
    saveDoc({ ...doc, extras: exists ? doc.extras.map((e) => (e.id === x.id ? x : e)) : [...doc.extras, x] });
    setDraft(null);
  };

  const m = draft ? byId.get(draft.materialId) : undefined;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          Zusätzlicher Bedarf, der nicht im Plan eingezeichnet ist – z.B. „noch ein 15 m-Kabel zur Kasse“ oder Reserve-Material.
        </p>
        <Button
          variant="primary"
          className="no-print"
          onClick={() => setDraft({ id: newId(), materialId: materials.find((x) => !x.archived)?.id ?? '', qty: 1, lengthM: null, note: '' })}
        >
          <Plus size={15} /> Zusatzposten
        </Button>
      </div>
      {doc.extras.length === 0 ? (
        <EmptyState icon={<Plus size={28} />} title="Keine Zusatzposten" />
      ) : (
        <Card className="divide-y divide-zinc-100">
          {doc.extras.map((x) => {
            const mm = byId.get(x.materialId);
            return (
              <div key={x.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                {mm && <Swatch color={mm.color} />}
                <span className="font-medium">{mm?.name ?? 'Unbekannt'}</span>
                <span className="text-zinc-600 tabular-nums">
                  {x.qty}
                  {x.lengthM != null ? ` × ${x.lengthM.toLocaleString('de-DE')} m` : mm?.kind === 'cable' ? ' m' : ' Stk'}
                </span>
                <span className="flex-1 truncate text-zinc-500">{x.note}</span>
                <Button variant="ghost" size="icon" className="no-print" onClick={() => setDraft(x)}>
                  <Pencil size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="no-print"
                  onClick={() => saveDoc({ ...doc, extras: doc.extras.filter((e) => e.id !== x.id) })}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            );
          })}
        </Card>
      )}
      {draft && (
        <Modal
          open
          onClose={() => setDraft(null)}
          title="Zusatzposten"
          footer={
            <>
              <Button onClick={() => setDraft(null)}>Abbrechen</Button>
              <Button variant="primary" disabled={!draft.materialId} onClick={() => upsert({ ...draft, lengthM: m?.kind === 'cable' ? draft.lengthM : null })}>
                Speichern
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="Material">
              <Select value={draft.materialId} onChange={(e) => setDraft({ ...draft, materialId: e.target.value })}>
                {materials
                  .filter((x) => !x.archived || x.id === draft.materialId)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.category} · {x.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={m?.kind === 'cable' ? (draft.lengthM ? 'Anzahl Kabel' : 'Meter') : m?.kind === 'linear' ? 'Segmente' : 'Stück'}>
                <NumberInput min={1} step={1} value={draft.qty} onChange={(v) => setDraft({ ...draft, qty: Math.max(1, Math.round(v ?? 1)) })} />
              </Field>
              {m?.kind === 'cable' && (
                <Field label="Länge je Kabel (m)" hint="leer = nur Meter zählen">
                  <NumberInput allowNull min={0.5} step={5} value={draft.lengthM} onChange={(v) => setDraft({ ...draft, lengthM: v && v > 0 ? v : null })} />
                </Field>
              )}
            </div>
            <Field label="Notiz">
              <Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="wofür?" />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PortsTab({
  projectId,
  issues,
  patchLists,
}: {
  projectId: string;
  issues: ReturnType<typeof findPortIssues>;
  patchLists: ReturnType<typeof buildPatchLists>;
}) {
  const byItem = new Map<string, typeof issues>();
  for (const i of issues) byItem.set(i.itemId, [...(byItem.get(i.itemId) ?? []), i]);
  const label: Record<string, ReactNode> = {
    'required-open': <Badge tone="red">offen</Badge>,
    overbooked: <Badge tone="red">überbelegt</Badge>,
    incompatible: <Badge tone="amber">Stecker passt nicht</Badge>,
  };
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold">Offene Punkte</h2>
        {issues.length === 0 ? (
          <Card className="flex items-center gap-2 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 size={16} /> Alle Pflicht-Anschlüsse sind verbunden.
          </Card>
        ) : (
          <Card className="divide-y divide-zinc-100">
            {[...byItem.entries()].map(([itemId, list]) => (
              <div key={itemId} className="flex items-start gap-4 px-4 py-2.5 text-sm">
                <Link to={`/p/${projectId}/plan?sel=${itemId}`} className="w-56 shrink-0 font-medium hover:text-accent">
                  {list[0].itemName}
                </Link>
                <ul className="flex-1 space-y-1">
                  {list.map((i, n) => (
                    <li key={n} className="flex items-center gap-2 text-zinc-700">
                      {label[i.type]} {i.message}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Belegung / Patchlisten</h2>
        {patchLists.length === 0 && <p className="text-sm text-zinc-500">Keine Geräte mit mehreren Kanälen im Plan (Stagebox, Verteiler, Pult).</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          {patchLists.map((pl) => (
            <Card key={pl.item.id} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Swatch color={pl.material.color} />
                  <Link to={`/p/${projectId}/plan?sel=${pl.item.id}`} className="font-medium hover:text-accent">
                    {pl.name}
                  </Link>
                </div>
                <span className="text-xs text-zinc-500 tabular-nums">
                  {pl.used} / {pl.total} belegt
                </span>
              </div>
              <table className="w-full text-[13px]">
                <tbody className="divide-y divide-zinc-50">
                  {pl.rows.map((r) => (
                    <tr key={`${r.port.id}-${r.channel}`} className={r.cableId ? '' : 'text-zinc-400'}>
                      <td className="w-36 py-1 pl-4">
                        {r.port.name}
                        {r.port.count > 1 && <span className="ml-1 tabular-nums">#{r.channel}</span>}
                      </td>
                      <td className="px-2 py-1">{r.cableLabel}</td>
                      <td className="py-1 pr-4 text-right">{r.farEnd || '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

