import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { HttpError } from '../errors.js';
import { audit, getSetting, setSetting } from '../db.js';
import { buildQuote, quoteView } from '../services/pricing.js';
import { ah, itemsSchema, parse, promoSchema } from './util.js';

const category = z.enum(['drinks', 'snacks', 'sweets']);
const money = z.number().int().min(1).max(100_000_00);
const productBody = z.object({
  name: z.string().trim().min(1).max(80),
  category,
  sizeLabel: z.string().trim().max(24).default(''),
  priceMinor: money,
  listPriceMinor: money.nullable().optional(),
  imageUrl: z.string().url().startsWith('https://').max(500).nullable().optional(),
  slot: z.string().trim().max(16).nullable().optional(),
  active: z.boolean().optional(),
});

const adminRow = (p) => ({
  id: p.id, name: p.name, category: p.category, sizeLabel: p.size_label, priceMinor: p.price_minor,
  listPriceMinor: p.list_price_minor, imageUrl: p.image_url, slot: p.slot, active: !!p.active,
  stock: { onHand: p.quantity, reserved: p.reserved, available: p.quantity - p.reserved },
});
const SELECT_ADMIN = 'SELECT p.*, s.quantity, s.reserved FROM products p JOIN stock s ON s.product_id=p.id';

export function productRoutes({ db, config, authn }) {
  const r = Router();
  const staff = requireRole('staff');
  const admin = requireRole('admin');

  r.get('/machine', authn, (_req, res) => res.json({ id: config.machineId, status: getSetting(db, 'machine_status') }));

  // Staff: active products only. Sold-out items are listed (flagged) so the grid matches the design; no stock numbers are exposed.
  r.get('/products', authn, staff, (_req, res) => {
    const rows = db.prepare(`${SELECT_ADMIN} WHERE p.active=1 ORDER BY p.id`).all();
    res.json({
      machine: { id: config.machineId, status: getSetting(db, 'machine_status') },
      products: rows.map((p) => ({
        id: p.id, name: p.name, category: p.category, sizeLabel: p.size_label, price: p.price_minor,
        listPrice: p.list_price_minor && p.list_price_minor > p.price_minor ? p.list_price_minor : null,
        imageUrl: p.image_url, soldOut: p.quantity - p.reserved <= 0,
      })),
    });
  });

  r.post('/quote', authn, staff, ah(async (req, res) => {
    const { items, promoCode } = parse(z.object({ items: itemsSchema, promoCode: promoSchema }), req.body);
    res.json(quoteView(buildQuote(db, items, promoCode)));
  }));

  // ----- admin -----
  r.get('/admin/products', authn, admin, (_req, res) => res.json({ products: db.prepare(`${SELECT_ADMIN} ORDER BY p.id`).all().map(adminRow) }));

  r.post('/admin/products', authn, admin, (req, res) => {
    const b = parse(productBody.extend({ stock: z.number().int().min(0).max(1000).default(0) }), req.body);
    if (b.listPriceMinor != null && b.listPriceMinor < b.priceMinor) throw new HttpError(400, 'VALIDATION', 'Original price cannot be lower than the price');
    const id = db.transaction(() => {
      const info = db.prepare(`INSERT INTO products(name,category,size_label,price_minor,list_price_minor,image_url,slot,active) VALUES (?,?,?,?,?,?,?,?)`)
        .run(b.name, b.category, b.sizeLabel, b.priceMinor, b.listPriceMinor ?? null, b.imageUrl ?? null, b.slot ?? null, b.active === false ? 0 : 1);
      db.prepare('INSERT INTO stock(product_id, quantity) VALUES (?,?)').run(info.lastInsertRowid, b.stock);
      audit(db, req.user.username, 'PRODUCT_CREATED', info.lastInsertRowid, b);
      return Number(info.lastInsertRowid);
    })();
    res.status(201).json({ product: adminRow(db.prepare(`${SELECT_ADMIN} WHERE p.id=?`).get(id)) });
  });

  r.patch('/admin/products/:id', authn, admin, (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const cur = db.prepare('SELECT * FROM products WHERE id=?').get(id);
    if (!cur) throw new HttpError(404, 'NOT_FOUND', 'Product not found');
    const b = parse(productBody.partial(), req.body);
    const next = {
      name: b.name ?? cur.name, category: b.category ?? cur.category, size_label: b.sizeLabel ?? cur.size_label,
      price_minor: b.priceMinor ?? cur.price_minor,
      list_price_minor: b.listPriceMinor === undefined ? cur.list_price_minor : b.listPriceMinor,
      image_url: b.imageUrl === undefined ? cur.image_url : b.imageUrl,
      slot: b.slot === undefined ? cur.slot : b.slot, active: b.active === undefined ? cur.active : b.active ? 1 : 0,
    };
    if (next.list_price_minor != null && next.list_price_minor < next.price_minor) throw new HttpError(400, 'VALIDATION', 'Original price cannot be lower than the price');
    db.transaction(() => {
      db.prepare(`UPDATE products SET name=@name, category=@category, size_label=@size_label, price_minor=@price_minor, list_price_minor=@list_price_minor,
        image_url=@image_url, slot=@slot, active=@active, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=@id`).run({ ...next, id });
      audit(db, req.user.username, 'PRODUCT_UPDATED', id, b); // past orders keep their own price snapshot
    })();
    res.json({ product: adminRow(db.prepare(`${SELECT_ADMIN} WHERE p.id=?`).get(id)) });
  });

  // Sets the physical count in the machine (what an operator counted/refilled). Cannot go below units held for open orders.
  r.put('/admin/products/:id/stock', authn, admin, (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const { quantity, reason } = parse(z.object({ quantity: z.number().int().min(0).max(1000), reason: z.string().trim().max(120).optional() }), req.body);
    db.transaction(() => {
      const s = db.prepare('SELECT * FROM stock WHERE product_id=?').get(id);
      if (!s) throw new HttpError(404, 'NOT_FOUND', 'Product not found');
      if (quantity < s.reserved) throw new HttpError(409, 'BELOW_RESERVED', `${s.reserved} unit(s) are held for open orders; stock cannot go below that`);
      db.prepare('UPDATE stock SET quantity=? WHERE product_id=?').run(quantity, id);
      audit(db, req.user.username, 'STOCK_SET', id, { from: s.quantity, to: quantity, reason });
    })();
    res.json({ product: adminRow(db.prepare(`${SELECT_ADMIN} WHERE p.id=?`).get(id)) });
  });

  r.patch('/admin/machine', authn, admin, (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['ACTIVE', 'MAINTENANCE']) }), req.body);
    setSetting(db, 'machine_status', status);
    audit(db, req.user.username, 'MACHINE_STATUS', config.machineId, { status });
    res.json({ id: config.machineId, status });
  });

  return r;
}
