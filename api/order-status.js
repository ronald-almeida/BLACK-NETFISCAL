import { payments, body, sameOrigin, json, failure } from '../lib/http.js';
export async function POST(request) {
  try { sameOrigin(request); const { token } = await body(request, 1000); return json(await payments.status(token)); }
  catch (error) { return failure(error); }
}
