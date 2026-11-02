import { z } from 'zod';
import { HttpError } from '../errors.js';

export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(400, 'VALIDATION', 'Invalid request', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

export const itemsSchema = z.array(z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(5),
})).min(1).max(10);

export const promoSchema = z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/).optional();
