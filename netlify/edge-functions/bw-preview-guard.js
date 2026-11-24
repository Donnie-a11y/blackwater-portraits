// Access protection for the private booking preview. Fails closed.
// Production: the booking paths do not exist (404) until the owner and counsel approve.
// Any other context: HTTP Basic Auth against BW_PREVIEW_PASSWORD; no password set = no access.
// Stripe's webhook cannot send a password; it is allowed through to the function, which
// rejects anything without a valid Stripe signature.
export default async (request, context) => {
  const url = new URL(request.url);
  const ctx = context.deploy?.context || 'unknown';
  if (ctx === 'production') return new Response('Not found', { status: 404 });
  if (url.pathname === '/api/bw/stripe-webhook' && request.method === 'POST') return context.next();
  // Netlify stores only the SHA-256 of the preview password (BW_PREVIEW_PASSWORD_SHA256).
  const want = (Netlify.env.get('BW_PREVIEW_PASSWORD_SHA256') || '').toLowerCase();
  const h = request.headers.get('authorization') || '';
  let ok = false;
  if (/^[0-9a-f]{64}$/.test(want) && h.startsWith('Basic ')) {
    try {
      const [, p] = atob(h.slice(6)).split(/:(.*)/s);
      if ((p || '').length >= 12) ok = timingSafe(await sha256hex(p), want);
    } catch {}
  }
  if (!ok) return new Response('Private preview', { status: 401, headers: {
    'www-authenticate': 'Basic realm="Blackwater private preview", charset="UTF-8"', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
  const res = await context.next();
  const out = new Response(res.body, res);
  out.headers.set('x-robots-tag', 'noindex, nofollow');
  out.headers.set('cache-control', 'no-store');
  out.headers.set('referrer-policy', 'no-referrer');
  return out;
};
function timingSafe(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}
export const config = { path: ['/agreement', '/agreement/*', '/api/bw/*'] };
async function sha256hex(t) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
