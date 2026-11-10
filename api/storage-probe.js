// Expiring diagnostic restricted to a synthetic storage record, never a customer order.
import { createHash, timingSafeEqual } from 'node:crypto';
import { get, head } from '@vercel/blob';
import { blobStore } from '../lib/store.js';
const hash = Buffer.from('fbf5b63969da01b675d86c6a9699fac781ef7f693345f8e3cb324fcde1e9b915', 'hex');
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request) {
  const received = createHash('sha256').update(request.headers.get('authorization') || '').digest();
  if (Date.now() > 1794276759776 || !timingSafeEqual(hash, received)) return json({ error: 'Not found' }, 404);
  const key = 'diagnostics/storage-probe';
  let stage = 'create', etags;
  try {
    await blobStore.create(key, { counter: 0, padding: 'synthetic-data-'.repeat(500) });
    stage = 'compare-etags';
    const path = `checkout/${key}.json`;
    const read = await get(path, { access: 'private', useCache: false });
    const metadata = await head(path);
    etags = { download: read?.blob.etag, metadata: metadata.etag };
    await read?.stream?.cancel();
    stage = 'update-synthetic-record';
    await blobStore.update(key, current => ({ ...current, counter: current.counter + 1 }));
    return json({ ok: true, etags });
  } catch (error) {
    return json({ ok: false, stage, etags, type: error?.constructor?.name, message: String(error?.message).slice(0, 240), frames: error?.stack?.split('\n').slice(1, 5) }, 503);
  }
}
