import { get, head, put, BlobPreconditionFailedError } from '@vercel/blob';
const options = { access: 'private', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60 };
export function createBlobStore({ getBlob = get, headBlob = head, putBlob = put } = {}) { return {
  async read(key) {
    const result = await getBlob(`checkout/${key}.json`, { access: 'private', useCache: false, headers: { 'accept-encoding': 'identity' } });
    if (!result || result.statusCode !== 200) return null;
    return { data: await new Response(result.stream).json(), etag: result.blob.etag };
  },
  async create(key, data) {
    try { await putBlob(`checkout/${key}.json`, JSON.stringify(data), { ...options, allowOverwrite: false }); return true; }
    catch (error) { if (/already exists/i.test(error.message)) return false; throw error; }
  },
  async update(key, change) {
    // Compare-and-swap protects concurrent create responses and webhook delivery.
    for (let attempt = 0; attempt < 3; attempt++) {
      const record = await this.read(key);
      if (!record) return null;
      const data = change(record.data);
      if (!data) return record.data;
      let etag = record.etag;
      // Compressed downloads can return W/"...", which conditional writes reject.
      // Confirm the same version through metadata before using its strong ETag.
      if (etag?.startsWith('W/')) {
        const metadata = await headBlob(`checkout/${key}.json`);
        if (metadata.etag !== etag.slice(2)) continue;
        etag = metadata.etag;
      }
      if (!etag || etag.startsWith('W/')) throw new Error('Missing strong storage version');
      try { await putBlob(`checkout/${key}.json`, JSON.stringify(data), { ...options, allowOverwrite: true, ifMatch: etag }); return data; }
      catch (error) { if (!(error instanceof BlobPreconditionFailedError)) throw error; }
    }
    throw new Error('Concurrent order update');
  }
}; }
export const blobStore = createBlobStore();
