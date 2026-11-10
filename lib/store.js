import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
const options = { access: 'private', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60 };
export const blobStore = {
  async read(key) {
    const result = await get(`checkout/${key}.json`, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return { data: await new Response(result.stream).json(), etag: result.blob.etag };
  },
  async create(key, data) {
    try { await put(`checkout/${key}.json`, JSON.stringify(data), { ...options, allowOverwrite: false }); return true; }
    catch (error) { if (/already exists/i.test(error.message)) return false; throw error; }
  },
  async update(key, change) {
    // Compare-and-swap protects concurrent create responses and webhook delivery.
    for (let attempt = 0; attempt < 3; attempt++) {
      const record = await this.read(key);
      if (!record) return null;
      const data = change(record.data);
      if (!data) return record.data;
      try { await put(`checkout/${key}.json`, JSON.stringify(data), { ...options, allowOverwrite: true, ifMatch: record.etag }); return data; }
      catch (error) { if (!(error instanceof BlobPreconditionFailedError)) throw error; }
    }
    throw new Error('Concurrent order update');
  }
};
