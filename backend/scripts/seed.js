import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { seedDatabase } from '../src/seed.js';

const config = loadConfig();
const { SEED_ADMIN_PASSWORD: a, SEED_STAFF_PASSWORD: s } = process.env;
if (!a || !s || a.length < 10 || s.length < 10) {
  console.error('Set SEED_ADMIN_PASSWORD and SEED_STAFF_PASSWORD (min 10 chars each) in .env first.');
  process.exit(1);
}
const db = openDb(config.dbPath);
await seedDatabase(db, { adminPassword: a, staffPassword: s });
console.log('Seeded users (admin, staff), 6 products, promo code SAVE10. Existing rows were left untouched.');
db.close();
