import { payments, body, json, failure } from '../lib/http.js';
export async function POST(request) {
  try { return json(await payments.webhook(await body(request, 100000))); }
  catch (error) { return failure(error); }
}
