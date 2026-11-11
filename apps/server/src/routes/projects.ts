import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  emptyPlan,
  newId,
  PlanDocSchema,
  ProjectInputSchema,
  RequestInputSchema,
  type MaterialRequest,
  type PlanDoc,
  type ProjectSummary,
  type SnapshotSummary,
} from '@taxis/shared';
import type { DB } from '../db/index.js';
import { notFound, parse } from './util.js';

interface ProjectRow {
  id: string;
  name: string;
  date: string;
  location: string;
  plan_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

const summary = (r: ProjectRow): ProjectSummary => ({
  id: r.id,
  name: r.name,
  date: r.date,
  location: r.location,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const snapSummary = (r: { id: string; project_id: string; name: string; note: string; created_at: string }): SnapshotSummary => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  note: r.note,
  createdAt: r.created_at,
});

const parsePlan = (json: string): PlanDoc => PlanDocSchema.parse(JSON.parse(json));

export async function projectRoutes(app: FastifyInstance, { db }: { db: DB }) {
  const getProject = (id: string) => db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;

  const createProject = (input: z.infer<typeof ProjectInputSchema>, doc: PlanDoc) => {
    const id = newId();
    db.prepare('INSERT INTO projects (id, name, date, location, plan_json) VALUES (?, ?, ?, ?, ?)').run(
      id,
      input.name,
      input.date,
      input.location,
      JSON.stringify(doc),
    );
    return summary(getProject(id)!);
  };

  const snapshot = (projectId: string, name: string, note: string, planJson: string) => {
    const id = newId();
    db.prepare('INSERT INTO snapshots (id, project_id, name, note, plan_json) VALUES (?, ?, ?, ?, ?)').run(
      id,
      projectId,
      name,
      note,
      planJson,
    );
    return id;
  };

  // ---- Projekte ----
  app.get('/api/projects', async () =>
    (db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as ProjectRow[]).map(summary),
  );

  app.post('/api/projects', async (req) => createProject(parse(ProjectInputSchema, req.body), emptyPlan()));

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const p = getProject(req.params.id);
    return p ? summary(p) : notFound(reply, 'Projekt');
  });

  app.put<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const input = parse(ProjectInputSchema, req.body);
    const r = db
      .prepare("UPDATE projects SET name = ?, date = ?, location = ?, updated_at = datetime('now') WHERE id = ?")
      .run(input.name, input.date, input.location, req.params.id);
    if (r.changes === 0) return notFound(reply, 'Projekt');
    return summary(getProject(req.params.id)!);
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  /** Kopie des Projekts – optional aus einem Snapshot (Variante) */
  app.post<{ Params: { id: string } }>('/api/projects/:id/duplicate', async (req, reply) => {
    const body = parse(z.object({ name: z.string().min(1), snapshotId: z.string().optional() }), req.body);
    const p = getProject(req.params.id);
    if (!p) return notFound(reply, 'Projekt');
    let planJson = p.plan_json;
    if (body.snapshotId) {
      const s = db
        .prepare('SELECT plan_json FROM snapshots WHERE id = ? AND project_id = ?')
        .get(body.snapshotId, p.id) as { plan_json: string } | undefined;
      if (!s) return notFound(reply, 'Version');
      planJson = s.plan_json;
    }
    const created = createProject({ name: body.name, date: p.date, location: p.location }, parsePlan(planJson));
    const reqs = db.prepare('SELECT data FROM requests WHERE project_id = ?').all(p.id) as { data: string }[];
    const ins = db.prepare('INSERT INTO requests (id, project_id, data) VALUES (?, ?, ?)');
    for (const r of reqs) ins.run(newId(), created.id, r.data);
    return created;
  });

  // ---- Plan (Arbeitsstand) ----
  app.get<{ Params: { id: string } }>('/api/projects/:id/plan', async (req, reply) => {
    const p = getProject(req.params.id);
    if (!p) return notFound(reply, 'Projekt');
    return { doc: parsePlan(p.plan_json), revision: p.revision };
  });

  app.put<{ Params: { id: string } }>('/api/projects/:id/plan', async (req, reply) => {
    const body = parse(z.object({ doc: PlanDocSchema, revision: z.number().int() }), req.body);
    const r = db
      .prepare(
        "UPDATE projects SET plan_json = ?, revision = revision + 1, updated_at = datetime('now') WHERE id = ? AND revision = ?",
      )
      .run(JSON.stringify(body.doc), req.params.id, body.revision);
    if (r.changes === 0) {
      const p = getProject(req.params.id);
      if (!p) return notFound(reply, 'Projekt');
      return reply.code(409).send({ error: 'Der Plan wurde zwischenzeitlich anderswo geändert.', revision: p.revision });
    }
    return { revision: body.revision + 1 };
  });

  // ---- Snapshots ----
  app.get<{ Params: { id: string } }>('/api/projects/:id/snapshots', async (req) =>
    (
      db
        .prepare('SELECT id, project_id, name, note, created_at FROM snapshots WHERE project_id = ? ORDER BY created_at DESC, rowid DESC')
        .all(req.params.id) as Parameters<typeof snapSummary>[0][]
    ).map(snapSummary),
  );

  app.post<{ Params: { id: string } }>('/api/projects/:id/snapshots', async (req, reply) => {
    const body = parse(z.object({ name: z.string().min(1), note: z.string().default('') }), req.body);
    const p = getProject(req.params.id);
    if (!p) return notFound(reply, 'Projekt');
    const id = snapshot(p.id, body.name, body.note, p.plan_json);
    const row = db.prepare('SELECT id, project_id, name, note, created_at FROM snapshots WHERE id = ?').get(id);
    return snapSummary(row as Parameters<typeof snapSummary>[0]);
  });

  app.get<{ Params: { id: string; sid: string } }>('/api/projects/:id/snapshots/:sid', async (req, reply) => {
    const s = db
      .prepare('SELECT * FROM snapshots WHERE id = ? AND project_id = ?')
      .get(req.params.sid, req.params.id) as (Parameters<typeof snapSummary>[0] & { plan_json: string }) | undefined;
    if (!s) return notFound(reply, 'Version');
    return { ...snapSummary(s), doc: parsePlan(s.plan_json) };
  });

  app.delete<{ Params: { id: string; sid: string } }>('/api/projects/:id/snapshots/:sid', async (req) => {
    db.prepare('DELETE FROM snapshots WHERE id = ? AND project_id = ?').run(req.params.sid, req.params.id);
    return { ok: true };
  });

  /** Wiederherstellen: aktueller Stand wird vorher automatisch gesichert */
  app.post<{ Params: { id: string; sid: string } }>('/api/projects/:id/snapshots/:sid/restore', async (req, reply) => {
    const p = getProject(req.params.id);
    const s = db
      .prepare('SELECT name, plan_json FROM snapshots WHERE id = ? AND project_id = ?')
      .get(req.params.sid, req.params.id) as { name: string; plan_json: string } | undefined;
    if (!p || !s) return notFound(reply, 'Version');
    db.transaction(() => {
      snapshot(p.id, `Automatisch vor Wiederherstellung von „${s.name}“`, '', p.plan_json);
      db.prepare("UPDATE projects SET plan_json = ?, revision = revision + 1, updated_at = datetime('now') WHERE id = ?").run(
        s.plan_json,
        p.id,
      );
    })();
    const np = getProject(p.id)!;
    return { doc: parsePlan(np.plan_json), revision: np.revision };
  });

  // ---- Anfragen ----
  const toRequest = (r: { id: string; project_id: string; data: string; created_at: string }): MaterialRequest => ({
    ...RequestInputSchema.parse(JSON.parse(r.data)),
    id: r.id,
    projectId: r.project_id,
    createdAt: r.created_at,
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/requests', async (req) =>
    (
      db.prepare('SELECT * FROM requests WHERE project_id = ? ORDER BY created_at, rowid').all(req.params.id) as Parameters<
        typeof toRequest
      >[0][]
    ).map(toRequest),
  );

  app.post<{ Params: { id: string } }>('/api/projects/:id/requests', async (req, reply) => {
    const input = parse(RequestInputSchema, req.body);
    if (!getProject(req.params.id)) return notFound(reply, 'Projekt');
    const id = newId();
    db.prepare('INSERT INTO requests (id, project_id, data) VALUES (?, ?, ?)').run(id, req.params.id, JSON.stringify(input));
    return toRequest(db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as Parameters<typeof toRequest>[0]);
  });

  app.put<{ Params: { id: string; rid: string } }>('/api/projects/:id/requests/:rid', async (req, reply) => {
    const input = parse(RequestInputSchema, req.body);
    const r = db
      .prepare('UPDATE requests SET data = ? WHERE id = ? AND project_id = ?')
      .run(JSON.stringify(input), req.params.rid, req.params.id);
    if (r.changes === 0) return notFound(reply, 'Anfrage');
    return toRequest(db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.rid) as Parameters<typeof toRequest>[0]);
  });

  app.delete<{ Params: { id: string; rid: string } }>('/api/projects/:id/requests/:rid', async (req) => {
    db.prepare('DELETE FROM requests WHERE id = ? AND project_id = ?').run(req.params.rid, req.params.id);
    return { ok: true };
  });
}
