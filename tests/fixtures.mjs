import { randomUUID } from 'node:crypto';
export const validInput = (product = 'mba') => ({ product, attemptId: randomUUID(), quantity: 1,
  buyer: { name: 'Aluno de Teste', email: 'aluno@example.com', phone: '11999998888', document: '11144477735' },
  address: { zipCode: '01001000', street: 'Praça de Teste', number: '1', city: 'São Paulo', neighborhood: 'Centro', complement: '', state: 'SP' },
  confirmEmail: 'aluno@example.com', participants: [{ sameAsBuyer: true }] });
export function memoryStore() {
  const data = new Map();
  return {
    data,
    async read(key) { return data.has(key) ? { data: structuredClone(data.get(key)), etag: 'test-etag' } : null; },
    async create(key, value) { if (data.has(key)) return false; data.set(key, structuredClone(value)); return true; },
    async update(key, change) { const current = data.get(key); if (!current) return null; const next = change(structuredClone(current)); if (next) data.set(key, structuredClone(next)); return structuredClone(next || current); }
  };
}
export const fakeEnv = { POSEIDON_PUBLIC_KEY: 'test-public', POSEIDON_SECRET_KEY: 'test-secret-not-a-live-key', BLOB_STORE_ID: 'test-store' };
export function fakeGateway() {
  const calls = [];
  const fetcher = async (url, options) => {
    const input = JSON.parse(options.body); calls.push({ url, input, options });
    return Response.json({ transactionId: `test-${input.identifier}`, status: 'OK', webhookToken: 'local-test-webhook-token', pix: { code: 'LOCAL_TEST_ONLY_NOT_A_PAYMENT', expiresAt: new Date(Date.now() + 1800000).toISOString() } });
  };
  return { calls, fetcher };
}
export const paidEvent = order => ({ event: 'TRANSACTION_PAID', token: 'local-test-webhook-token', transaction: { id: `test-${order.orderId}`, identifier: order.orderId, status: 'COMPLETED', paymentMethod: 'PIX', currency: 'BRL', amount: order.amount, payedAt: new Date().toISOString() } });
