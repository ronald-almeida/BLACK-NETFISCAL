import { payments, rawBody, json, failure } from '../lib/http.js';
export async function POST(request) {
  try { return json(await payments.webhook(await rawBody(request, 100000), request.headers.get('x-signature'))); }
  catch (error) { return failure(error); }
}
