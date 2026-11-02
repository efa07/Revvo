import express from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { authenticate } from './auth.js';
import { HttpError } from './errors.js';
import { createOrderService } from './services/orders.js';
import { authRoutes } from './routes/auth.js';
import { productRoutes } from './routes/products.js';
import { orderRoutes, webhookRoutes } from './routes/orders.js';
import { mockRoutes, returnRoutes } from './routes/mock.js';

export function createApp({ db, config, provider, dispenser }) {
  const orders = createOrderService({ db, config, provider, dispenser });
  const authn = authenticate(db, config);
  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: '20kb', verify: (req, _res, buf) => { req.rawBody = buf; } })); // raw bytes needed for webhook signatures

  app.get('/health', (_req, res) => res.json({ ok: true }));
  const api = express.Router();
  api.use('/auth', authRoutes({ db, config, authn }));
  api.use(productRoutes({ db, config, authn }));
  api.use(orderRoutes({ authn, orders }));
  api.use(webhookRoutes({ provider, orders }));
  app.use('/api', api);
  app.use(returnRoutes());
  if (provider.name === 'mock') app.use(mockRoutes({ provider })); // physically absent from real-provider deployments

  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Not found')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message, detail: err.detail } });
    if (err instanceof ZodError || err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid request' } });
    console.error(err); // never echo internals to the client
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  return { app, orders };
}
