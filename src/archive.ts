import { zipSync, strToU8, strFromU8 } from "fflate";
import { backup, readBackup, unpack, MAX_ARCHIVE } from "./library";
import { Data } from "./types";
import { APP_VERSION } from "./version";

export interface SaveManifest {
  format: "cijian-save"; version: 1; created: string; appVersion: string;
  deviceId: string; deviceName: string;
  summary: ReturnType<typeof saveSummary>;
  files: Record<string, { bytes: number; sha256: string }>;
}
export interface SavePreview { data: Data; manifest?: SaveManifest }
export function saveSummary(d: Data) {
  return { decks: d.decks.length, entries: d.entries.length, cards: d.cards.length,
    reviews: d.logs.filter(l => !l.undone).length, exams: d.exams.length,
    media: d.media.length, notes: d.notes.length,
    paused: [d.study, ...Object.values(d.pausedStudies || {})].filter(s => s && s.index < s.ids.length).length };
}
export async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function createSave(d: Data, device: { id: string; name: string }): Promise<Uint8Array> {
  const files = unpack(backup(d));
  const hashes: SaveManifest["files"] = {};
  for (const [name, bytes] of Object.entries(files)) hashes[name] = { bytes: bytes.length, sha256: await sha256(bytes) };
  const manifest: SaveManifest = { format: "cijian-save", version: 1, created: new Date().toISOString(),
    appVersion: APP_VERSION, deviceId: device.id, deviceName: device.name.slice(0, 80), summary: saveSummary(d), files: hashes };
  files["save-manifest.json"] = strToU8(JSON.stringify(manifest));
  const zip = zipSync(files);
  if (zip.length > MAX_ARCHIVE) throw Error("存档超过50 MB限制，请保留原设备并分词库导出");
  return zip;
}
export async function inspectSave(bytes: Uint8Array): Promise<SavePreview> {
  const files = unpack(bytes);
  let manifest: SaveManifest | undefined;
  if (files["save-manifest.json"]) {
    manifest = JSON.parse(strFromU8(files["save-manifest.json"]));
    if (!manifest || manifest.format !== "cijian-save" || manifest.version !== 1 ||
      !Number.isFinite(Date.parse(manifest.created)) || typeof manifest.appVersion !== "string" ||
      typeof manifest.deviceId !== "string" || typeof manifest.deviceName !== "string" ||
      !manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) throw Error("存档清单无效或版本不受支持");
    const names = Object.keys(files).filter(n => n !== "save-manifest.json");
    if (names.length !== Object.keys(manifest.files).length || !manifest.files["backup.json"]) throw Error("存档文件清单不完整");
    for (const name of names) {
      const expected = manifest.files[name];
      if (!expected || expected.bytes !== files[name].length || expected.sha256 !== await sha256(files[name])) throw Error("存档完整性校验失败：" + name);
    }
  }
  const data = readBackup(bytes);
  if (manifest && JSON.stringify(manifest.summary) !== JSON.stringify(saveSummary(data))) throw Error("存档摘要与实际内容不一致");
  return { data, manifest };
}
