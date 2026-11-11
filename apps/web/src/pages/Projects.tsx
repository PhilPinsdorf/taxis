import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Copy, FolderOpen, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ProjectInput, ProjectSummary } from '@taxis/shared';
import { Button, EmptyState, Field, Input, Modal } from '../components/ui';
import { api, formatDate } from '../lib/api';
import { qk } from '../lib/queries';
import { toastError } from '../lib/toast';

export function ProjectsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: projects = [], isLoading } = useQuery({ queryKey: qk.projects, queryFn: api.projects });
  const [editing, setEditing] = useState<ProjectSummary | 'new' | null>(null);

  const save = useMutation({
    mutationFn: async (input: ProjectInput) =>
      editing === 'new' ? api.createProject(input) : api.updateProject((editing as ProjectSummary).id, input),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: qk.project(p.id) });
      if (editing === 'new') navigate(`/p/${p.id}/plan`);
      setEditing(null);
    },
    onError: toastError,
  });

  const duplicate = async (p: ProjectSummary) => {
    try {
      await api.duplicateProject(p.id, `${p.name} (Kopie)`);
      qc.invalidateQueries({ queryKey: qk.projects });
    } catch (e) {
      toastError(e);
    }
  };

  const remove = async (p: ProjectSummary) => {
    if (!confirm(`Projekt „${p.name}“ mit allen Versionen löschen?`)) return;
    await api.deleteProject(p.id).catch(toastError);
    qc.invalidateQueries({ queryKey: qk.projects });
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projekte</h1>
          <p className="text-sm text-zinc-500">Jedes Event hat einen Plan, Versionen und eine eigene Anfragenliste.</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus size={16} /> Neues Projekt
        </Button>
      </div>

      {!isLoading && projects.length === 0 && (
        <EmptyState icon={<FolderOpen size={28} />} title="Noch keine Projekte">
          Lege ein Projekt an, lade einen Lageplan hoch und setze den Maßstab – dann kann geplant werden.
        </EmptyState>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <div
            key={p.id}
            className="group relative rounded-xl border border-zinc-200 bg-surface p-4 shadow-xs transition hover:border-zinc-300 hover:shadow-sm"
          >
            <Link to={`/p/${p.id}/plan`} className="absolute inset-0 rounded-xl" aria-label={p.name} />
            <div className="pr-16 font-medium">{p.name}</div>
            <div className="mt-2 space-y-1 text-sm text-zinc-500">
              {p.date && (
                <div className="flex items-center gap-1.5">
                  <CalendarDays size={14} /> {formatDate(p.date, false)}
                </div>
              )}
              {p.location && (
                <div className="flex items-center gap-1.5">
                  <MapPin size={14} /> {p.location}
                </div>
              )}
            </div>
            <div className="mt-3 text-xs text-zinc-400">Geändert {formatDate(p.updatedAt)}</div>
            <div className="absolute top-3 right-3 flex gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
              <Button variant="ghost" size="icon" title="Bearbeiten" onClick={() => setEditing(p)}>
                <Pencil size={14} />
              </Button>
              <Button variant="ghost" size="icon" title="Duplizieren" onClick={() => duplicate(p)}>
                <Copy size={14} />
              </Button>
              <Button variant="ghost" size="icon" title="Löschen" onClick={() => remove(p)}>
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <ProjectDialog
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(input) => save.mutate(input)}
          busy={save.isPending}
        />
      )}
    </div>
  );
}

function ProjectDialog({
  initial,
  onClose,
  onSave,
  busy,
}: {
  initial: ProjectSummary | null;
  onClose: () => void;
  onSave: (p: ProjectInput) => void;
  busy: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [date, setDate] = useState(initial?.date ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (name.trim()) onSave({ name: name.trim(), date, location });
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Projekt bearbeiten' : 'Neues Projekt'}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!name.trim() || busy} onClick={() => submit()}>
            {initial ? 'Speichern' : 'Anlegen'}
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={submit} className="space-y-3">
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Sommerfest 2027" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Datum">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Ort">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
