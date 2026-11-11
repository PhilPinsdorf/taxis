import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, GitBranch, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Field, Input, SectionTitle, cx } from '../../components/ui';
import { api, formatDate } from '../../lib/api';
import { qk } from '../../lib/queries';
import { toast, toastError } from '../../lib/toast';
import { editor, useEditor } from '../store';

export function VersionsPanel({ projectId, flush }: { projectId: string; flush: () => Promise<boolean> }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: snapshots = [] } = useQuery({ queryKey: qk.snapshots(projectId), queryFn: () => api.snapshots(projectId) });
  const preview = useEditor((s) => s.preview);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (!(await flush())) throw new Error('Aktueller Stand konnte nicht gespeichert werden.');
      await api.createSnapshot(projectId, name.trim(), note.trim());
      qc.invalidateQueries({ queryKey: qk.snapshots(projectId) });
      setName('');
      setNote('');
      toast('Version gespeichert', 'success');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const view = async (id: string) => {
    try {
      const s = await api.snapshot(projectId, id);
      useEditor.setState({ preview: { id: s.id, name: s.name, doc: s.doc }, selection: null, draft: null, tool: 'select' });
    } catch (e) {
      toastError(e);
    }
  };

  const restore = async (id: string, label: string) => {
    if (!confirm(`Version „${label}“ wiederherstellen? Der aktuelle Stand wird vorher automatisch gesichert.`)) return;
    try {
      await flush();
      const state = await api.restoreSnapshot(projectId, id);
      editor.load(projectId, state.doc, state.revision);
      qc.invalidateQueries({ queryKey: qk.snapshots(projectId) });
      toast('Version wiederhergestellt', 'success');
    } catch (e) {
      toastError(e);
    }
  };

  const variant = async (id: string, label: string) => {
    const n = prompt('Name der Variante (neues Projekt)', label);
    if (!n) return;
    try {
      const p = await api.duplicateProject(projectId, n, id);
      qc.invalidateQueries({ queryKey: qk.projects });
      navigate(`/p/${p.id}/plan`);
    } catch (e) {
      toastError(e);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Version löschen?')) return;
    await api.deleteSnapshot(projectId, id).catch(toastError);
    if (preview?.id === id) useEditor.setState({ preview: null });
    qc.invalidateQueries({ queryKey: qk.snapshots(projectId) });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <SectionTitle>Aktuellen Stand sichern</SectionTitle>
      <form
        noValidate
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. nach Begehung" />
        </Field>
        <Field label="Notiz (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" size="sm" className="w-full justify-center" disabled={!name.trim() || busy}>
          <Save size={14} /> Version speichern
        </Button>
      </form>

      <div className="mt-6">
        <SectionTitle>Gespeicherte Versionen</SectionTitle>
        {snapshots.length === 0 && <p className="text-sm text-zinc-500">Noch keine Versionen.</p>}
        <ol className="space-y-1.5">
          {snapshots.map((s) => (
            <li
              key={s.id}
              className={cx(
                'group rounded-lg border px-3 py-2',
                preview?.id === s.id ? 'border-accent bg-accent-soft' : 'border-zinc-200 bg-surface',
              )}
            >
              <div className="text-[13px] font-medium">{s.name}</div>
              <div className="text-xs text-zinc-500">{formatDate(s.createdAt)}</div>
              {s.note && <div className="mt-1 text-xs text-zinc-600">{s.note}</div>}
              <div className="mt-1.5 flex gap-0.5">
                <Button variant="ghost" size="sm" onClick={() => view(s.id)} title="Ansehen">
                  <Eye size={13} /> Ansehen
                </Button>
                <Button variant="ghost" size="icon" onClick={() => restore(s.id, s.name)} title="Wiederherstellen">
                  <RotateCcw size={14} />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => variant(s.id, s.name)} title="Als neues Projekt (Variante)">
                  <GitBranch size={14} />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => remove(s.id)} title="Löschen">
                  <Trash2 size={14} />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
