import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { HttpError } from '../errors.js';
import { ah, itemsSchema, parse, promoSchema } from './util.js';

const idParam = z.coerce.number().int().positive();

export function orderRoutes({ authn, orders }) {
  const r = Router();
  const staff = requireRole('staff');

  r.get('/orders/active', authn, staff, (req, res) => res.json({ order: orders.activeOrderFor(req.user) }));

  r.post('/orders', authn, staff, ah(async (req, res) => {
    const idemKey = parse(z.string().regex(/^[A-Za-z0-9_-]{8,128}$/), req.get('idempotency-key') ?? '');
    const { items, promoCode } = parse(z.object({ items: itemsSchema, promoCode: promoSchema }), req.body);
    const { order, replay } = orders.createOrder({ user: req.user, idemKey, items, promoCode });
    res.status(replay ? 200 : 201).json({ order });
  }));

  r.get('/orders/:id', authn, ah(async (req, res) => res.json({ order: orders.getOrderFor(req.user, parse(idParam, req.params.id)) })));

  r.post('/orders/:id/pay', authn, staff, ah(async (req, res) => {
    res.json({ order: await orders.startPayment({ user: req.user, orderId: parse(idParam, req.params.id) }) });
  }));

  r.post('/orders/:id/cancel', authn, staff, ah(async (req, res) => {
    res.json({ order: orders.cancelOrder({ user: req.user, orderId: parse(idParam, req.params.id) }) });
  }));

  return r;
}

/** Provider callback. Authenticated by the provider's signature, never by a user token. Always 200 once authentic. */
export function webhookRoutes({ provider, orders }) {
  const r = Router();
  r.post('/webhooks/payment', (req, res) => {
    const v = provider.verifyWebhook(req);
    if (!v.ok) throw new HttpError(401, 'BAD_SIGNATURE', 'Webhook rejected');
    const outcome = orders.applyProviderEvent({ ...v.event, source: 'webhook' });
    res.json({ ok: true, outcome });
  });
  return r;
}
