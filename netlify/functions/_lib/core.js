// Blackwater commission agreement, signing and retainer booking: core logic.
// Pure functions over an injected store and fetch, so every rule is testable
// without Netlify or Stripe. SANDBOX ONLY: not deployed, not customer-facing.
import crypto from 'node:crypto';

export const RETAINER_CENTS = 29900;           // approved $299 retainer (Pricing Restructure s13 item 2)
export const RETAINER_CURRENCY = 'usd';
export const INVITE_TTL_DAYS = 14;
const COMMISSION_RE = /^BW-\d{4}-\d{3,4}$/;

// ---------- helpers ----------
export const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');   // 256-bit, unguessable
export const newId = (p) => p + '_' + crypto.randomBytes(12).toString('base64url');
export function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
// Canonical JSON: sorted keys, so the same record always hashes the same.
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export function normName(s) {
  return String(s || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
function validName(s) {
  const n = String(s || '').normalize('NFKC').trim();
  return n.length >= 3 && n.length <= 120 && /^\p{L}[\p{L}\p{M}'’. -]*\p{L}\.?$/u.test(n);
}
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')) && String(e).length <= 200;
const clean = (s, max = 500) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

export class HttpError extends Error { constructor(status, code, msg) { super(msg || code); this.status = status; this.code = code; } }
const fail = (status, code, msg) => { throw new HttpError(status, code, msg); };

// ---------- store layout ----------
// invites/<sha256(token)>          invite (token itself is never stored)
// records/<commission>/<inviteId>  signed record (one per invite, write-once)
// chain/<commission>               head of the per-commission hash chain
// checkout/<commission>            open Stripe Checkout session
// stripe-events/<eventId>          processed webhook events (dedupe)
// bookings/<commission>            VERIFIED booking (written only by webhook)
// audit/<ts>_<id>                  access log for admin reads

// ---------- invites (studio creates; admin only) ----------
export async function createInvite(store, { commissionId, role, signerName, signerEmail, agreementVersion, now = Date.now() }, versions) {
  if (!COMMISSION_RE.test(commissionId || '')) fail(400, 'bad_commission');
  if (!['primary', 'release'].includes(role)) fail(400, 'bad_role');
  if (!validName(signerName)) fail(400, 'bad_name');
  if (!emailOk(signerEmail)) fail(400, 'bad_email');
  if (!versions[agreementVersion]) fail(400, 'unknown_version');
  if (role === 'release') {
    const priv = await commissionIsPrivate(store, commissionId);
    if (priv) fail(409, 'private_commission', 'Never send a release link for a Private Commission.');
  }
  const token = newToken();
  const invite = {
    inviteId: newId('inv'), commissionId, role,
    signerName: clean(signerName, 120), signerEmail: clean(signerEmail, 200).toLowerCase(),
    agreementVersion, createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + INVITE_TTL_DAYS * 864e5).toISOString(), status: 'open',
  };
  await store.setJSON('invites/' + sha256(token), invite, { onlyIfNew: true });
  return { token, invite };
}

export async function revokeInvite(store, token) {
  const key = 'invites/' + sha256(token);
  const inv = await store.get(key, { type: 'json' });
  if (!inv) fail(404, 'not_found');
  inv.status = 'revoked';
  await store.setJSON(key, inv);
  return inv;
}

// Generic answer for every bad token: never reveals whether a commission exists.
export async function loadInvite(store, token, now = Date.now()) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail(404, 'invalid_link');
  const inv = await store.get('invites/' + sha256(token), { type: 'json' });
  if (!inv || inv.status === 'revoked') fail(404, 'invalid_link');
  if (Date.parse(inv.expiresAt) < now && inv.status === 'open') fail(410, 'expired_link');
  return inv;
}

async function commissionIsPrivate(store, commissionId) {
  const { blobs } = await store.list({ prefix: 'records/' + commissionId + '/' });
  for (const b of blobs) {
    const r = await store.get(b.key, { type: 'json' });
    if (r && r.body.role === 'primary' && r.body.imageUse === 'private') return true;
  }
  return false;
}

// What the signing page is allowed to see.
export function publicView(inv, versions) {
  const v = versions[inv.agreementVersion];
  return {
    commissionId: inv.commissionId, role: inv.role, signerName: inv.signerName,
    agreementVersion: inv.agreementVersion, agreementSha256: v.sha256, agreementText: v.text,
    retainer: inv.role === 'primary' ? { amountCents: RETAINER_CENTS, currency: RETAINER_CURRENCY } : null,
    status: inv.status, expiresAt: inv.expiresAt,
  };
}

// ---------- signing ----------
export function validateSubmission(inv, sub, versions) {
  const errs = [];
  const v = versions[inv.agreementVersion];
  if (sub.agreementVersion !== inv.agreementVersion || sub.agreementSha256 !== v.sha256) errs.push('agreement_changed');
  if (sub.consentElectronic !== true) errs.push('esign_consent_required');
  if (sub.confirmAdultTrue !== true) errs.push('adult_confirmation_required');
  if (!validName(sub.typedSignature)) errs.push('signature_required');
  else if (normName(sub.typedSignature) !== normName(inv.signerName)) errs.push('signature_name_mismatch');
  if (sub.phone && !/^[0-9+().\- ]{7,25}$/.test(sub.phone)) errs.push('bad_phone');

  const isPrimary = inv.role === 'primary';
  let imageUse = 'release_only';
  if (isPrimary) {
    if (!['standard', 'private'].includes(sub.imageUse)) errs.push('image_use_choice_required');
    imageUse = sub.imageUse;
  }
  const subjects = Array.isArray(sub.subjects) ? sub.subjects.slice(0, 40) : [];
  if (isPrimary && subjects.length === 0) errs.push('subjects_required');
  const signer = normName(inv.signerName);
  const out = subjects.map((s, i) => {
    const type = s.type;
    const row = { subject: clean(s.subject, 120), type, authority: s.authority, release: s.release === 'yes' ? 'yes' : 'no', signedBy: clean(s.signedBy, 120), limits: clean(s.limits, 300) };
    if (!row.subject) errs.push(`row${i}:subject_required`);
    if (!['adult', 'minor', 'animal'].includes(type)) errs.push(`row${i}:bad_type`);
    if (type === 'adult') {
      // Each adult signs only for themselves, and only through their own invite.
      if (normName(row.subject) !== signer) { row.release = 'no'; row.signedBy = ''; row.authority = 'pending_own_link'; }
      else { row.authority = 'self'; row.signedBy = inv.signerName; }
    } else if (type === 'minor') {
      if (!['parent', 'legal_guardian'].includes(row.authority)) errs.push(`row${i}:minor_needs_parent_or_guardian`);
      if (normName(row.signedBy) !== signer) errs.push(`row${i}:minor_must_be_signed_by_this_signer`);
      if (normName(row.subject) === signer) errs.push(`row${i}:child_cannot_sign_for_self`);
    } else if (type === 'animal') {
      if (!['owner', 'owner_authorized'].includes(row.authority)) errs.push(`row${i}:animal_needs_owner`);
      if (normName(row.signedBy) !== signer) errs.push(`row${i}:animal_must_be_signed_by_this_signer`);
    }
    if (imageUse === 'private') row.release = 'no';
    return row;
  });
  if (errs.length) throw Object.assign(new HttpError(422, 'validation_failed'), { details: errs });
  return { imageUse, subjects: out, exceptions: clean(sub.exceptions, 1000), phone: clean(sub.phone, 25) };
}

export async function sign(store, token, sub, meta, versions, now = Date.now()) {
  const inv = await loadInvite(store, token, now);
  const recKey = `records/${inv.commissionId}/${inv.inviteId}`;
  const existing = await store.get(recKey, { type: 'json' });
  if (existing) return { record: existing, duplicate: true };           // double tap / retry: one record
  if (inv.status !== 'open') fail(409, 'already_signed');
  if (inv.role === 'release' && await commissionIsPrivate(store, inv.commissionId)) fail(409, 'private_commission');

  const v = validateSubmission(inv, sub, versions);
  const body = {
    recordId: newId('rec'), commissionId: inv.commissionId, inviteId: inv.inviteId, role: inv.role,
    agreementVersion: inv.agreementVersion, agreementSha256: versions[inv.agreementVersion].sha256,
    signerName: inv.signerName, signerEmail: inv.signerEmail, phone: v.phone,
    typedSignature: clean(sub.typedSignature, 120), consentElectronic: true, confirmAdultTrue: true,
    imageUse: v.imageUse, subjects: v.subjects, exceptions: v.exceptions,
    signedAt: new Date(now).toISOString(), clientTimeZone: clean(meta.timeZone, 64),
    userAgent: clean(meta.userAgent, 300), ipHash: meta.ip ? sha256('bw-ip:' + meta.ip) : '',
  };
  // Append to the per-commission hash chain (optimistic concurrency on the head).
  for (let attempt = 0; attempt < 5; attempt++) {
    const head = await store.getWithMetadata('chain/' + inv.commissionId, { type: 'json' });
    const prevHash = head?.data?.hash || 'GENESIS';
    const seq = (head?.data?.seq || 0) + 1;
    const recordHash = sha256(prevHash + '\n' + canonical({ ...body, seq }));
    const record = { body: { ...body, seq }, prevHash, hash: recordHash };
    const w = await store.setJSON(recKey, record, { onlyIfNew: true });
    if (w && w.modified === false) return { record: await store.get(recKey, { type: 'json' }), duplicate: true };
    const cas = head ? { onlyIfMatch: head.etag } : { onlyIfNew: true };
    const hw = await store.setJSON('chain/' + inv.commissionId, { hash: recordHash, seq, recordKey: recKey }, cas);
    if (hw && hw.modified === false) { await store.delete(recKey); continue; }   // lost the race: retry on new head
    await store.setJSON('invites/' + sha256(token), { ...inv, status: 'signed', signedAt: body.signedAt, recordId: body.recordId });
    return { record, duplicate: false };
  }
  fail(503, 'busy_retry');
}

// Recompute every hash for a commission. Any edit, deletion or reorder breaks it.
export async function verifyChain(store, commissionId) {
  const { blobs } = await store.list({ prefix: `records/${commissionId}/` });
  const recs = [];
  for (const b of blobs) recs.push(await store.get(b.key, { type: 'json' }));
  recs.sort((a, b) => a.body.seq - b.body.seq);
  let prev = 'GENESIS', problems = [];
  recs.forEach((r, i) => {
    if (r.body.seq !== i + 1) problems.push(`gap_or_reorder_at_${i + 1}`);
    if (r.prevHash !== prev) problems.push(`prev_mismatch_seq_${r.body.seq}`);
    if (sha256(r.prevHash + '\n' + canonical(r.body)) !== r.hash) problems.push(`tampered_seq_${r.body.seq}`);
    prev = r.hash;
  });
  const head = await store.get('chain/' + commissionId, { type: 'json' });
  if (recs.length && (!head || head.hash !== prev || head.seq !== recs.length)) problems.push('head_mismatch_or_record_missing');
  return { commissionId, records: recs.length, ok: problems.length === 0, problems };
}

// ---------- retainer checkout ----------
export async function startCheckout(store, token, env, fetchImpl, now = Date.now()) {
  const inv = await loadInvite(store, token, now);
  if (inv.role !== 'primary') fail(403, 'release_only_link');
  const rec = await store.get(`records/${inv.commissionId}/${inv.inviteId}`, { type: 'json' });
  if (!rec) fail(409, 'agreement_not_signed');
  if (await store.get('bookings/' + inv.commissionId, { type: 'json' })) fail(409, 'already_booked');
  const key = env.STRIPE_SECRET_KEY || '';
  if (!key.startsWith('sk_test_') && env.BW_ALLOW_LIVE_PAYMENTS !== 'yes') fail(503, 'live_payments_not_authorized');

  const open = await store.get('checkout/' + inv.commissionId, { type: 'json' });
  if (open && Date.parse(open.expiresAt) > now + 60e3) return { url: open.url, reused: true };

  const site = env.BW_SITE_URL;
  const form = new URLSearchParams({
    mode: 'payment', client_reference_id: inv.commissionId, customer_email: inv.signerEmail,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': RETAINER_CURRENCY,
    'line_items[0][price_data][unit_amount]': String(RETAINER_CENTS),
    'line_items[0][price_data][product_data][name]': `Portrait commission retainer ${inv.commissionId}`,
    'metadata[commission_id]': inv.commissionId, 'metadata[invite_id]': inv.inviteId,
    'metadata[record_id]': rec.body.recordId, 'metadata[agreement_version]': rec.body.agreementVersion,
    'payment_intent_data[metadata][commission_id]': inv.commissionId,
    success_url: `${site}/agreement/?t=${token}&paid=pending`,
    cancel_url: `${site}/agreement/?t=${token}&paid=cancelled`,
    expires_at: String(Math.floor(now / 1000) + 1800),
  });
  const r = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `bw-retainer-${inv.commissionId}-${Math.floor(now / 1800e3)}` },
    body: form.toString(),
  });
  const s = await r.json();
  if (!r.ok) fail(502, 'stripe_error', s?.error?.message);
  await store.setJSON('checkout/' + inv.commissionId, { sessionId: s.id, url: s.url, expiresAt: new Date(s.expires_at * 1000).toISOString() });
  return { url: s.url, reused: false };
}

