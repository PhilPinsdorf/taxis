import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/**
 * AUTH_MODE=none      → offen (Standard)
 * AUTH_MODE=password  → gemeinsames Passwort aus APP_PASSWORD, Session-Cookie (HMAC-signiert)
 * Später: echte Benutzer – Routen bleiben gleich, nur dieses Plugin wird erweitert.
 */
export async function registerAuth(app: FastifyInstance) {
  const mode = process.env.AUTH_MODE ?? 'none';
  const password = process.env.APP_PASSWORD ?? '';
  const secret = process.env.SESSION_SECRET || crypto.createHash('sha256').update(`taxis:${password}`).digest('hex');
  const enabled = mode === 'password';
  if (enabled && !password) throw new Error('AUTH_MODE=password benötigt APP_PASSWORD');

  const sign = (v: string) => crypto.createHmac('sha256', secret).update(v).digest('hex');
  const token = () => {
    const exp = Date.now() + 30 * 24 * 3600 * 1000;
    return `${exp}.${sign(String(exp))}`;
  };
  const valid = (t: string | undefined) => {
    if (!t) return false;
    const [exp, sig] = t.split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    const expected = sign(exp);
    return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  };

  app.get('/api/auth', async (req) => ({ required: enabled, authenticated: !enabled || valid(req.cookies.taxis_session) }));

  app.post<{ Body: { password?: string } }>('/api/auth/login', async (req, reply) => {
    if (!enabled) return { ok: true };
    const given = Buffer.from(String(req.body?.password ?? ''));
    const want = Buffer.from(password);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
      return reply.code(401).send({ error: 'Falsches Passwort' });
    }
    reply.setCookie('taxis_session', token(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      path: '/',
      maxAge: 30 * 24 * 3600,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie('taxis_session', { path: '/' });
    return { ok: true };
  });

  if (!enabled) return;
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url;
    if (!url.startsWith('/api/') || url.startsWith('/api/auth') || url === '/api/health') return;
    if (!valid(req.cookies.taxis_session)) return reply.code(401).send({ error: 'Nicht angemeldet' });
  });
}
