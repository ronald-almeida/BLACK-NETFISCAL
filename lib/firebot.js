import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { CheckoutError, validateOrder, digest, sameSecret } from './payments.js';
import { SITE } from './catalog.js';

const GATEWAY = 'https://firebotbr.com/api/v1';
// The account's active Pix acquirer permits at most R$ 1,000 per charge.
export const FIREBOT_MAX_AMOUNT = 1000;
const ORDER_ID = /^nf-fb-(mba|pos|imersao)-[a-f\d-]{36}$/;
const TRANSACTION_ID = /^fire_tx_[A-Za-z0-9_-]{8,128}$/;
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'EXPIRED', 'REFUNDED', 'CHARGED_BACK']);
const STATUSES = { PENDING: 'PENDING', PAID: 'COMPLETED', REFUNDED: 'REFUNDED', EXPIRED: 'EXPIRED', FAILED: 'FAILED', CANCELED: 'FAILED', CANCELLED: 'FAILED', CHARGED_BACK: 'CHARGED_BACK' };
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const sameAmount = (value, amount) => (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d{1,2})?$/.test(value))) && Number.isFinite(Number(value)) && Math.round(Number(value) * 100) === Math.round(amount * 100);
const tokenFor = (order, secret) => `${order.id}.${digest(secret, `firebot-order:${order.id}:${order.createdAt}`)}`;
async function pixData(code) {
  let image = null;
  try { image = await QRCode.toDataURL(code, { width: 300, margin: 2, errorCorrectionLevel: 'M' }); } catch {}
  return { code, image, expiresAt: null };
}
function publicOrder(order, secret) {
  return { token: tokenFor(order, secret), orderId: order.id, product: order.product.id, quantity: order.quantity,
    amount: order.amount, status: order.status, pix: order.pix || null,
    recoveryPending: order.status === 'REVIEW' && Boolean(order.transactionId),
    redirect: order.status === 'COMPLETED' ? '/obrigado?origem=checkout' : null };
}
function diagnostic(result, order, env) {
  let message = typeof result?.message === 'string' ? result.message : typeof result?.error === 'string' ? result.error : null;
  if (message) {
    for (const value of [env.FIREBOT_API_KEY, env.FIREBOT_WEBHOOK_SECRET, ...Object.values(order.buyer), ...Object.values(order.payer)]) {
      if (typeof value === 'string' && value.length > 2) message = message.split(value).join('[redacted]');
    }
    message = message.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]').replace(/\b\d[\d.\s()+/-]{6,}\d\b/g, '[number]').slice(0, 300);
  }
  return message;
}

