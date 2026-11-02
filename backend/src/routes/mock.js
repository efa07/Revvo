import { Router } from 'express';

const page = (body) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock payment</title>
<body style="font-family:sans-serif;max-width:420px;margin:40px auto;padding:0 16px">${body}</body>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** SIMULATOR ONLY: stands in for the provider's hosted checkout page. Mounted only when PAYMENT_PROVIDER=mock. */
export function mockRoutes({ provider }) {
  const r = Router();
  r.get('/mock/pay/:txnId', (req, res) => {
    const t = provider.get(req.params.txnId);
    if (!t) return res.status(404).send(page('<h2>Unknown payment</h2>'));
    const id = esc(encodeURIComponent(req.params.txnId));
    res.send(page(`<h2>Mock checkout</h2><p>${esc(req.params.txnId)}<br><b>ETB ${(t.amountMinor / 100).toFixed(2)}</b> (${esc(t.status)})</p>
      ${['approve', 'decline', 'cancel'].map((a) => `<form method="post" action="/mock/pay/${id}/${a}"><button style="width:100%;padding:14px;margin:6px 0;font-size:16px">${a}</button></form>`).join('')}`));
  });
  r.post('/mock/pay/:txnId/:action', async (req, res) => {
    const map = { approve: 'SUCCEEDED', decline: 'FAILED', cancel: 'CANCELLED' };
    const status = map[req.params.action];
    if (!status || !provider.get(req.params.txnId)) return res.status(404).send(page('<h2>Not found</h2>'));
    await provider.emit(req.params.txnId, status);
    res.send(page(`<h2>Done: ${esc(req.params.action)}</h2><p>Return to the kiosk screen.</p>`));
  });
  return r;
}

/** Where the provider sends the customer's phone after checkout. Informational only: it never decides an outcome. */
export function returnRoutes() {
  const r = Router();
  r.get('/pay/return/:result', (req, res) =>
    res.send(page('<h2>You can return to the kiosk</h2><p>The machine confirms your payment automatically.</p>')));
  return r;
}
