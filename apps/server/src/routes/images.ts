import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { newId } from '@taxis/shared';
import type { DB } from '../db/index.js';
import { HttpError, notFound } from './util.js';

const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function imageRoutes(app: FastifyInstance, { db, dataDir }: { db: DB; dataDir: string }) {
  const dir = path.join(dataDir, 'uploads');

  app.post('/api/images', async (req) => {
    const file = await req.file();
    if (!file) throw new HttpError(400, 'Keine Datei');
    const ext = ALLOWED[file.mimetype];
    if (!ext) throw new HttpError(400, 'Nur PNG, JPG, WebP oder GIF (PDF wird im Browser umgewandelt)');
    const width = Number((file.fields.width as { value?: string } | undefined)?.value);
    const height = Number((file.fields.height as { value?: string } | undefined)?.value);
    if (!(width > 0 && height > 0)) throw new HttpError(400, 'Bildgröße fehlt');
    const id = newId();
    const filename = `${id}.${ext}`;
    await pipeline(file.file, fs.createWriteStream(path.join(dir, filename)));
    if (file.file.truncated) {
      fs.rmSync(path.join(dir, filename), { force: true });
      throw new HttpError(413, 'Datei zu groß');
    }
    db.prepare('INSERT INTO images (id, filename, mime, width, height) VALUES (?, ?, ?, ?, ?)').run(
      id,
      filename,
      file.mimetype,
      Math.round(width),
      Math.round(height),
    );
    return { id, width, height };
  });

  app.get<{ Params: { id: string } }>('/api/images/:id', async (req, reply) => {
    const row = db.prepare('SELECT filename, mime FROM images WHERE id = ?').get(req.params.id) as
      | { filename: string; mime: string }
      | undefined;
    if (!row) return notFound(reply, 'Bild');
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    reply.type(row.mime);
    return reply.send(fs.createReadStream(path.join(dir, row.filename)));
  });
}
