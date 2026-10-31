import { openDB } from "idb";
import { useSyncExternalStore } from "react";
import { Data, Media, emptyData } from "./types";
import { installBuiltin } from "./builtin";
import { scheduler } from "./scheduler";
import { createSave, inspectSave } from "./archive";
import { deviceInfo, saveRecovery } from "./vault";
import { backup } from "./library";
const db = openDB("cijian-local-v1", 2, {
  upgrade(db) {
    if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
    if (!db.objectStoreNames.contains("media")) db.createObjectStore("media");
  },
});
let data: Data = emptyData();
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();
export const mediaBytes = (m: Media) =>
  m.bytes ??
  Math.max(
    0,
    Math.floor(((m.data.split(",")[1]?.length || 0) * 3) / 4) -
      (m.data.endsWith("==") ? 2 : m.data.endsWith("=") ? 1 : 0),
  );
const metadata = (m: Media): Media => ({
  ...m,
  bytes: mediaBytes(m),
  data: "",
});
export const ready = db.then(async (d) => {
  data = (await d.get("state", "root")) || emptyData();
  const installed = await installBuiltin(data);
  if (installed || data.media.some((m) => m.data)) {
    const tx = d.transaction(["state", "media"], "readwrite");
    for (const m of data.media)
      if (m.data) tx.objectStore("media").put(m, m.id);
    data.media = data.media.map(metadata);
    tx.objectStore("state").put(data, "root");
    await tx.done;
  }
  await scheduler(data.settings.retention);
  listeners.forEach((f) => f());
});
export function mutate(fn: (draft: Data) => void): Promise<void> {
  const op = queue.then(async () => {
    await ready;
    const draft = structuredClone(data);
    fn(draft);
    const tx = (await db).transaction(["state", "media"], "readwrite");
    for (const m of draft.media)
      if (m.data)
        tx.objectStore("media").put({ ...m, bytes: mediaBytes(m) }, m.id);
    const retained = new Set(draft.media.map((m) => m.id));
    for (const m of data.media)
      if (!retained.has(m.id)) tx.objectStore("media").delete(m.id);
    draft.media = draft.media.map(metadata);
    tx.objectStore("state").put(draft, "root");
    await tx.done;
    data = draft;
    listeners.forEach((f) => f());
  });
  queue = op.catch(() => {});
  return op;
}
export const replaceData = (next: Data) =>
  mutate((d) => {
    Object.keys(d).forEach((k) => delete (d as any)[k]);
    Object.assign(d, next);
  });
export const getData = () => data;
/** Preserve the current full archive durably before the atomic active-data replacement. */
export function restoreWithRecovery(next: Data, expected = data): Promise<void> {
  const op = queue.then(async () => {
    await ready;
    if (data !== expected) throw Error("本机数据已有变化，请重新预览后恢复");
    // Validate callers too, not only file selection. No writes on malformed input.
    const validated = (await inspectSave(backup(next))).data;
    const recovery = await createSave(await hydrateMedia(data), await deviceInfo());
    try { await saveRecovery(recovery); }
    catch { throw Error("无法保存本机保护备份，可能存储空间不足；恢复已停止，当前数据未改动"); }
    const draft = structuredClone(validated), tx = (await db).transaction(["state", "media"], "readwrite");
    try {
      await tx.objectStore("media").clear();
      for (const m of draft.media) tx.objectStore("media").put(m, m.id);
      draft.media = draft.media.map(metadata);
      tx.objectStore("state").put(draft, "root");
      await tx.done;
    } catch {
      try { tx.abort(); } catch { /* An IndexedDB error may already have aborted it. */ }
      await tx.done.catch(() => {});
      throw Error("恢复写入失败，当前记录和媒体未替换，保护备份已保留");
    }
    data = draft;
    listeners.forEach(f => f());
  });
  queue = op.catch(() => {});
  return op;
}
export async function getMedia(id: string): Promise<Media | undefined> {
  await ready;
  return (await db).get("media", id);
}
export async function hydrateMedia(d: Data, deckId?: string): Promise<Data> {
  const copy = structuredClone(d);
  let ids: Set<string | undefined> | undefined;
  if (deckId) {
    const entries = new Set(
      d.links.filter((l) => l.deckId === deckId).map((l) => l.entryId),
    );
    ids = new Set(
      d.entries
        .filter((e) => entries.has(e.id))
        .flatMap((e) => [
          e.audio,
          e.audioUS,
          e.audioUK,
          ...e.senses.map((s) => s.image),
        ]),
    );
  }
  copy.media = await Promise.all(
    copy.media
      .filter((m) => !ids || ids.has(m.id))
      .map(async (m) => {
        if (m.data) return m;
        const payload = await getMedia(m.id);
        if (!payload?.data) throw Error("本地媒体缺失，无法生成完整导出");
        return payload;
      }),
  );
  return copy;
}
export function useData() {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    () => data,
  );
}
