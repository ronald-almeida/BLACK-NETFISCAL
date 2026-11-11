import test from 'node:test';
import assert from 'node:assert/strict';
import { makePayments } from '../lib/payments.js';
import { validInput, memoryStore, fakeEnv, paidEvent } from './fixtures.mjs';

function setup({ createMode = 'partial', lookupChange = {}, lookupError = false } = {}) {
  let time = Date.now(), input, reads = 0, creates = 0;
  const store = memoryStore(), logs = [];
  let transactionStatus = 'PENDING';
  const api = makePayments({ store, env: fakeEnv, now: () => time,
    logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    fetcher: async (url, options) => {
      assert.equal(options.headers['x-secret-key'], fakeEnv.POSEIDON_SECRET_KEY);
      if (options.method === 'POST') {
        creates++; input = JSON.parse(options.body);
        if (createMode === 'timeout') throw new DOMException('sensitive upstream body', 'TimeoutError');
        if (createMode === 'invalid-json') return new Response('<html>private upstream details</html>');
        return Response.json({ transactionId: `test-${input.identifier}`, status: 'PENDING',
          ...(createMode !== 'no-token' ? { webhookToken: 'local-test-webhook-token' } : {}),
          ...(createMode === 'no-token' ? { pix: { code: 'LOCAL_TEST_ONLY_NOT_A_PAYMENT' } } : {}) });
      }
      assert.equal(options.method, 'GET');
      assert.equal(new URL(url).pathname, '/api/v1/gateway/transactions');
      assert.equal(new URL(url).searchParams.get('clientIdentifier'), input.identifier);
      reads++;
      if (lookupError) return Response.json({ message: 'private upstream details' }, { status: 503 });
      return Response.json({ id: `test-${input.identifier}`, clientIdentifier: input.identifier,
        paymentMethod: 'PIX', currency: 'BRL', amount: input.amount, chargeAmount: input.amount,
        status: transactionStatus, pixInformation: { qrCode: 'LOCAL_TEST_ONLY_NOT_A_PAYMENT' }, ...lookupChange });
    } });
  return { api, store, logs, advance: ms => { time += ms; }, setStatus: value => { transactionStatus = value; }, counts: () => ({ creates, reads }) };
}

test('all products recover the existing Pix after an incomplete response and still confirm via webhook', async () => {
  for (const product of ['mba', 'pos', 'imersao']) {
    const ctx = setup();
    const input = validInput(product);
    const first = await ctx.api.create(input, 'test');
    assert.equal(first.status, 'REVIEW'); assert.equal(first.recoveryPending, true); assert.equal(first.pix, null);
    const recovered = await ctx.api.status(first.token);
    assert.equal(recovered.status, 'PENDING'); assert.equal(recovered.recoveryPending, false);
    assert.equal(recovered.orderId, first.orderId); assert.equal(recovered.token, first.token);
    assert.equal(recovered.pix.code, 'LOCAL_TEST_ONLY_NOT_A_PAYMENT'); assert.match(recovered.pix.image, /^data:image\/png;base64,/);
    assert.deepEqual(ctx.counts(), { creates: 1, reads: 1 });
    await ctx.api.create(input, 'test'); await ctx.api.status(first.token);
    assert.deepEqual(ctx.counts(), { creates: 1, reads: 1 });
    await ctx.api.webhook(paidEvent(recovered));
    assert.equal((await ctx.api.status(first.token)).redirect, '/obrigado?origem=checkout');
  }
});

test('lost response recovers QR and never trusts a paid notification without provider confirmation', async () => {
  const ctx = setup({ createMode: 'timeout' });
  const first = await ctx.api.create(validInput(), 'test');
  const recovered = await ctx.api.status(first.token);
  assert.equal(recovered.status, 'PENDING'); assert.ok(recovered.pix.image);
  await assert.rejects(() => ctx.api.webhook(paidEvent(recovered)), /Confirmação/);
  assert.equal((await ctx.api.status(first.token)).redirect, null);
  ctx.advance(60001);
  await assert.rejects(() => ctx.api.webhook(paidEvent(recovered)), /Confirmação/);
  assert.equal((await ctx.api.status(first.token)).status, 'PENDING');
  ctx.setStatus('COMPLETED'); ctx.advance(60001);
  await ctx.api.webhook(paidEvent(recovered));
  assert.equal((await ctx.api.status(first.token)).redirect, '/obrigado?origem=checkout');
  ctx.setStatus('REFUNDED'); ctx.advance(60001);
  await ctx.api.webhook({ ...paidEvent(recovered), event: 'TRANSACTION_REFUNDED' });
  assert.equal((await ctx.api.status(first.token)).status, 'REFUNDED');
  assert.equal((await ctx.api.status(first.token)).redirect, null);
  assert.equal(ctx.counts().creates, 1);
});