// ---------- Stripe webhook: the ONLY path that confirms a booking ----------
export function verifyStripeSignature(rawBody, header, secret, nowSec = Math.floor(Date.now() / 1000), tolerance = 300) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')).filter(p => p.length === 2).map(([k, v]) => [k, v]).reverse());
  const t = Number(parts.t);
  const sigs = header.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!t || !sigs.length || Math.abs(nowSec - t) > tolerance) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  return sigs.some(s => safeEqual(s, expected));
}

export async function handleStripeEvent(store, rawBody, header, env, nowSec) {
  if (!verifyStripeSignature(rawBody, header, env.STRIPE_WEBHOOK_SECRET, nowSec)) fail(400, 'bad_signature');
  const evt = JSON.parse(rawBody);
  if (await store.get('stripe-events/' + evt.id, { type: 'json' })) return { ignored: 'duplicate_event' };
  const result = await applyStripeEvent(store, evt, env);
  await store.setJSON('stripe-events/' + evt.id, { type: evt.type, at: new Date().toISOString(), result }, { onlyIfNew: true });
  return result;
}

async function applyStripeEvent(store, evt, env) {
  const expectLive = (env.STRIPE_SECRET_KEY || '').startsWith('sk_live_');
  if (evt.livemode !== expectLive) return { ignored: 'mode_mismatch' };
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(evt.type)) return { ignored: 'event_type' };
  const s = evt.data.object;
  const cid = s.client_reference_id;
  if (!COMMISSION_RE.test(cid || '') || s.metadata?.commission_id !== cid) return { ignored: 'no_commission' };
  if (s.payment_status !== 'paid') return { ignored: 'not_paid_yet' };
  if (s.amount_total !== RETAINER_CENTS || s.currency !== RETAINER_CURRENCY) return { ignored: 'amount_mismatch', alert: true };
  const rec = await store.get(`records/${cid}/${s.metadata.invite_id}`, { type: 'json' });
  if (!rec || rec.body.recordId !== s.metadata.record_id) return { ignored: 'record_mismatch', alert: true };
  const booking = {
    commissionId: cid, status: 'RETAINER_PAID_VERIFIED', recordId: rec.body.recordId,
    stripeSessionId: s.id, paymentIntent: s.payment_intent, amountCents: s.amount_total, currency: s.currency,
    livemode: evt.livemode, verifiedAt: new Date().toISOString(), eventId: evt.id,
    note: 'Date still confirmed by the studio, as today.',
  };
  const w = await store.setJSON('bookings/' + cid, booking, { onlyIfNew: true });
  if (w && w.modified === false) return { ignored: 'already_booked', alert: true };   // second payment: refund by hand
  return { booked: cid };
}

