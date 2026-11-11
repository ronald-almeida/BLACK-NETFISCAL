import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { PRODUCTS, SITE } from './catalog.js';

export class CheckoutError extends Error {
  constructor(status, message, fields = {}) { super(message); this.status = status; this.fields = fields; }
}
const digits = value => String(value || '').replace(/\D/g, '');
export function validDocument(value) {
  const s = digits(value);
  if (/^(\d)\1+$/.test(s)) return false;
  if (s.length === 11) {
    const check = length => { let total = 0; for (let i = 0; i < length; i++) total += Number(s[i]) * (length + 1 - i); return (total * 10 % 11) % 10; };
    return check(9) === Number(s[9]) && check(10) === Number(s[10]);
  }
  if (s.length === 14) {
    const check = length => { let total = 0, weight = length - 7; for (let i = 0; i < length; i++) { total += Number(s[i]) * weight; if (--weight < 2) weight = 9; } const rest = total % 11; return rest < 2 ? 0 : 11 - rest; };
    return check(12) === Number(s[12]) && check(13) === Number(s[13]);
  }
  return false;
}
export function validateOrder(input) {
  const product = Object.hasOwn(PRODUCTS, input?.product) ? PRODUCTS[input.product] : null;
  if (!product) throw new CheckoutError(400, 'Selecione uma formação válida.');
  if (!/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(input.attemptId || '')) throw new CheckoutError(400, 'Atualize a página e tente novamente.');
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > product.maxQuantity) throw new CheckoutError(400, 'Quantidade inválida.');
  const errors = {};
  function person(raw, prefix) {
    const name = String(raw?.name || '').trim().slice(0, 120);
    const email = String(raw?.email || '').trim().toLowerCase().slice(0, 254);
    const phone = digits(raw?.phone);
    const document = digits(raw?.document);
    if (name.length < 3 || !name.includes(' ')) errors[`${prefix}name`] = 'Informe o nome completo.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors[`${prefix}email`] = 'Informe um e-mail válido.';
    if (prefix !== 'participant_') {
      if (!/^\d{10,11}$/.test(phone)) errors[`${prefix}phone`] = 'Informe o telefone com DDD.';
      if (!validDocument(document)) errors[`${prefix}document`] = 'Informe um CPF ou CNPJ válido.';
    }
    return { name, email, phone, document };
  }
  const buyer = person(input.buyer, '');
  if (product.id !== 'imersao' && buyer.document.length !== 11) errors.document = 'Informe o CPF do aluno.';
  const payer = input.payer ? person(input.payer, 'payer_') : buyer;
  const address = {};
  for (const field of ['zipCode', 'street', 'number', 'city', 'neighborhood', 'complement', 'state']) address[field] = String(input.address?.[field] || '').trim().slice(0, 160);
  address.zipCode = digits(address.zipCode);
  address.country = 'BR';
  if (!/^\d{8}$/.test(address.zipCode)) errors.zipCode = 'Informe um CEP válido.';
  if (product.id !== 'imersao') {
    for (const field of ['street', 'number', 'city', 'neighborhood']) if (!address[field]) errors[field] = 'Preencha este campo.';
    if (!'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(address.state)) errors.state = 'Selecione o estado.';
  }
  let participants = [];
  if (product.id === 'imersao') {
    if (input.confirmEmail?.trim().toLowerCase() !== buyer.email) errors.confirmEmail = 'Os e-mails precisam ser iguais.';
    if (!Array.isArray(input.participants) || input.participants.length !== quantity) errors.participants = 'Preencha os dados de todos os participantes.';
    else participants = input.participants.map((p, i) => {
      if (p.sameAsBuyer && i === 0) return { name: buyer.name, email: buyer.email };
      const result = person(p, 'participant_');
      if (errors.participant_name || errors.participant_email) errors.participants = 'Confira nome e e-mail de todos os participantes.';
      return { name: result.name, email: result.email };
    });
  }
  if (Object.keys(errors).length) throw new CheckoutError(400, 'Confira os campos destacados.', errors);
  return { id: `nf-${product.id}-${input.attemptId.toLowerCase()}`, product, quantity, amount: product.amount * quantity, buyer, payer, address, participants };
}
export const sameSecret = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};
export const digest = (key, text) => createHmac('sha256', key).update(text).digest('hex');
const GATEWAY = 'https://app.poseidonpay.site/api/v1/gateway';
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'EXPIRED', 'REFUNDED', 'CHARGED_BACK']);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const needsPixRecovery = order => ['CREATING', 'REVIEW'].includes(order.status) && (order.recovery?.qrAttempts || 0) < 3;
async function pixData(code, expiresAt = null) {
  // A rendering failure must not discard a usable Pix Copia e Cola code.
  let image = null;
  try { image = await QRCode.toDataURL(code, { width: 300, margin: 2, errorCorrectionLevel: 'M' }); } catch {}
  return { code, image, expiresAt };
}
function tokenFor(order, secret) { return `${order.id}.${digest(secret, `order:${order.id}:${order.createdAt}`)}`; }
export async function publicOrder(order, secret) {
  return { token: tokenFor(order, secret), orderId: order.id, product: order.product.id, quantity: order.quantity, amount: order.amount, status: order.status, pix: order.pix || null, recoveryPending: needsPixRecovery(order), redirect: order.status === 'COMPLETED' ? '/obrigado?origem=checkout' : null };
}
export function makePayments({ store, env = process.env, fetcher = fetch, now = Date.now, logger = console }) {
  const ready = () => Boolean(env.POSEIDON_PUBLIC_KEY && env.POSEIDON_SECRET_KEY && (env.BLOB_READ_WRITE_TOKEN || env.BLOB_STORE_ID));
  const requireReady = () => { if (!ready()) throw new CheckoutError(503, 'O pagamento está temporariamente indisponível. Fale com nosso suporte.'); };
  const headers = () => ({ 'content-type': 'application/json', 'x-public-key': env.POSEIDON_PUBLIC_KEY, 'x-secret-key': env.POSEIDON_SECRET_KEY });
  const canReconcile = (order, source) => {
    if (TERMINAL.has(order.status) && !(order.status === 'COMPLETED' && !order.webhookToken && source === 'webhook')) return false;
    const last = order.recovery?.lastAttemptAt;
    if (needsPixRecovery(order)) {
      if (order.status === 'CREATING' && now() - order.createdAt < 50000) return false;
      return last == null || now() - last >= 60000;
    }
    // Normal checkouts use webhooks only. Exceptional orders without the returned
    // webhook token get a bounded-frequency authenticated confirmation lookup.
    return ['PENDING', 'COMPLETED'].includes(order.status) && !order.webhookToken &&
      now() - (last ?? order.createdAt) >= (source === 'webhook' ? 60000 : 300000);
  };
  async function reconcile(order, source = 'status') {
    if (!canReconcile(order, source)) return order;
    const key = `orders/${order.id}`, claim = randomUUID();
    const claimed = await store.update(key, current => canReconcile(current, source) ? {
      ...current, recovery: { ...current.recovery, claim, lastAttemptAt: now(),
        qrAttempts: (current.recovery?.qrAttempts || 0) + (needsPixRecovery(current) ? 1 : 0) }
    } : null);
    // The stored claim prevents concurrent browser checks from querying twice.
    if (!claimed || claimed.recovery?.claim !== claim) return claimed || order;
    try {
      const query = new URLSearchParams({ clientIdentifier: claimed.id });
      const response = await fetcher(`${GATEWAY}/transactions?${query}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), headers: headers()
      });
      const transaction = await response.json();
      if (!response.ok) throw new Error('lookup_failed');
      // Never accept a different transaction, currency, payment method or total.
      if (!nonempty(transaction.id) || transaction.clientIdentifier !== claimed.id ||
          (claimed.transactionId && transaction.id !== claimed.transactionId) ||
          transaction.paymentMethod !== 'PIX' || transaction.currency !== 'BRL' ||
          !Number.isFinite(Number(transaction.amount)) || Math.round(Number(transaction.amount) * 100) !== Math.round(claimed.amount * 100) ||
          (transaction.chargeAmount != null && Math.round(Number(transaction.chargeAmount) * 100) !== Math.round(claimed.amount * 100)) ||
          !['PENDING', ...TERMINAL].includes(transaction.status)) throw new Error('lookup_mismatch');
      const code = transaction.pixInformation?.qrCode;
      const pix = nonempty(code) ? await pixData(code, claimed.pix?.expiresAt || null) : claimed.pix;
      const saved = await store.update(key, current => {
        // A slow lookup must never overwrite a more recent webhook or refund.
        if ((TERMINAL.has(current.status) && !(current.status === 'COMPLETED' && ['REFUNDED', 'CHARGED_BACK'].includes(transaction.status))) || current.recovery?.claim !== claim) return null;
        return { ...current, transactionId: transaction.id, pix,
          status: transaction.status === 'PENDING' && !pix?.code ? 'REVIEW' : transaction.status,
          updatedAt: now(), ...(transaction.status === 'COMPLETED' ? { paidAt: transaction.payedAt || new Date(now()).toISOString() } : {}) };
      });
      logger.info?.('pix_recovery_result', { orderId: claimed.id, status: saved.status, hasPix: Boolean(saved.pix?.code) });
      return saved;
    } catch (error) {
      logger.warn?.('pix_recovery_failed', { orderId: claimed.id, reason: error.message === 'lookup_mismatch' ? 'mismatch' : 'unavailable' });
      return (await store.read(key))?.data || claimed;
    }
  }
  const authenticate = async token => {
    if (typeof token !== 'string' || token.length > 200) throw new CheckoutError(401, 'Pedido inválido.');
    const [id] = token.split('.');
    if (!/^nf-(mba|pos|imersao)-[a-f\d-]{36}$/.test(id)) throw new CheckoutError(401, 'Pedido inválido.');
    const record = await store.read(`orders/${id}`);
    if (!record || !sameSecret(token, tokenFor(record.data, env.POSEIDON_SECRET_KEY))) throw new CheckoutError(401, 'Pedido inválido.');
    return record.data;
  };
  return {
    ready,
    async create(input, ip) {
      requireReady();
      const order = validateOrder(input);
      const fingerprint = digest(env.POSEIDON_SECRET_KEY, JSON.stringify(order));
      const key = `orders/${order.id}`;
      const existing = await store.read(key);
      if (existing) {
        if (existing.data.fingerprint !== fingerprint) throw new CheckoutError(409, 'Os dados deste pedido já foram enviados. Consulte o suporte para alterar.');
        return publicOrder(existing.data, env.POSEIDON_SECRET_KEY);
      }
      // Fixed slots give an atomic limit across all serverless instances.
      const bucket = Math.floor(now() / 3600000);
      const visitor = digest(env.POSEIDON_SECRET_KEY, `rate:${ip || 'unknown'}`).slice(0, 32);
      let allowed = false;
      for (let slot = 0; slot < 6; slot++) {
        if (await store.create(`limits/${bucket}-${visitor}-${slot}`, { createdAt: now() })) { allowed = true; break; }
      }
      if (!allowed) throw new CheckoutError(429, 'Muitas tentativas. Aguarde ou fale com o suporte.');
      const pending = { ...order, fingerprint, createdAt: now(), status: 'CREATING', transactionId: null, webhookToken: null };
      if (!await store.create(key, pending)) {
        const raced = await store.read(key);
        if (!raced || raced.data.fingerprint !== fingerprint) throw new CheckoutError(409, 'Pedido já está sendo processado.');
        return publicOrder(raced.data, env.POSEIDON_SECRET_KEY);
      }
      let result, httpStatus = null;
      try {
        const response = await fetcher(`${GATEWAY}/pix/receive`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35000),
          headers: headers(),
          body: JSON.stringify({ identifier: order.id, amount: order.amount, client: order.payer,
            products: [{ id: order.product.id, name: order.product.name, quantity: order.quantity, price: order.product.amount, physical: false }],
            metadata: { provider: 'NetFiscal', orderId: order.id, student: { name: order.buyer.name, email: order.buyer.email }, address: order.address, participants: order.participants },
            callbackUrl: `${env.SITE_URL || SITE}/api/pix-webhook` })
        });
        httpStatus = response.status;
        result = await response.json();
        if (!response.ok || !nonempty(result?.transactionId) || !nonempty(result?.pix?.code) ||
            ['FAILED', 'REJECTED', 'CANCELED'].includes(result.status) ||
            ['FAILED', 'REFUNDED', 'CHARGED_BACK', 'EXPIRED'].includes(result.transactionStatus)) throw new Error('Unconfirmed gateway response');
      } catch (error) {
        // Never create another charge automatically after an ambiguous network failure.
        const diagnostic = { httpStatus, timeout: error.name === 'TimeoutError' || error.name === 'AbortError',
          hasTransaction: nonempty(result?.transactionId), hasPix: nonempty(result?.pix?.code), hasWebhookToken: nonempty(result?.webhookToken) };
        logger.warn?.('pix_create_unconfirmed', { orderId: order.id, ...diagnostic });
        const failed = await store.update(key, current => current.status === 'CREATING' ? ({ ...current, status: 'REVIEW',
          transactionId: nonempty(result?.transactionId) ? result.transactionId : current.transactionId,
          webhookToken: nonempty(result?.webhookToken) ? result.webhookToken : current.webhookToken,
          diagnostic, updatedAt: now() }) : null);
        return publicOrder(failed, env.POSEIDON_SECRET_KEY);
      }
      const pix = await pixData(result.pix.code, result.pix.expiresAt || null);
      const saved = await store.update(key, current => TERMINAL.has(current.status) ? null : ({ ...current, status: 'PENDING', transactionId: result.transactionId,
        webhookToken: nonempty(result.webhookToken) ? result.webhookToken : current.webhookToken, pix, updatedAt: now() }));
      return publicOrder(saved, env.POSEIDON_SECRET_KEY);
    },
    async status(token) {
      requireReady();
      let order = await authenticate(token);
      order = await reconcile(order);
      if (['CREATING', 'REVIEW'].includes(order.status)) {
        if (now() - order.createdAt > 45000) order.status = 'REVIEW';
      } else if (order.status === 'PENDING' && order.pix?.expiresAt && now() > Date.parse(order.pix.expiresAt)) order.status = 'EXPIRED';
      return publicOrder(order, env.POSEIDON_SECRET_KEY);
    },
    async webhook(payload) {
      requireReady();
      const statuses = { TRANSACTION_PAID: 'COMPLETED', TRANSACTION_CANCELED: 'FAILED', TRANSACTION_REFUNDED: 'REFUNDED', TRANSACTION_CHARGED_BACK: 'CHARGED_BACK', TRANSACTION_CREATED: 'PENDING' };
      const target = Object.hasOwn(statuses, payload?.event) ? statuses[payload.event] : null;
      if (!target) throw new CheckoutError(400, 'Evento inválido.');
      const id = payload.transaction?.identifier;
      if (!/^nf-(mba|pos|imersao)-[a-f\d-]{36}$/.test(id || '')) throw new CheckoutError(400, 'Pedido inválido.');
      const key = `orders/${id}`;
      const found = await store.read(key);
      if (!found) throw new CheckoutError(503, 'Pedido ainda não está pronto.');
      const order = found.data, transaction = payload.transaction;
      if (!order.webhookToken) {
        // The create response may have been lost. Do not trust this notification:
        // confirm the exact order through the authenticated provider API instead.
        if ((order.transactionId && transaction.id !== order.transactionId) || transaction.paymentMethod !== 'PIX' || transaction.currency !== 'BRL' || Math.round(Number(transaction.amount) * 100) !== Math.round(order.amount * 100)) throw new CheckoutError(400, 'Transação divergente.');
        const verified = await reconcile(order, 'webhook');
        if (verified.status !== target || target === 'PENDING') throw new CheckoutError(503, 'Confirmação ainda não disponível.');
        return { received: true };
      }
      if (!sameSecret(payload.token, order.webhookToken)) throw new CheckoutError(401, 'Notificação inválida.');
      if (transaction.id !== order.transactionId || transaction.paymentMethod !== 'PIX' || transaction.currency !== 'BRL' || Math.round(Number(transaction.amount) * 100) !== order.amount * 100) throw new CheckoutError(400, 'Transação divergente.');
      if (target === 'COMPLETED' && transaction.status !== 'COMPLETED') throw new CheckoutError(400, 'Pagamento não confirmado.');
      await store.update(key, current => {
        // Old notifications cannot undo a refund or reset a confirmed payment to pending.
        if (['REFUNDED', 'CHARGED_BACK'].includes(current.status) || target === 'PENDING' || (current.status === 'COMPLETED' && target === 'FAILED')) return null;
        if (current.status === target) return null;
        return { ...current, status: target, updatedAt: now(), paidAt: target === 'COMPLETED' ? transaction.payedAt || new Date(now()).toISOString() : current.paidAt };
      });
      return { received: true };
    }
  };
}