export function makeFirebotPayments({ store, env = process.env, fetcher = fetch, now = Date.now, logger = console }) {
  const secret = () => env.FIREBOT_API_KEY;
  const ready = () => Boolean(/^fire_sk_/.test(secret() || '') && (env.BLOB_STORE_ID || env.BLOB_READ_WRITE_TOKEN));
  const requireReady = () => { if (!ready()) throw new CheckoutError(503, 'O pagamento está temporariamente indisponível. Fale com nosso suporte.'); };
  const headers = () => ({ accept: 'application/json', 'content-type': 'application/json', 'x-api-key': secret() });
  const authenticate = async token => {
    if (typeof token !== 'string' || token.length > 200) throw new CheckoutError(401, 'Pedido inválido.');
    const id = token.split('.')[0];
    if (!ORDER_ID.test(id)) throw new CheckoutError(401, 'Pedido inválido.');
    const found = await store.read(`orders/${id}`);
    if (!found || found.data.provider !== 'firebot' || !sameSecret(token, tokenFor(found.data, secret()))) throw new CheckoutError(401, 'Pedido inválido.');
    return found.data;
  };
  const canQuery = order => Boolean(order.transactionId) && !TERMINAL.has(order.status) &&
    now() - (order.lastCheckedAt ?? order.createdAt) >= (now() - order.createdAt < 3600000 ? 15000 : 60000);
  function applyStatus(current, status, paidAt) {
    if (['REFUNDED', 'CHARGED_BACK'].includes(current.status) || (current.status === 'COMPLETED' && !['REFUNDED', 'CHARGED_BACK'].includes(status))) return current;
    return { ...current, status, updatedAt: now(), ...(status === 'COMPLETED' ? { paidAt: paidAt || new Date(now()).toISOString() } : {}) };
  }
  async function reconcile(order) {
    if (!canQuery(order)) return order;
    const key = `orders/${order.id}`, claim = randomUUID();
    const claimed = await store.update(key, current => canQuery(current) ? { ...current, lastCheckedAt: now(), queryClaim: claim } : null);
    if (!claimed || claimed.queryClaim !== claim) return claimed || order;
    try {
      const response = await fetcher(`${GATEWAY}/pix/${encodeURIComponent(claimed.transactionId)}`, {
        method: 'GET', redirect: 'error', headers: headers(), signal: AbortSignal.timeout(10000)
      });
      const result = await response.json();
      const transaction = result?.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data : result;
      const status = Object.hasOwn(STATUSES, transaction?.status || '') ? STATUSES[transaction.status] : null;
      if (!response.ok || result?.success === false || transaction?.transactionId !== claimed.transactionId ||
          !sameAmount(transaction.amount, claimed.amount) || !status ||
          (transaction.currency != null && transaction.currency !== 'BRL') ||
          (transaction.paymentMethod != null && transaction.paymentMethod !== 'PIX')) {
        logger.warn?.('firebot_status_unverified', { orderId: order.id, httpStatus: response.status,
          fields: Object.keys(transaction || {}).filter(key => /^[a-zA-Z_]{1,40}$/.test(key)),
          identityMatches: transaction?.transactionId === claimed.transactionId,
          amountMatches: sameAmount(transaction?.amount, claimed.amount), statusKnown: Boolean(status) });
        throw new Error('unverified_status');
      }
      const pix = nonempty(transaction.pixCopiaECola) ? await pixData(transaction.pixCopiaECola) : claimed.pix;
      const saved = await store.update(key, current => {
        if (current.queryClaim !== claim || TERMINAL.has(current.status)) return null;
        const next = applyStatus(current, status === 'PENDING' && !pix?.code ? 'REVIEW' : status, transaction.paidAt);
        return { ...next, pix };
      });
      logger.info?.('firebot_status_verified', { orderId: order.id, status: saved.status, hasPix: Boolean(saved.pix?.code) });
      return saved;
    } catch {
      logger.warn?.('firebot_status_unavailable', { orderId: order.id });
      return (await store.read(key))?.data || claimed;
    }
  }
  return {
    ready,
    async create(input, ip) {
      requireReady();
      const validated = validateOrder(input);
      if (validated.amount > FIREBOT_MAX_AMOUNT) throw new CheckoutError(400, 'Selecione um ingresso por compra.', { quantity: 'Selecione um ingresso por compra.' });
      const order = { ...validated, id: validated.id.replace('nf-', 'nf-fb-'), provider: 'firebot' };
      const fingerprint = digest(secret(), JSON.stringify(order));
      const key = `orders/${order.id}`;
      const existing = await store.read(key);
      if (existing) {
        if (existing.data.fingerprint !== fingerprint) throw new CheckoutError(409, 'Os dados deste pedido já foram enviados. Consulte o suporte para alterar.');
        return publicOrder(existing.data, secret());
      }
      const bucket = Math.floor(now() / 3600000), visitor = digest(secret(), `rate:${ip || 'unknown'}`).slice(0, 32);
      let allowed = false;
      for (let slot = 0; slot < 6; slot++) {
        if (await store.create(`limits/firebot-${bucket}-${visitor}-${slot}`, { createdAt: now() })) { allowed = true; break; }
      }
      if (!allowed) throw new CheckoutError(429, 'Muitas tentativas. Aguarde ou fale com o suporte.');
      const pending = { ...order, fingerprint, createdAt: now(), status: 'CREATING', transactionId: null };
      if (!await store.create(key, pending)) {
        const raced = await store.read(key);
        if (!raced || raced.data.fingerprint !== fingerprint) throw new CheckoutError(409, 'Pedido já está sendo processado.');
        return publicOrder(raced.data, secret());
      }
      let result, httpStatus = null;
      try {
        const response = await fetcher(`${GATEWAY}/pix/create`, {
          method: 'POST', redirect: 'error', headers: headers(), signal: AbortSignal.timeout(35000),
          body: JSON.stringify({ amount: order.amount, productType: 'DIGITAL', description: order.product.name,
            storeUrl: `${env.SITE_URL || SITE}/checkout/${order.product.id}`, qrStyle: 'plain',
            customer: { name: order.payer.name, email: order.payer.email, cpf: order.payer.document, phone: order.payer.phone } })
        });
        httpStatus = response.status; result = await response.json();
        if (!response.ok || result?.success !== true || !TRANSACTION_ID.test(result.transactionId || '') ||
            !sameAmount(result.amount, order.amount) || result.status !== 'PENDING' || !nonempty(result.pixCopiaECola)) throw new Error('unconfirmed_create');
      } catch (error) {
        const transactionId = TRANSACTION_ID.test(result?.transactionId || '') ? result.transactionId : null;
        const saved = await store.update(key, current => current.status === 'CREATING' ? { ...current, status: 'REVIEW', transactionId, updatedAt: now() } : null);
        if (transactionId) await store.create(`firebot-transactions/${transactionId}`, { orderId: order.id });
        logger.warn?.('firebot_create_unconfirmed', { orderId: order.id, httpStatus, hasTransaction: Boolean(transactionId),
          timeout: ['TimeoutError', 'AbortError'].includes(error.name), message: diagnostic(result, order, env) });
        return publicOrder(saved, secret());
      }
      const pix = await pixData(result.pixCopiaECola);
      const saved = await store.update(key, current => TERMINAL.has(current.status) ? null : {
        ...current, status: 'PENDING', transactionId: result.transactionId, pix, updatedAt: now()
      });
      await store.create(`firebot-transactions/${result.transactionId}`, { orderId: order.id });
      logger.info?.('firebot_pix_created', { orderId: order.id, hasPix: true });
      return publicOrder(saved, secret());
    },
    async status(token) {
      requireReady();
      let order = await reconcile(await authenticate(token));
      if (order.status === 'CREATING' && now() - order.createdAt > 50000) order = { ...order, status: 'REVIEW' };
      return publicOrder(order, secret());
    },
    async webhook(rawBody, signature) {
      requireReady();
      if (!env.FIREBOT_WEBHOOK_SECRET) throw new CheckoutError(503, 'Notificações não configuradas.');
      if (typeof signature !== 'string' || !/^[a-f\d]{64}$/i.test(signature) || !sameSecret(signature.toLowerCase(), digest(env.FIREBOT_WEBHOOK_SECRET, rawBody))) throw new CheckoutError(401, 'Notificação inválida.');
      let payload;
      try { payload = JSON.parse(rawBody); } catch { throw new CheckoutError(400, 'Dados inválidos.'); }
      const statuses = { 'venda.paga': 'COMPLETED', 'venda.pendente': 'PENDING', 'venda.estornada': 'REFUNDED' };
      if (!Object.hasOwn(statuses, payload?.event || '')) return { received: true, ignored: true };
      const transaction = payload.data, target = statuses[payload.event];
      if (!TRANSACTION_ID.test(transaction?.transactionId || '')) throw new CheckoutError(400, 'Transação inválida.');
      const index = await store.read(`firebot-transactions/${transaction.transactionId}`);
      if (!index) return { received: true, ignored: true };
      const key = `orders/${index.data.orderId}`, found = await store.read(key);
      if (!found) throw new CheckoutError(503, 'Pedido ainda não está pronto.');
      if (found.data.provider !== 'firebot' || found.data.transactionId !== transaction.transactionId ||
          !sameAmount(transaction.amount, found.data.amount) || transaction.paymentMethod !== 'PIX' ||
          (transaction.currency != null && transaction.currency !== 'BRL')) throw new CheckoutError(400, 'Transação divergente.');
      if ((target === 'COMPLETED' && transaction.status !== 'PAID') || (target === 'REFUNDED' && transaction.status !== 'REFUNDED')) throw new CheckoutError(400, 'Status divergente.');
      if (target !== 'PENDING') await store.update(key, current => applyStatus(current, target, transaction.paidAt));
      return { received: true };
    }
  };
}
