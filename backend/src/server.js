import { assertConfig, loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createPaymentProvider } from './providers/payment/index.js';
import { createDispenser } from './providers/dispenser/index.js';

const config = loadConfig();
assertConfig(config);
const db = openDb(config.dbPath);
const { app, orders } = createApp({ db, config, provider: createPaymentProvider(config), dispenser: createDispenser(config) });

orders.recoverOnBoot();
const timer = setInterval(() => orders.reconcile().catch((e) => console.error('reconcile failed', e)), config.reconcileIntervalMs);
timer.unref();

const server = app.listen(config.port, () => console.log(`RevoV backend on :${config.port} (${config.nodeEnv}, payments=${config.paymentProvider}, machine=${config.machineId})`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { clearInterval(timer); server.close(() => { db.close(); process.exit(0); }); });
