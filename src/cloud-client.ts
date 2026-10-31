import { MAX_ARCHIVE } from "./library";
import { sha256 } from "./archive";
import { APP_VERSION } from "./version";
import { CloudConnection } from "./vault";

const encoder = new TextEncoder(), decoder = new TextDecoder();
const MAGIC = encoder.encode("CIJSAVE1");
export const MAX_CLOUD_BYTES = MAX_ARCHIVE + 8192;
export interface CloudItem { id: string; created: string; deviceName: string; appVersion: string; bytes: number; sha256: string }
interface Header { format: "cijian-encrypted-save"; version: 1; id: string; created: string; deviceName: string;
  appVersion: string; cipher: "AES-256-GCM"; kdf: "PBKDF2-SHA256"; iterations: 600000; salt: string; iv: string }
const hex = (b: Uint8Array) => [...b].map(v => v.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map(v => parseInt(v, 16)));
async function keyFor(password: string, salt: Uint8Array) {
  if (!password || password.length > 256) throw Error("请填写存档密码（最多256字）");
  const base = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: salt as BufferSource },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function encryptSave(bytes: Uint8Array, password: string, deviceName: string) {
  if (password.trim().length < 12 || password.length > 256) throw Error("存档密码请使用12至256字，并妥善保存");
  if (bytes.length > MAX_ARCHIVE) throw Error("存档超过50 MB限制");
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const header: Header = { format: "cijian-encrypted-save", version: 1, id: crypto.randomUUID(), created: new Date().toISOString(),
    deviceName: deviceName.slice(0, 80), appVersion: APP_VERSION, cipher: "AES-256-GCM", kdf: "PBKDF2-SHA256", iterations: 600000, salt: hex(salt), iv: hex(iv) };
  const head = encoder.encode(JSON.stringify(header));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: head, tagLength: 128 }, await keyFor(password, salt), bytes as BufferSource));
  const result = new Uint8Array(12 + head.length + cipher.length);
  result.set(MAGIC); new DataView(result.buffer).setUint32(8, head.length); result.set(head, 12); result.set(cipher, 12 + head.length);
  return { bytes: result, id: header.id };
}
export async function decryptSave(bytes: Uint8Array, password: string) {
  if (bytes.length < 28 || bytes.length > MAX_CLOUD_BYTES || !MAGIC.every((v, i) => bytes[i] === v)) throw Error("不是受支持的加密存档");
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8);
  if (size > 4096 || size < 2 || 12 + size + 16 > bytes.length) throw Error("加密存档头损坏");
  const head = bytes.slice(12, 12 + size), h = JSON.parse(decoder.decode(head)) as Header;
  if (h.format !== "cijian-encrypted-save" || h.version !== 1 || h.cipher !== "AES-256-GCM" || h.kdf !== "PBKDF2-SHA256" || h.iterations !== 600000 || !/^[a-f0-9]{32}$/.test(h.salt) || !/^[a-f0-9]{24}$/.test(h.iv)) throw Error("加密参数不受支持");
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unhex(h.iv) as BufferSource, additionalData: head, tagLength: 128 }, await keyFor(password, unhex(h.salt)), bytes.slice(12 + size)));
  } catch { throw Error("存档密码不正确，或文件已损坏；本机数据未改动"); }
}
export function cloudUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw Error("请填写有效的HTTPS云服务地址"); }
  const devLocal = import.meta.env.DEV && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((!devLocal && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) throw Error("云服务地址必须使用HTTPS，且不能带账号、参数或片段");
  return url.href.replace(/\/$/, "");
}
async function readBytes(r: Response, max: number) {
  if (Number(r.headers.get("Content-Length")) > max) throw Error("云端文件超过允许体积");
  if (!r.body) throw Error("云端响应为空");
  const reader = r.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > max) throw Error("云端文件超过允许体积"); chunks.push(value); }
  } catch (e) { await reader.cancel().catch(() => {}); throw e; }
  const result = new Uint8Array(size); let offset = 0;
  for (const b of chunks) { result.set(b, offset); offset += b.length; } return result;
}
const readJson = async (r: Response) => JSON.parse(decoder.decode(await readBytes(r, 128 * 1024)));
async function request<T>(c: CloudConnection, path: string, init: RequestInit, consume: (r: Response) => Promise<T>): Promise<T> {
  const timer = new AbortController(), timeout = setTimeout(() => timer.abort(), 60000);
  try {
    const response = await fetch(cloudUrl(c.url) + "/v1/backups" + path, { ...init, credentials: "omit", redirect: "error", cache: "no-store", signal: timer.signal,
      headers: { Authorization: "Bearer " + c.token, ...init.headers } });
    if (!response.ok) {
      const errors: Record<number, string> = { 401: "云连接密钥无效，请重新连接", 403: "云服务不允许此客户端访问", 404: "存档已不存在，请刷新列表", 409: "同名存档内容冲突，原存档保留", 413: "云存档超过服务体积限制", 507: "云端存档数量或空间已满，请先导出并删除旧存档" };
      throw Error(errors[response.status] || `云服务返回错误（${response.status}），本机记录保留`);
    }
    return await consume(response);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw Error("云连接超时，请检查网络后重试；本机记录保留");
    if (e instanceof TypeError) throw Error("无法连接云服务，请检查网络、地址和服务配置；本机记录保留");
    throw e;
  } finally { clearTimeout(timeout); }
}
export async function listCloud(c: CloudConnection): Promise<CloudItem[]> {
  const body = await request(c, "", {}, readJson);
  if (body.format !== "cijian-cloud" || body.version !== 1 || !Array.isArray(body.items) || body.items.length > 100) throw Error("云服务返回的存档列表无效");
  for (const item of body.items) if (!/^[a-f0-9-]{36}$/.test(item.id) || !Number.isFinite(Date.parse(item.created)) || typeof item.deviceName !== "string" || typeof item.appVersion !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isInteger(item.bytes) || item.bytes <= 0 || item.bytes > MAX_CLOUD_BYTES) throw Error("云存档信息无效");
  return body.items;
}
export async function uploadCloud(c: CloudConnection, id: string, bytes: Uint8Array) {
  const digest = await sha256(bytes);
  const result = await request(c, "/" + id, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "X-Content-SHA256": digest }, body: bytes as BodyInit }, readJson) as CloudItem;
  if (result.id !== id || result.sha256 !== digest || result.bytes !== bytes.length) throw Error("云端未正确确认存档，请刷新检查，尚未标记备份成功");
  return result;
}
export async function downloadCloud(c: CloudConnection, item: CloudItem) {
  const bytes = await request(c, "/" + item.id, {}, r => readBytes(r, MAX_CLOUD_BYTES));
  if (bytes.length !== item.bytes || bytes.length > MAX_CLOUD_BYTES || await sha256(bytes) !== item.sha256) throw Error("云存档下载校验失败，本机数据未改动");
  return bytes;
}
export const deleteCloud = async (c: CloudConnection, id: string) => { await request(c, "/" + id, { method: "DELETE" }, async () => undefined); };
