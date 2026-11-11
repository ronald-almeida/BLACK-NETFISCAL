import { payments, legacyPayments, body, sameOrigin, json, failure } from '../lib/http.js';
export async function POST(request) {
  try { sameOrigin(request); const { token } = await body(request, 1000); const gateway = typeof token === 'string' && token.startsWith('nf-fb-') ? payments : legacyPayments; return json(await gateway.status(token)); }
  catch (error) { return failure(error); }
}
