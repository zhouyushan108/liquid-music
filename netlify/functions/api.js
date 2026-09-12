// Netlify Functions（Lambda v1 风格）到 Node http 处理器的桥接
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import { handler as serverHandler } from '../../server.js';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
]);

export const handler = async (event) => {
  // 还原原始路径：/api/<splat>
  const marker = '/.netlify/functions/api/';
  let path = event.path || '';
  const mi = path.indexOf(marker);
  if (mi >= 0) path = '/api/' + path.slice(mi + marker.length);
  else if (!path.startsWith('/api/')) path = '/api/';
  const reqUrl = path + (event.rawQuery ? '?' + event.rawQuery : '');

  const req = new EventEmitter();
  req.method = event.httpMethod || 'GET';
  req.url = reqUrl;
  const headers = { ...(event.headers || {}) };
  headers.host = headers.host || 'vercel'; // 仅用于 new URL 的 base
  req.headers = headers;

  const resHeaders = {};
  let statusCode = 200;
  let settled = false;

  const res = new EventEmitter();
  res.setHeader = (k, v) => {
    resHeaders[k] = String(v);
  };
  res.getHeader = (k) => resHeaders[k];
  res.writeHead = (status, moreHeaders) => {
    statusCode = status;
    if (moreHeaders) Object.assign(resHeaders, moreHeaders);
  };
  res.write = (chunk) => {
    if (chunk != null) {
      res._chunks = res._chunks || [];
      res._chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
  };
  res.end = (chunk, encoding) => {
    if (chunk != null) res.write(chunk, encoding);
    const body = res._chunks ? Buffer.concat(res._chunks) : Buffer.alloc(0);
    if (settled) return;
    settled = true;
    const outHeaders = {};
    for (const [k, v] of Object.entries(resHeaders)) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) outHeaders[k] = v;
    }
    const ctKey = Object.keys(outHeaders).find((k) => k.toLowerCase() === 'content-type');
    const ct = ctKey ? outHeaders[ctKey] : '';
    const isText = /^text\/|json|javascript|xml|charset=/i.test(ct);
    resolveBody({
      statusCode,
      headers: outHeaders,
      body: isText || body.length === 0 ? body.toString('utf8') : body.toString('base64'),
      isBase64Encoded: !(isText || body.length === 0),
    });
  };

  let resolveBody;
  const done = new Promise((r) => (resolveBody = r));

  // 喂入请求体
  let bodyBuf = Buffer.alloc(0);
  if (event.body) {
    bodyBuf = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body, 'utf8');
  }
  process.nextTick(async () => {
    try {
      if (bodyBuf.length) req.emit('data', bodyBuf);
      req.emit('end');
      await serverHandler(req, res);
    } catch (e) {
      if (!settled) {
        settled = true;
        resolveBody({
          statusCode: 500,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: e.message || 'function error' }),
        });
      }
    }
  });

  return done;
};
