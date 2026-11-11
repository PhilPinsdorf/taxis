import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MaterialInputSchema, newId, type Material } from '@taxis/shared';
import type { DB } from '../db/index.js';
import { notFound, parse } from './util.js';

export function rowToMaterial(row: { id: string; data: string }): Material {
  return { ...MaterialInputSchema.parse(JSON.parse(row.data)), id: row.id };
}

export function listMaterials(db: DB): Material[] {
  const rows = db.prepare('SELECT id, data FROM materials ORDER BY created_at, rowid').all() as { id: string; data: string }[];
  return rows.map(rowToMaterial);
}

export async function materialRoutes(app: FastifyInstance, { db }: { db: DB }) {
  app.get('/api/materials', async () => listMaterials(db));

  app.post('/api/materials', async (req) => {
    const input = parse(MaterialInputSchema, req.body);
    const id = newId();
    db.prepare('INSERT INTO materials (id, data) VALUES (?, ?)').run(id, JSON.stringify(input));
    return { ...input, id };
  });

  app.put<{ Params: { id: string } }>('/api/materials/:id', async (req, reply) => {
    const input = parse(MaterialInputSchema, req.body);
    const r = db
      .prepare("UPDATE materials SET data = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(input), req.params.id);
    if (r.changes === 0) return notFound(reply, 'Material');
    return { ...input, id: req.params.id };
  });

  /** Löschen = archivieren, damit Pläne/Snapshots ihre Referenzen behalten */
  app.delete<{ Params: { id: string } }>('/api/materials/:id', async (req, reply) => {
    const row = db.prepare('SELECT id, data FROM materials WHERE id = ?').get(req.params.id) as
      | { id: string; data: string }
      | undefined;
    if (!row) return notFound(reply, 'Material');
    const m = rowToMaterial(row);
    const { id: _id, ...rest } = m;
    db.prepare("UPDATE materials SET data = ?, updated_at = datetime('now') WHERE id = ?").run(
      JSON.stringify({ ...rest, archived: true }),
      m.id,
    );
    return { ok: true };
  });

  app.get('/api/connector-types', async () =>
    (db.prepare('SELECT name FROM connector_types ORDER BY sort, name').all() as { name: string }[]).map((r) => r.name),
  );

  app.put('/api/connector-types', async (req) => {
    const names = parse(z.array(z.string().trim().min(1)), req.body);
    const unique = [...new Set(names)];
    db.transaction(() => {
      db.prepare('DELETE FROM connector_types').run();
      const ins = db.prepare('INSERT INTO connector_types (name, sort) VALUES (?, ?)');
      unique.forEach((n, i) => ins.run(n, i));
    })();
    return unique;
  });
}
