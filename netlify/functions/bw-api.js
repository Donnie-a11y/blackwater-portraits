// Single router for the commission signing and booking API. SANDBOX ONLY.
import { getStore } from '@netlify/blobs';
import fs from 'node:fs';
import path from 'node:path';
import * as C from './_lib/core.js';

const VERSION_DIR = [path.resolve('netlify/functions/_lib/versions'), path.join(path.dirname(new URL(import.meta.url).pathname), '_lib', 'versions')]
  .find(d => { try { return fs.readdirSync(d).length > 0; } catch { return false; } });
const versions = C.loadVersions(Object.fromEntries(
  fs.readdirSync(VERSION_DIR).filter(f => f.endsWith('.txt')).map(f => [f.slice(0, -4), fs.readFileSync(path.join(VERSION_DIR, f), 'utf8')])));

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: {
  'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' } });

export default async (req) => {
  const env = { ...process.env, BW_SITE_URL: process.env.BW_SITE_URL || process.env.DEPLOY_PRIME_URL || process.env.URL };
  if (env.BW_SIGNING_ENABLED !== 'yes') return json(404, { error: 'not_found' });   // off until owner + counsel approve
  const store = getStore({ name: 'bw-commissions', consistency: 'strong' });
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/bw\/?/, '');
  try {
    if (route === 'stripe-webhook' && req.method === 'POST') {
      return json(200, await C.handleStripeEvent(store, await req.text(), req.headers.get('stripe-signature'), env));
    }
    if (route === 'invite' && req.method === 'GET') {
      return json(200, C.publicView(await C.loadInvite(store, url.searchParams.get('t')), versions));
    }
    if (route === 'sign' && req.method === 'POST') {
      const b = await req.json().catch(() => null);
      if (!b || typeof b !== 'object') return json(400, { error: 'bad_request' });
      if (b.website) return json(400, { error: 'rejected' });                          // honeypot
      const { record, duplicate } = await C.sign(store, b.t, b, {
        userAgent: req.headers.get('user-agent'), timeZone: b.timeZone, ip: req.headers.get('x-nf-client-connection-ip') }, versions);
      return json(200, { recordId: record.body.recordId, signedAt: record.body.signedAt, duplicate, receipt: record.body });
    }
    if (route === 'checkout' && req.method === 'POST') {
      const b = await req.json();
      return json(200, await C.startCheckout(store, b.t, env, fetch));
    }
    if (route === 'status' && req.method === 'GET') {
      return json(200, await C.bookingStatus(store, url.searchParams.get('t')));
    }
    // ----- admin (bearer token) -----
    if (route.startsWith('admin/')) {
      const who = C.requireAdmin(req, env);
      const a = route.slice(6);
      if (a === 'invite' && req.method === 'POST') {
        const b = await req.json();
        const { token, invite } = await C.createInvite(store, b, versions);
        await C.audit(store, who, 'create_invite', { commissionId: invite.commissionId, inviteId: invite.inviteId });
        return json(200, { link: `${env.BW_SITE_URL}/agreement/?t=${token}`, invite });
      }
      if (a === 'revoke' && req.method === 'POST') { const r = await C.revokeInvite(store, (await req.json()).t); await C.audit(store, who, 'revoke', { inviteId: r.inviteId }); return json(200, r); }
      if (a === 'search') { await C.audit(store, who, 'search', { q: url.searchParams.get('q') }); return json(200, await C.search(store, url.searchParams.get('q'))); }
      if (a === 'verify') await C.audit(store, who, 'verify', { c: url.searchParams.get('c') });
      if (a === 'verify') return json(200, await C.verifyChain(store, url.searchParams.get('c')));
      if (a === 'export') { await C.audit(store, who, 'export', {}); return json(200, await C.exportAll(store)); }
    }
    return json(404, { error: 'not_found' });
  } catch (e) {
    if (e instanceof C.HttpError) return json(e.status, { error: e.code, details: e.details });
    console.error(e);
    return json(500, { error: 'server_error' });
  }
};

export const config = { path: '/api/bw/*' };
