// Fictional clients, Stripe TEST-mode signatures, in-memory store with Netlify Blobs semantics.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as C from '../netlify/functions/_lib/core.js';

class MemStore {
  constructor() { this.m = new Map(); this.n = 0; }
  async get(k) { const v = this.m.get(k); return v ? structuredClone(v.data) : null; }
  async getWithMetadata(k) { const v = this.m.get(k); return v ? { data: structuredClone(v.data), etag: v.etag } : null; }
  async setJSON(k, data, o = {}) {
    const cur = this.m.get(k);
    if (o.onlyIfNew && cur) return { modified: false };
    if (o.onlyIfMatch && (!cur || cur.etag !== o.onlyIfMatch)) return { modified: false };
    this.m.set(k, { data: structuredClone(data), etag: 'e' + (++this.n) }); return { modified: true };
  }
  async delete(k) { this.m.delete(k); }
  async list({ prefix }) { return { blobs: [...this.m.keys()].filter(k => k.startsWith(prefix)).sort().map(key => ({ key })) }; }
}
const versions = C.loadVersions({ 'BW-PCA-1.0-DRAFT': 'Fixture agreement text.' });
const V = versions['BW-PCA-1.0-DRAFT'];
const ENV = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_test', BW_SITE_URL: 'https://preview.example' };
const meta = { userAgent: 'test', timeZone: 'America/New_York', ip: '203.0.113.9' };
const base = (name, extra = {}) => ({ agreementVersion: 'BW-PCA-1.0-DRAFT', agreementSha256: V.sha256, consentElectronic: true, confirmAdultTrue: true, typedSignature: name, ...extra });
const invite = (s, o) => C.createInvite(s, { agreementVersion: 'BW-PCA-1.0-DRAFT', ...o }, versions);
const family = (signer) => [
  { subject: signer, type: 'adult', release: 'yes' },
  { subject: 'Jordan Testerly', type: 'adult', release: 'yes', signedBy: signer },   // absent adult
  { subject: 'Mia Testerly', type: 'minor', authority: 'parent', release: 'yes', signedBy: signer },
  { subject: 'Biscuit', type: 'animal', authority: 'owner', release: 'yes', signedBy: signer },
];
function stripeSig(body, secret = 'whsec_test', t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=` + crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
}
function paidEvent(cid, rec, o = {}) {
  return JSON.stringify({ id: o.id || 'evt_' + crypto.randomUUID(), type: 'checkout.session.completed', livemode: false,
    data: { object: { id: 'cs_test_1', client_reference_id: cid, payment_status: o.status || 'paid', amount_total: o.amount ?? 29900, currency: 'usd', payment_intent: 'pi_test_1',
      metadata: { commission_id: cid, invite_id: rec.body.inviteId, record_id: rec.body.recordId } } } });
}
const fakeStripe = () => { const calls = []; const f = async (u, init) => { calls.push(init); return { ok: true, json: async () => ({ id: 'cs_test_' + calls.length, url: 'https://checkout.stripe.com/c/pay/cs_test_' + calls.length, expires_at: Math.floor(Date.now() / 1000) + 1800 }) }; }; f.calls = calls; return f; };

test('tokens are 256-bit random, stored only as hashes, commission numbers never open records', async () => {
  const s = new MemStore();
  const { token } = await invite(s, { commissionId: 'BW-2027-014', role: 'primary', signerName: 'Avery Testerly', signerEmail: 'avery@example.test' });
  assert.equal(token.length, 43);
  assert.ok(![...s.m.keys()].some(k => k.includes(token)));
  assert.ok(![...s.m.values()].some(v => JSON.stringify(v.data).includes(token)));
  for (const bad of ['BW-2027-014', 'x'.repeat(43), '', null, token.slice(0, -1) + (token.at(-1) === 'A' ? 'B' : 'A')])
    await assert.rejects(C.loadInvite(s, bad), e => e.code === 'invalid_link' && e.status === 404);
});

test('expired and revoked links are refused', async () => {
  const s = new MemStore();
  const old = Date.now() - 15 * 864e5;
  const { token } = await C.createInvite(s, { commissionId: 'BW-2027-015', role: 'primary', signerName: 'Avery Testerly', signerEmail: 'a@example.test', agreementVersion: 'BW-PCA-1.0-DRAFT', now: old }, versions);
  await assert.rejects(C.loadInvite(s, token), e => e.code === 'expired_link');
  const b = await invite(s, { commissionId: 'BW-2027-016', role: 'primary', signerName: 'Avery Testerly', signerEmail: 'a@example.test' });
  await C.revokeInvite(s, b.token);
  await assert.rejects(C.loadInvite(s, b.token), e => e.code === 'invalid_link');
});

test('full family: adult self-signs, absent adult recorded No pending own link, child by parent, dog by owner', async () => {
  const s = new MemStore();
  const { token } = await invite(s, { commissionId: 'BW-2027-020', role: 'primary', signerName: 'Avery Testerly', signerEmail: 'avery@example.test' });
  const { record } = await C.sign(s, token, base('Avery Testerly', { imageUse: 'standard', subjects: family('Avery Testerly'), phone: '740-555-0100' }), meta, versions);
  const by = Object.fromEntries(record.body.subjects.map(r => [r.subject, r]));
  assert.equal(by['Avery Testerly'].release, 'yes'); assert.equal(by['Avery Testerly'].authority, 'self');
  assert.equal(by['Jordan Testerly'].release, 'no'); assert.equal(by['Jordan Testerly'].authority, 'pending_own_link');
  assert.equal(by['Mia Testerly'].release, 'yes'); assert.equal(by['Biscuit'].release, 'yes');
  assert.equal(record.body.agreementSha256, V.sha256); assert.match(record.body.signedAt, /T/);
  assert.equal(record.body.clientTimeZone, 'America/New_York'); assert.ok(!JSON.stringify(record).includes('203.0.113.9'));
});

test('second adult signs by own link under same commission; chain stays valid', async () => {
  const s = new MemStore();
  const p = await invite(s, { commissionId: 'BW-2027-021', role: 'primary', signerName: 'Avery Testerly', signerEmail: 'avery@example.test' });
  await C.sign(s, p.token, base('Avery Testerly', { imageUse: 'standard', subjects: family('Avery Testerly') }), meta, versions);
  const r = await invite(s, { commissionId: 'BW-2027-021', role: 'release', signerName: 'Jordan Testerly', signerEmail: 'jordan@example.test' });
  const { record } = await C.sign(s, r.token, base('Jordan Testerly', { subjects: [{ subject: 'Jordan Testerly', type: 'adult', release: 'yes' }] }), meta, versions);
  assert.equal(record.body.role, 'release'); assert.equal(record.body.seq, 2); assert.equal(record.body.subjects[0].release, 'yes');
  assert.deepEqual((await C.verifyChain(s, 'BW-2027-021')).ok, true);
  await assert.rejects(C.startCheckout(s, r.token, ENV, fakeStripe()), e => e.code === 'release_only_link');
});

test('private commission: every row No, release links refused', async () => {
  const s = new MemStore();
  const p = await invite(s, { commissionId: 'BW-2027-022', role: 'primary', signerName: 'Avery Testerly', signerEmail: 'avery@example.test' });
  const { record } = await C.sign(s, p.token, base('Avery Testerly', { imageUse: 'private', subjects: family('Avery Testerly') }), meta, versions);
  assert.ok(record.body.subjects.every(r => r.release === 'no'));
  await assert.rejects(invite(s, { commissionId: 'BW-2027-022', role: 'release', signerName: 'Jordan Testerly', signerEmail: 'j@example.test' }), e => e.code === 'private_commission');
});

test('signature failures and incomplete agreements store nothing', async () => {
  const cases = [
    ['missing signature', base('', { imageUse: 'standard', subjects: family('Avery Testerly') }), 'signature_required'],
    ['someone else typed', base('Jordan Testerly', { imageUse: 'standard', subjects: family('Avery Testerly') }), 'signature_name_mismatch'],
    ['no e-sign consent', base('Avery Testerly', { consentElectronic: false, imageUse: 'standard', subjects: family('Avery Testerly') }), 'esign_consent_required'],
    ['no 18+ confirm', base('Avery Testerly', { confirmAdultTrue: false, imageUse: 'standard', subjects: family('Avery Testerly') }), 'adult_confirmation_required'],
    ['no image choice', base('Avery Testerly', { subjects: family('Avery Testerly') }), 'image_use_choice_required'],
    ['no subjects', base('Avery Testerly', { imageUse: 'standard', subjects: [] }), 'subjects_required'],
    ['child without parent', base('Avery Testerly', { imageUse: 'standard', subjects: [{ subject: 'Mia T', type: 'minor', release: 'yes', signedBy: 'Avery Testerly' }] }), 'row0:minor_needs_parent_or_guardian'],
    ['child signed by other', base('Avery Testerly', { imageUse: 'standard', subjects: [{ subject: 'Mia T', type: 'minor', authority: 'parent', release: 'yes', signedBy: 'Jordan Testerly' }] }), 'row0:minor_must_be_signed_by_this_signer'],
    ['agreement text changed', base('Avery Testerly', { agreementSha256: 'deadbeef', imageUse: 'standard', subjects: family('Avery Testerly') }), 'agreement_changed'],
    ['symbols as signature', base('###', { imageUse: 'standard', subjects: family('Avery Testerly') }), 'signature_required'],
  ];
  for (const [name, sub, code] of cases) {
    const s = new MemStore();
    const { token } = await invite(s, { commissionId: 'BW-2027-030', role: 'primary', signerName: 'Avery Testerly', signerEmail: 'a@example.test' });
    await assert.rejects(C.sign(s, token, sub, meta, versions), e => (e.details || []).includes(code), name);
    assert.equal((await s.list({ prefix: 'records/' })).blobs.length, 0, name);
    assert.equal((await C.loadInvite(s, token)).status, 'open', name);
  }
});

test('accented names match; double tap and retries make exactly one record', async () => {
  const s = new MemStore();
  const { token } = await invite(s, { commissionId: 'BW-2027-031', role: 'primary', signerName: 'Zoë Ruíz-Testerly', signerEmail: 'z@example.test' });
  const sub = base('  zoë   ruíz-testerly ', { imageUse: 'standard', subjects: [{ subject: 'Zoë Ruíz-Testerly', type: 'adult', release: 'yes' }] });
  const res = await Promise.all([1, 2, 3].map(() => C.sign(s, token, sub, meta, versions)));
  assert.equal(new Set(res.map(r => r.record.body.recordId)).size, 1);
  assert.equal((await s.list({ prefix: 'records/' })).blobs.length, 1);
  const again = await C.sign(s, token, sub, meta, versions);
  assert.equal(again.duplicate, true);
  assert.ok((await C.verifyChain(s, 'BW-2027-031')).ok);
});

test('tampering, deleting or reordering a record is detected', async () => {
  const s = new MemStore();
  const p = await invite(s, { commissionId: 'BW-2027-032', role: 'primary', signerName: 'Avery Testerly', signerEmail: 'a@example.test' });
  await C.sign(s, p.token, base('Avery Testerly', { imageUse: 'standard', subjects: family('Avery Testerly') }), meta, versions);
  const r = await invite(s, { commissionId: 'BW-2027-032', role: 'release', signerName: 'Jordan Testerly', signerEmail: 'j@example.test' });
  await C.sign(s, r.token, base('Jordan Testerly', { subjects: [{ subject: 'Jordan Testerly', type: 'adult', release: 'no' }] }), meta, versions);
  const keys = (await s.list({ prefix: 'records/BW-2027-032/' })).blobs.map(b => b.key);
  const k = keys.find(k => s.m.get(k).data.body.role === 'release');
  const orig = structuredClone(s.m.get(k).data);
  s.m.get(k).data.body.subjects[0].release = 'yes';
  assert.ok((await C.verifyChain(s, 'BW-2027-032')).problems.some(p => p.startsWith('tampered')));
  s.m.get(k).data = orig; assert.ok((await C.verifyChain(s, 'BW-2027-032')).ok);
  s.m.delete(k); assert.ok(!(await C.verifyChain(s, 'BW-2027-032')).ok);
});

test('checkout requires signed agreement, test key, and reuses one open session', async () => {
  const s = new MemStore(); const f = fakeStripe();
  const { token } = await invite(s, { commissionId: 'BW-2027-040', role: 'primary', signerName: 'Avery Testerly', signerEmail: 'a@example.test' });
  await assert.rejects(C.startCheckout(s, token, ENV, f), e => e.code === 'agreement_not_signed');
  await C.sign(s, token, base('Avery Testerly', { imageUse: 'standard', subjects: family('Avery Testerly') }), meta, versions);
  await assert.rejects(C.startCheckout(s, token, { ...ENV, STRIPE_SECRET_KEY: 'sk_live_x' }, f), e => e.code === 'live_payments_not_authorized');
  const a = await C.startCheckout(s, token, ENV, f); const b = await C.startCheckout(s, token, ENV, f);
  assert.equal(f.calls.length, 1); assert.equal(a.url, b.url); assert.equal(b.reused, true);
  const body = new URLSearchParams(f.calls[0].body);
  assert.equal(body.get('client_reference_id'), 'BW-2027-040'); assert.equal(body.get('line_items[0][price_data][unit_amount]'), '29900');
  assert.ok(f.calls[0].headers['Idempotency-Key']);
  const st = await C.bookingStatus(s, token); assert.equal(st.booking, 'AWAITING_VERIFIED_PAYMENT');   // opening checkout confirms nothing
});

test('webhook: only a valid signed, paid, correct-amount event books; duplicates and forgeries do not', async () => {
  const s = new MemStore();
  const { token } = await invite(s, { commissionId: 'BW-2027-041', role: 'primary', signerName: 'Avery Testerly', signerEmail: 'a@example.test' });
  const { record } = await C.sign(s, token, base('Avery Testerly', { imageUse: 'standard', subjects: family('Avery Testerly') }), meta, versions);
  const now = Math.floor(Date.now() / 1000);
  // forged / wrong secret / stale timestamp
  const ev = paidEvent('BW-2027-041', record);
  await assert.rejects(C.handleStripeEvent(s, ev, stripeSig(ev, 'whsec_wrong'), ENV, now), e => e.code === 'bad_signature');
  await assert.rejects(C.handleStripeEvent(s, ev, stripeSig(ev, 'whsec_test', now - 600), ENV, now), e => e.code === 'bad_signature');
  await assert.rejects(C.handleStripeEvent(s, ev, '', ENV, now), e => e.code === 'bad_signature');
  const tampered = ev.replace('29900', '100');
  await assert.rejects(C.handleStripeEvent(s, tampered, stripeSig(ev), ENV, now), e => e.code === 'bad_signature');
  // failed / unpaid / wrong amount
  const unpaid = paidEvent('BW-2027-041', record, { status: 'unpaid' });
  assert.equal((await C.handleStripeEvent(s, unpaid, stripeSig(unpaid), ENV, now)).ignored, 'not_paid_yet');
  const failed = JSON.stringify({ id: 'evt_f', type: 'checkout.session.async_payment_failed', livemode: false, data: { object: {} } });
  assert.equal((await C.handleStripeEvent(s, failed, stripeSig(failed), ENV, now)).ignored, 'event_type');
  const cheap = paidEvent('BW-2027-041', record, { amount: 100 });
  assert.equal((await C.handleStripeEvent(s, cheap, stripeSig(cheap), ENV, now)).ignored, 'amount_mismatch');
  const live = ev.replace('"livemode":false', '"livemode":true').replace(/"id":"evt_[^"]+"/, '"id":"evt_live_variant"');
  assert.equal((await C.handleStripeEvent(s, live, stripeSig(live), ENV, now)).ignored, 'mode_mismatch');
  assert.equal((await C.bookingStatus(s, token)).booking, 'AWAITING_VERIFIED_PAYMENT');
  // success
  assert.deepEqual(await C.handleStripeEvent(s, ev, stripeSig(ev), ENV, now), { booked: 'BW-2027-041' });
  assert.equal((await C.bookingStatus(s, token)).booking, 'RETAINER_PAID_VERIFIED');
  // same event redelivered, and a second payment for the same commission
  assert.equal((await C.handleStripeEvent(s, ev, stripeSig(ev), ENV, now)).ignored, 'duplicate_event');
  const second = paidEvent('BW-2027-041', record);
  assert.equal((await C.handleStripeEvent(s, second, stripeSig(second), ENV, now)).ignored, 'already_booked');
  assert.equal((await s.list({ prefix: 'bookings/' })).blobs.length, 1);
  await assert.rejects(C.startCheckout(s, token, ENV, fakeStripe()), e => e.code === 'already_booked');
});

test('webhook rejects a paid event whose record does not match', async () => {
  const s = new MemStore();
  const { token } = await invite(s, { commissionId: 'BW-2027-042', role: 'primary', signerName: 'Avery Testerly', signerEmail: 'a@example.test' });
  const { record } = await C.sign(s, token, base('Avery Testerly', { imageUse: 'standard', subjects: family('Avery Testerly') }), meta, versions);
  const ev = paidEvent('BW-2027-042', { body: { ...record.body, recordId: 'rec_forged' } });
  assert.equal((await C.handleStripeEvent(s, ev, stripeSig(ev), ENV)).ignored, 'record_mismatch');
});

test('search by commission, signer, subject, email and year; export verifies every chain', async () => {
  const s = new MemStore();
  const p = await invite(s, { commissionId: 'BW-2027-050', role: 'primary', signerName: 'Avery Testerly', signerEmail: 'avery@example.test' });
  await C.sign(s, p.token, base('Avery Testerly', { imageUse: 'standard', subjects: family('Avery Testerly') }), meta, versions);
  const r = await invite(s, { commissionId: 'BW-2027-050', role: 'release', signerName: 'Jordan Testerly', signerEmail: 'jordan@example.test' });
  await C.sign(s, r.token, base('Jordan Testerly', { subjects: [{ subject: 'Jordan Testerly', type: 'adult', release: 'yes' }] }), meta, versions);
  for (const q of ['BW-2027-050', 'jordan testerly', 'Mia', 'avery@example.test', String(new Date().getFullYear())])
    assert.ok((await C.search(s, q)).length >= 1, q);
  assert.equal((await C.search(s, 'Jordan Testerly')).length, 2);   // original row + own release
  const ex = await C.exportAll(s);
  assert.ok(ex.verification.every(v => v.ok)); assert.match(ex.sha256, /^[0-9a-f]{64}$/);
  // restore from backup into an empty store and re-verify
  const s2 = new MemStore(); for (const [k, v] of Object.entries(ex.data)) await s2.setJSON(k, v);
  assert.ok((await C.verifyChain(s2, 'BW-2027-050')).ok);
});

test('admin endpoints refuse missing, short or wrong tokens', () => {
  const req = (h) => ({ headers: new Map(Object.entries(h)) });
  const env = { BW_ADMIN_TOKEN: 'a'.repeat(40) };
  for (const h of [{}, { authorization: 'Bearer wrong' }, { authorization: 'a'.repeat(40) }])
    assert.throws(() => C.requireAdmin(req(h), env), e => e.code === 'unauthorized');
  assert.throws(() => C.requireAdmin(req({ authorization: 'Bearer short' }), { BW_ADMIN_TOKEN: 'short' }), e => e.code === 'unauthorized');
  assert.equal(C.requireAdmin(req({ authorization: 'Bearer ' + 'a'.repeat(40) }), env), 'admin');
});