export async function bookingStatus(store, token, now = Date.now()) {
  const inv = await loadInvite(store, token, now);
  const rec = await store.get(`records/${inv.commissionId}/${inv.inviteId}`, { type: 'json' });
  const b = inv.role === 'primary' ? await store.get('bookings/' + inv.commissionId, { type: 'json' }) : null;
  return {
    signed: !!rec, recordId: rec?.body.recordId || null,
    booking: b ? 'RETAINER_PAID_VERIFIED' : (inv.role === 'primary' ? 'AWAITING_VERIFIED_PAYMENT' : 'NOT_APPLICABLE'),
  };
}

// ---------- admin search, retrieval, export ----------
export async function search(store, q) {
  const needle = normName(q);
  if (needle.length < 2) fail(400, 'query_too_short');
  const { blobs } = await store.list({ prefix: 'records/' });
  const hits = [];
  for (const b of blobs) {
    const r = await store.get(b.key, { type: 'json' });
    const hay = [r.body.commissionId, r.body.signerName, r.body.signerEmail, r.body.signedAt.slice(0, 4), ...r.body.subjects.map(s => s.subject)].map(normName).join(' | ');
    if (hay.includes(needle)) hits.push(r);
  }
  return hits.sort((a, b) => a.body.signedAt.localeCompare(b.body.signedAt));
}

