import http from 'node:http';
import { mkdir, readFile, writeFile, readdir, rename, rm, stat, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const hashToken = token => createHash('sha256').update(token).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const limit = 50 * 1024 * 1024 + 8192;
const fail = status => { throw Object.assign(Error('Request rejected'), { status }); };
function inside(root, ...parts) {
  const path = resolve(root, ...parts);
  if (!path.startsWith(resolve(root) + sep)) fail(400);
  return path;
}
function parseHeader(bytes) {
  if (bytes.length < 28 || bytes.subarray(0, 8).toString() !== 'CIJSAVE1') fail(400);
  const n = bytes.readUInt32BE(8);
  if (n < 2 || n > 4096 || n + 28 > bytes.length) fail(400);
  let h; try { h = JSON.parse(bytes.subarray(12, 12 + n)); } catch { fail(400); }
  if (h.format !== 'cijian-encrypted-save' || h.version !== 1 || !uuid.test(h.id) || !Number.isFinite(Date.parse(h.created)) || typeof h.deviceName !== 'string' || h.deviceName.length > 80 || typeof h.appVersion !== 'string' || h.appVersion.length > 40 || h.cipher !== 'AES-256-GCM' || h.kdf !== 'PBKDF2-SHA256' || h.iterations !== 600000 || !/^[a-f0-9]{32}$/.test(h.salt) || !/^[a-f0-9]{24}$/.test(h.iv)) fail(400);
  return h;
}
async function body(req) {
  if (Number(req.headers['content-length']) > limit) fail(413);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) fail(413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function durableFile(path, bytes) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
export function createCloudServer({ root, tokens, origins = ['https://localhost'], maxItems = 10, quotaBytes = 512 * 1024 * 1024 }) {
  if (!root || !tokens || Object.values(tokens).some(id => !uuid.test(id)) || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 100) throw Error('Invalid private server configuration');
  root = resolve(root); let queue = Promise.resolve();
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
  const serialize = action => { const next = queue.then(action); queue = next.catch(() => {}); return next; };
  const listing = async dir => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const names = (await readdir(dir)).filter(n => uuid.test(n));
    const items = await Promise.all(names.map(async id => JSON.parse(await readFile(inside(dir, id, 'meta.json'), 'utf8'))));
    return items.sort((a, b) => b.created.localeCompare(a.created) || b.id.localeCompare(a.id));
  };
  const server = http.createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      res.setHeader('Vary', 'Origin');
      if (origin && !origins.includes(origin)) fail(403);
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Content-SHA256');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const bearer = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1];
      const user = bearer && tokens[hashToken(bearer)]; if (!user) fail(401);
      const path = new URL(req.url, 'http://localhost').pathname;
      const match = path.match(/^\/v1\/backups(?:\/([a-f0-9-]{36}))?$/); if (!match) fail(404);
      const id = match[1]; if (id && !uuid.test(id)) fail(400);
      const dir = inside(root, user);
      if (!id && req.method === 'GET') { json(res, 200, { format: 'cijian-cloud', version: 1, items: await serialize(() => listing(dir)) }); return; }
      if (!id) fail(405);
      const target = inside(dir, id);
      if (req.method === 'PUT') {
        if (req.headers['content-type'] !== 'application/octet-stream') fail(415);
        const bytes = await body(req), header = parseHeader(bytes);
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (header.id !== id || digest !== req.headers['x-content-sha256']) fail(400);
        const item = await serialize(async () => {
          const items = await listing(dir), existing = items.find(i => i.id === id);
          if (existing) { if (existing.sha256 !== digest) fail(409); return existing; }
          if (items.length >= maxItems || items.reduce((sum, i) => sum + i.bytes, 0) + bytes.length > quotaBytes) fail(507);
          const temp = inside(dir, '.tmp-' + randomUUID());
          const meta = { id, created: new Date().toISOString(), deviceName: header.deviceName, appVersion: header.appVersion, bytes: bytes.length, sha256: digest };
          await mkdir(temp, { mode: 0o700 });
          try {
            await durableFile(join(temp, 'data.bin'), bytes);
            await durableFile(join(temp, 'meta.json'), JSON.stringify(meta));
            await rename(temp, target); // Publish only the complete pair.
          } finally { await rm(temp, { recursive: true, force: true }); }
          return meta;
        });
        json(res, 201, item); return;
      }
      if (req.method === 'GET') {
        const file = inside(target, 'data.bin'); let info;
        try { info = await stat(file); } catch (e) { if (e.code === 'ENOENT') fail(404); throw e; }
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        createReadStream(file).on('error', () => res.destroy()).pipe(res); return;
      }
      if (req.method === 'DELETE') {
        await serialize(async () => { const items = await listing(dir); if (!items.some(i => i.id === id)) fail(404); await rm(target, { recursive: true }); });
        res.writeHead(204); res.end(); return;
      }
      fail(405);
    } catch (e) {
      req.resume();
      if (!res.headersSent) json(res, e.status || 500, { error: 'Request failed', status: e.status || 500 }); else res.destroy();
    }
  });
  server.requestTimeout = 90000; server.headersTimeout = 15000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve(process.env.CIJIAN_CLOUD_DIR || '.cloud-private');
  if (process.argv[2] === 'init') {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const token = randomBytes(32).toString('base64url'), user = randomUUID();
    await writeFile(join(directory, 'config.json'), JSON.stringify({ tokens: { [hashToken(token)]: user }, origins: ['https://localhost'], maxItems: 10 }, null, 2), { flag: 'wx', mode: 0o600 });
    await writeFile(join(directory, 'access-key.txt'), token, { flag: 'wx', mode: 0o600 });
    console.log('配置与连接密钥已生成在 ' + directory + '；请自行查看access-key.txt，不要公开或提交该目录。');
  } else {
    const config = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'));
    const server = createCloudServer({ ...config, root: join(directory, 'saves') });
    server.listen(Number(process.env.PORT || 8787), '127.0.0.1', () => console.log('词间存档服务已监听127.0.0.1:' + server.address().port + '；公网访问须由HTTPS反向代理提供。'));
  }
}
