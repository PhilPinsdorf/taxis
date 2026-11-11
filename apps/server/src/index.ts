import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from './db/index.js';
import { registerAuth } from './auth.js';
import { materialRoutes } from './routes/materials.js';
import { projectRoutes } from './routes/projects.js';
import { imageRoutes } from './routes/images.js';
import { HttpError } from './routes/util.js';

const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
const staticDir = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : null;
const port = Number(process.env.PORT ?? 8080);

const db = openDb(dataDir);
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 20 * 1024 * 1024 });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  if (status >= 500) app.log.error(err);
  return reply.code(status).send({ error: status >= 500 ? 'Interner Fehler' : (err as Error).message });
});

await app.register(cookie);
await app.register(multipart, { limits: { fileSize: 60 * 1024 * 1024, files: 1 } });
await registerAuth(app);

app.get('/api/health', async () => ({ ok: true }));
await app.register(materialRoutes, { db });
await app.register(projectRoutes, { db });
await app.register(imageRoutes, { db, dataDir });

if (staticDir && fs.existsSync(staticDir)) {
  await app.register(fastifyStatic, { root: staticDir, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Nicht gefunden' });
    return reply.sendFile('index.html');
  });
}

const close = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', close);
process.on('SIGINT', close);

await app.listen({ port, host: '0.0.0.0' });