export async function exportAll(store) {
  const out = {};
  for (const prefix of ['records/', 'chain/', 'bookings/']) {
    const { blobs } = await store.list({ prefix });
    for (const b of blobs) out[b.key] = await store.get(b.key, { type: 'json' });
  }
  const commissions = [...new Set(Object.keys(out).filter(k => k.startsWith('chain/')).map(k => k.slice(6)))];
  const verification = [];
  for (const c of commissions) verification.push(await verifyChain(store, c));
  const payload = canonical(out);
  return { exportedAt: new Date().toISOString(), sha256: sha256(payload), verification, data: out };
}

export async function audit(store, who, action, detail) {
  await store.setJSON(`audit/${new Date().toISOString()}_${newId('a')}`, { who, action, detail });
}

export function requireAdmin(req, env) {
  const h = req.headers.get('authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!env.BW_ADMIN_TOKEN || env.BW_ADMIN_TOKEN.length < 32 || !safeEqual(tok, env.BW_ADMIN_TOKEN)) fail(401, 'unauthorized');
  return 'admin';
}

// Agreement versions: exact text + fingerprint. A record's sha256 can be recomputed from this.
export function loadVersions(entries) {
  const out = {};
  for (const [id, text] of Object.entries(entries)) out[id] = { text, sha256: sha256(text) };
  return out;
}
