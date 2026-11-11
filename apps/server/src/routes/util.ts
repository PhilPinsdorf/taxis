import type { FastifyReply } from 'fastify';
import type { z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'Eingabe'}: ${i.message}`).join('; ');
    throw new HttpError(400, msg);
  }
  return r.data;
}

export function notFound(reply: FastifyReply, what = 'Eintrag') {
  return reply.code(404).send({ error: `${what} nicht gefunden` });
}
