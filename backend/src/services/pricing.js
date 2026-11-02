import { HttpError } from '../errors.js';

/** Merge duplicate product lines so one product appears once. */
export function mergeItems(items) {
  const map = new Map();
  for (const it of items) map.set(it.productId, (map.get(it.productId) ?? 0) + it.quantity);
  return [...map].map(([productId, quantity]) => ({ productId, quantity }));
}

/**
 * The ONLY place totals are computed. The client never sends a price.
 * subtotal uses the list (pre-offer) price, matching the receipt layout:
 *   subtotal - product offers - promo = total
 */
export function buildQuote(db, rawItems, promoCode) {
  const items = mergeItems(rawItems);
  const get = db.prepare(
    `SELECT p.*, s.quantity AS on_hand, s.reserved FROM products p JOIN stock s ON s.product_id = p.id WHERE p.id = ?`,
  );
  const lines = [];
  let subtotal = 0;
  let offers = 0;
  for (const it of items) {
    const p = get.get(it.productId);
    if (!p || !p.active) throw new HttpError(404, 'PRODUCT_UNAVAILABLE', 'A selected item is no longer available', { productId: it.productId });
    if (p.on_hand - p.reserved < it.quantity) {
      throw new HttpError(409, 'OUT_OF_STOCK', `${p.name} is not available in that quantity`, { productId: p.id });
    }
    const list = p.list_price_minor ?? p.price_minor;
    lines.push({ product: p, quantity: it.quantity, unit: p.price_minor, list });
    subtotal += list * it.quantity;
    offers += (list - p.price_minor) * it.quantity;
  }
  const afterOffers = subtotal - offers;
  let promo = null;
  let discount = 0;
  if (promoCode) {
    const row = db.prepare('SELECT * FROM promo_codes WHERE code = ? AND active = 1').get(promoCode.trim().toUpperCase());
    if (!row) throw new HttpError(422, 'INVALID_PROMO', 'That promo code is not valid');
    discount = row.amount_off_minor != null ? Math.min(row.amount_off_minor, afterOffers) : Math.floor((afterOffers * row.percent_off) / 100);
    promo = row.code;
  }
  const total = afterOffers - discount;
  if (total <= 0) throw new HttpError(422, 'INVALID_TOTAL', 'Order total must be greater than zero');
  return { lines, subtotal, offers, promo, discount, total, currency: 'ETB' };
}

export const quoteView = (q) => ({
  items: q.lines.map((l) => ({
    productId: l.product.id, category: l.product.category, name: l.product.name, sizeLabel: l.product.size_label,
    unitPrice: l.unit, listPrice: l.list, quantity: l.quantity,
  })),
  subtotal: q.subtotal, offerSavings: q.offers, promoCode: q.promo, promoDiscount: q.discount, total: q.total, currency: q.currency,
});
