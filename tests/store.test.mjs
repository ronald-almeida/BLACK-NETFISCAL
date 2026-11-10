import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobPreconditionFailedError } from '@vercel/blob';
import { createBlobStore } from '../lib/store.js';
const download = (data, etag) => ({ statusCode: 200, stream: new Response(JSON.stringify(data)).body, blob: { etag } });

test('compressed Blob ETag is verified against metadata before payment update', async () => {
  let write;
  const store = createBlobStore({
    getBlob: async (_path, options) => { assert.equal(options.useCache, false); assert.equal(options.headers['accept-encoding'], 'identity'); return download({ status: 'PENDING' }, 'W/"version-1"'); },
    headBlob: async () => ({ etag: '"version-1"' }),
    putBlob: async (_path, body, options) => { write = { body: JSON.parse(body), options }; if (options.ifMatch !== '"version-1"') throw new BlobPreconditionFailedError(); }
  });
  const result = await store.update('orders/test', order => ({ ...order, status: 'COMPLETED' }));
  assert.equal(result.status, 'COMPLETED');
  assert.equal(write.body.status, 'COMPLETED');
  assert.equal(write.options.ifMatch, '"version-1"');
});

test('version changed between download and metadata is reread without overwriting newer data', async () => {
  let reads = 0, writes = 0;
  const store = createBlobStore({
    getBlob: async () => ++reads === 1 ? download({ count: 0 }, 'W/"old"') : download({ count: 10 }, 'W/"new"'),
    headBlob: async () => ({ etag: '"new"' }),
    putBlob: async (_path, body, options) => { writes++; assert.equal(JSON.parse(body).count, 11); assert.equal(options.ifMatch, '"new"'); }
  });
  assert.equal((await store.update('orders/test', data => ({ count: data.count + 1 }))).count, 11);
  assert.equal(reads, 2); assert.equal(writes, 1);
});

test('concurrent conditional write failure retries from the current version', async () => {
  let reads = 0, writes = 0;
  const store = createBlobStore({
    getBlob: async () => download({ count: ++reads }, `"v${reads}"`),
    headBlob: async () => { throw new Error('Strong ETag needs no metadata lookup'); },
    putBlob: async (_path, body, options) => { if (++writes === 1) throw new BlobPreconditionFailedError(); assert.equal(JSON.parse(body).count, 3); assert.equal(options.ifMatch, '"v2"'); }
  });
  assert.equal((await store.update('orders/test', data => ({ count: data.count + 1 }))).count, 3);
  assert.equal(writes, 2);
});