test('optional missing webhook token does not discard a valid QR; fallback lookups are spaced five minutes apart', async () => {
  const ctx = setup({ createMode: 'no-token' });
  const order = await ctx.api.create(validInput(), 'test');
  assert.equal(order.status, 'PENDING'); assert.ok(order.pix.image);
  await ctx.api.status(order.token); ctx.advance(299999); await ctx.api.status(order.token);
  assert.equal(ctx.counts().reads, 0);
  ctx.advance(1); await ctx.api.status(order.token); await ctx.api.status(order.token);
  assert.equal(ctx.counts().reads, 1);
  ctx.setStatus('COMPLETED'); ctx.advance(300000);
  assert.equal((await ctx.api.status(order.token)).status, 'COMPLETED');
  assert.equal(ctx.counts().creates, 1);
});

test('recovery rejects mismatched transaction identity, amount, currency, method and status', async () => {
  for (const lookupChange of [{ id: 'different' }, { clientIdentifier: 'different' }, { amount: 5 }, { chargeAmount: 1 },
    { currency: 'USD' }, { paymentMethod: 'CREDIT_CARD' }, { status: 'UNKNOWN' }, { amount: null }, { amount: 'NaN' }]) {
    const ctx = setup({ lookupChange });
    const order = await ctx.api.create(validInput(), 'test');
    const result = await ctx.api.status(order.token);
    assert.equal(result.status, 'REVIEW'); assert.equal(result.pix, null); assert.equal(result.redirect, null);
  }
});

test('invalid order token cannot invoke recovery or expose another order', async () => {
  const ctx = setup(); const order = await ctx.api.create(validInput(), 'test');
  await assert.rejects(() => ctx.api.status(order.token + 'x'), /inválido/);
  assert.equal(ctx.counts().reads, 0);
});

test('concurrent checks share a recovery claim and stop after three unavailable lookups', async () => {
  const ctx = setup({ lookupError: true }); const order = await ctx.api.create(validInput(), 'test');
  await Promise.all([ctx.api.status(order.token), ctx.api.status(order.token), ctx.api.status(order.token)]);
  assert.equal(ctx.counts().reads, 1);
  await ctx.api.status(order.token); assert.equal(ctx.counts().reads, 1);
  ctx.advance(60000); await ctx.api.status(order.token);
  ctx.advance(60000); const final = await ctx.api.status(order.token);
  assert.equal(final.recoveryPending, false);
  ctx.advance(60000); await ctx.api.status(order.token);
  assert.deepEqual(ctx.counts(), { creates: 1, reads: 3 });
});

test('provider-declared failure never displays a payable QR', async () => {
  const ctx = setup({ lookupChange: { status: 'FAILED', pixInformation: null } });
  const order = await ctx.api.create(validInput(), 'test');
  const result = await ctx.api.status(order.token);
  assert.equal(result.status, 'FAILED'); assert.equal(result.pix, null); assert.equal(result.recoveryPending, false);
});

test('diagnostics keep response bodies, personal information and credentials out of logs and public responses', async () => {
  const ctx = setup({ createMode: 'invalid-json', lookupError: true });
  const order = await ctx.api.create(validInput(), 'test'); await ctx.api.status(order.token);
  const output = JSON.stringify([ctx.logs, order]);
  for (const secret of ['aluno@example.com', '11144477735', 'private upstream details', fakeEnv.POSEIDON_SECRET_KEY, 'local-test-webhook-token']) assert.ok(!output.includes(secret));
  assert.equal(ctx.logs[0][1].httpStatus, 200);
});

test('slow recovery cannot roll back a concurrent verified webhook or refund', async () => {
  const store = memoryStore(); let resolveLookup, lookupStarted;
  const started = new Promise(resolve => { lookupStarted = resolve; });
  let input;
  const api = makePayments({ store, env: fakeEnv, logger: {}, fetcher: async (_url, options) => {
    if (options.method === 'POST') { input = JSON.parse(options.body); return Response.json({ transactionId: `test-${input.identifier}`, webhookToken: 'local-test-webhook-token' }); }
    lookupStarted(); return new Promise(resolve => { resolveLookup = resolve; });
  } });
  const order = await api.create(validInput(), 'test');
  const pendingLookup = api.status(order.token); await started;
  await api.webhook(paidEvent(order));
  await api.webhook({ ...paidEvent(order), event: 'TRANSACTION_REFUNDED' });
  resolveLookup(Response.json({ id: `test-${input.identifier}`, clientIdentifier: input.identifier, amount: input.amount,
    chargeAmount: input.amount, currency: 'BRL', paymentMethod: 'PIX', status: 'PENDING', pixInformation: { qrCode: 'LOCAL_TEST_ONLY_NOT_A_PAYMENT' } }));
  const result = await pendingLookup; assert.equal(result.status, 'REFUNDED'); assert.equal(result.redirect, null);
});
