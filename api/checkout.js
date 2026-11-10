import { payments, body, sameOrigin, json, failure } from '../lib/http.js';
export function GET() { return json({ available: payments.ready() }); }
export async function POST(request) {
  try { sameOrigin(request); return json(await payments.create(await body(request), request.headers.get('x-vercel-forwarded-for')?.split(',')[0] || 'unknown')); }
  catch (error) { return failure(error); }
}
