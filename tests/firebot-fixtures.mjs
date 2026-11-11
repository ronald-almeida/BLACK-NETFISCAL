import { randomUUID } from 'node:crypto';
import { digest } from '../lib/payments.js';
export const firebotEnv = { FIREBOT_API_KEY: 'fire_sk_live_LOCAL_TEST_ONLY', FIREBOT_WEBHOOK_SECRET: 'LOCAL_TEST_WEBHOOK_SECRET', BLOB_STORE_ID: 'local-test-store' };
export function firebotGateway() {
  const calls = [], transactions = new Map();
  return { calls, transactions, fetcher: async (url, options) => {
    calls.push({ url, options, ...(options.body ? { input: JSON.parse(options.body) } : {}) });
    if (options.method === 'GET') {
      const transaction = transactions.get(new URL(url).pathname.split('/').pop());
      return Response.json(transaction ? { success: true, ...transaction } : { success: false }, { status: transaction ? 200 : 404 });
    }
    const input = JSON.parse(options.body), transactionId = `fire_tx_${randomUUID().replaceAll('-', '')}`;
    const transaction = { transactionId, amount: input.amount, status: 'PENDING', paymentMethod: 'PIX', currency: 'BRL', pixCopiaECola: 'LOCAL_TEST_ONLY_NOT_A_PAYMENT' };
    transactions.set(transactionId, transaction);
    return Response.json({ success: true, ...transaction, qrCodeUrl: 'https://example.invalid/untrusted-image.svg' });
  } };
}
export function firebotEvent(transaction, event = 'venda.paga') {
  const raw = JSON.stringify({ event, timestamp: new Date().toISOString(), data: { ...transaction, status: event === 'venda.estornada' ? 'REFUNDED' : 'PAID' } });
  return { raw, signature: digest(firebotEnv.FIREBOT_WEBHOOK_SECRET, raw) };
}
