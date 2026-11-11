import { CheckoutError, makePayments } from './payments.js';
import { blobStore } from './store.js';
import { SITE } from './catalog.js';
import { makeFirebotPayments } from './firebot.js';
export const legacyPayments = makePayments({ store: blobStore });
export const payments = makeFirebotPayments({ store: blobStore });
export const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export async function body(request, limit = 24000) {
  const raw = await rawBody(request, limit);
  try { return JSON.parse(raw); } catch { throw new CheckoutError(400, 'Dados inválidos.'); }
}
export async function rawBody(request, limit = 24000) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new CheckoutError(415, 'Envie os dados em JSON.');
  if (Number(request.headers.get('content-length')) > limit) throw new CheckoutError(413, 'Dados muito extensos.');
  const reader = request.body?.getReader();
  if (!reader) throw new CheckoutError(400, 'Dados ausentes.');
  let bytes = 0, chunks = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > limit) { await reader.cancel(); throw new CheckoutError(413, 'Dados muito extensos.'); } chunks.push(Buffer.from(value)); }
  return Buffer.concat(chunks).toString('utf8');
}
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  const allowed = new Set([SITE, process.env.SITE_URL, process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`, process.env.VERCEL_BRANCH_URL && `https://${process.env.VERCEL_BRANCH_URL}`]);
  if (!process.env.VERCEL) { allowed.add('http://127.0.0.1:3000'); allowed.add('http://localhost:3000'); }
  if (!origin || !allowed.has(origin)) throw new CheckoutError(403, 'Origem inválida.');
}
export function failure(error) {
  if (error instanceof CheckoutError) return json({ error: error.message, fields: error.fields }, error.status);
  // Avoid logging gateway bodies, documents, tokens or personal data.
  console.error('checkout_operation_failed', { type: error?.constructor?.name || 'Error', code: error?.code, frames: error?.stack?.split('\n').slice(1, 5) });
  return json({ error: 'Não foi possível concluir. Aguarde e consulte o suporte se o problema continuar.' }, 503);
}
