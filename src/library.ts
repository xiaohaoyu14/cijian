import Papa from "papaparse";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Card, Data, Deck, Entry, Media, norm, uid } from "./types";
export const MAX_ARCHIVE = 50 * 1024 * 1024,
  MAX_EXPANDED = 100 * 1024 * 1024,
  MAX_FILE = 10 * 1024 * 1024;
export type ImportRow = {
  entry: Entry;
  sourceId: string;
  target?: string;
  kind: "new" | "duplicate" | "conflict";
  choice: "keep" | "update" | "separate";
};
export interface ImportPreview {
  deck: Deck;
  rows: ImportRow[];
  media: Media[];
  errors: string[];
  missing: number;
  namespace: string;
}
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
const text = (x: unknown) => (typeof x === "string" ? x.trim() : "");
const strings = (x: unknown) =>
  Array.isArray(x)
    ? x
        .filter((v) => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean)
    : [];
export function safePath(p: string) {
  return (
    !!p &&
    !p.includes("\\") &&
    !p.includes(":") &&
    !p.startsWith("/") &&
    p.split("/").every((s) => s !== ".." && s !== "." && s !== "") &&
    !/[\x00-\x1f]/.test(p)
  );
}
export function unpack(bytes: Uint8Array) {
  assert(bytes.length <= MAX_ARCHIVE, "ZIP 最大为 50 MB");
  let total = 0,
    count = 0;
  return unzipSync(bytes, {
    filter(file) {
      assert(
        safePath(file.name.replace(/\/$/, "")),
        `非法 ZIP 路径：${file.name}`,
      );
      assert(++count <= 5000, "ZIP 文件数超过 5000");
      assert(file.originalSize <= MAX_FILE, `单文件超过 10 MB：${file.name}`);
      total += file.originalSize;
      assert(total <= MAX_EXPANDED, "ZIP 解压总量超过 100 MB");
      return !file.name.endsWith("/");
    },
  });
}
export const identity = (e: Entry) =>
  JSON.stringify([
    norm(e.word),
    e.senses
      .map((s) => [norm(s.pos), norm(s.zh)])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ]);
const content = (e: Entry) =>
  JSON.stringify({
    ...e,
    id: "",
    senses: e.senses.map((s) => ({
      ...s,
      id: "",
      examples: s.examples.map((ex) => ({ ...ex, id: "" })),
    })),
  });
export function validateEntry(raw: any, fallback?: string): Entry {
  assert(raw && typeof raw === "object", "词条必须为对象");
  const word = text(raw.word),
    id = text(raw.id) || fallback || "";
  assert(id && word && word.length <= 200, "词条需要稳定 id 和有效 word");
  assert(
    Array.isArray(raw.senses) &&
      raw.senses.length > 0 &&
      raw.senses.length <= 30,
    `${word} 需要 1–30 个 senses`,
  );
  const senseIds = new Set<string>();
  const senses = raw.senses.map((s: any, i: number) => {
    const zh = text(s.zh),
      sid = text(s.id) || `${id}:s${i + 1}`;
    assert(zh && zh.length <= 5000, `${word} 的义项缺少 zh`);
    assert(!senseIds.has(sid), `${word} 的义项 id 重复`);
    senseIds.add(sid);
    assert(
      s.image === undefined || safePath(text(s.image)),
      `${word} 的图片路径非法`,
    );
    return {
      id: sid,
      pos: text(s.pos),
      zh,
      acceptedZh: strings(s.acceptedZh),
      variants: strings(s.variants),
      examples: (Array.isArray(s.examples) ? s.examples : []).map(
        (ex: any, j: number) => ({
          id: text(ex.id) || `${sid}:ex${j}`,
          en: text(ex.en),
          zh: text(ex.zh),
        }),
      ),
      ...(s.image ? { image: s.image } : {}),
    };
  });
  for (const key of ["audio", "audioUS", "audioUK"])
    assert(
      raw[key] === undefined || safePath(text(raw[key])),
      `${word} 的音频路径非法`,
    );
  return {
    id,
    word,
    phonetic: text(raw.phonetic),
    senses,
    phrase: text(raw.phrase),
    tags: strings(raw.tags),
    ...(raw.audio ? { audio: raw.audio } : {}),
    ...(raw.audioUS ? { audioUS: raw.audioUS } : {}),
    ...(raw.audioUK ? { audioUK: raw.audioUK } : {}),
    caseSensitive: raw.caseSensitive === true,
  };
}
export function planImport(
  d: Data,
  deck: Deck,
  entries: Entry[],
  media: Media[],
  namespace: string,
  errors: string[] = [],
  missing = 0,
): ImportPreview {
  const ids = new Set<string>(),
    byId = new Map(d.entries.map((e) => [e.id, e])),
    byMeaning = new Map<string, Entry>();
  for (const e of d.entries) {
    const key = identity(e);
    if (!byMeaning.has(key)) byMeaning.set(key, e);
  }
  const rows = entries.map((entry) => {
    assert(!ids.has(entry.id), `词条 id 重复：${entry.id}`);
    ids.add(entry.id);
    const targetId = d.refs[`${namespace}:${entry.id}`];
    const meaningKey = identity(entry);
    const found =
      (targetId ? byId.get(targetId) : undefined) || byMeaning.get(meaningKey);
    const row: ImportRow = {
      entry,
      sourceId: entry.id,
      target: found?.id,
      kind: found
        ? content(found) === content({ ...entry, id: found.id })
          ? "duplicate"
          : "conflict"
        : "new",
      choice: "keep",
    };
    if (!found) {
      row.target = entry.id;
      byId.set(entry.id, entry);
      byMeaning.set(meaningKey, entry);
    }
    return row;
  });
  return { deck, rows, media, namespace, errors, missing };
}
const mimeFor = (p: string) =>
  ({
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
  })[p.split(".").pop()!.toLowerCase()] || "";
const base64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
};
const fromBase64 = (s: string) =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function parseImport(file: File, d: Data): Promise<ImportPreview> {
  assert(file.size <= MAX_ARCHIVE, "导入文件最大 50 MB");
  if (file.name.toLowerCase().endsWith(".csv")) {
    const parsed = Papa.parse<Record<string, string>>(await file.text(), {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
    });
    assert(
      parsed.meta.fields?.includes("word") &&
        parsed.meta.fields?.includes("meaning_zh"),
      "CSV 缺少 word 或 meaning_zh 表头",
    );
    const errors = parsed.errors.map(
        (e) => `第 ${(e.row || 0) + 2} 行：${e.message}`,
      ),
      entries: Entry[] = [];
    assert(parsed.data.length <= 10000, "每次最多导入 10000 条");
    const csvIds = new Set<string>();
    parsed.data.forEach((r, i) => {
      if (!r.word?.trim() || !r.meaning_zh?.trim()) {
        errors.push(`第 ${i + 2} 行 word 和 meaning_zh 必填`);
        return;
      }
      const e = validateEntry({
        id: uid(),
        word: r.word,
        phonetic: r.phonetic,
        senses: [
          {
            pos: r.part_of_speech,
            zh: r.meaning_zh,
            examples: r.example_en
              ? [{ en: r.example_en, zh: r.example_zh }]
              : [],
          },
        ],
        phrase: r.phrase,
        tags: r.tags?.split(/[;；|]/),
      });
      e.id = "csv:" + encodeURIComponent(identity(e));
      e.senses[0].id = e.id + ":s1";
      if (!csvIds.has(e.id)) { entries.push(e); csvIds.add(e.id); }
    });
    const name = file.name.replace(/\.csv$/i, "");
    return planImport(
      d,
      {
        id: "csv-deck:" + name,
        name,
        author: "",
        version: "1",
        language: "en",
        source: "CSV 导入",
        license: "由导入者确认",
        tags: [],
      },
      entries,
      [],
      "csv:" + name,
      errors,
    );
  }
  assert(file.name.toLowerCase().endsWith(".zip"), "请选择 CSV 或 ZIP 文件");
  const files = unpack(new Uint8Array(await file.arrayBuffer()));
  assert(
    files["manifest.json"] && files["entries.json"],
    "ZIP 缺少 manifest.json 或 entries.json",
  );
  const m = JSON.parse(strFromU8(files["manifest.json"]));
  assert(
    ["id", "name", "author", "version", "language", "source", "license"].every(
      (k) => typeof m[k] === "string" && m[k].trim(),
    ),
    "manifest 的 id、name、author、version、language、source、license 必须填写",
  );
  const raw = JSON.parse(strFromU8(files["entries.json"]));
  assert(
    Array.isArray(raw) && raw.length <= 10000,
    "entries.json 需要数组，最多 10000 条",
  );
  const namespace = m.id,
    media: Media[] = [],
    errors: string[] = [],
    paths = new Map<string, string>();
  for (const [path, bytes] of Object.entries(files)) {
    if (path === "entries.json" || path === "manifest.json") continue;
    assert(/^(images|audio)\//.test(path), `不支持的 ZIP 文件：${path}`);
    const mime = mimeFor(path);
    assert(
      mime && mime.startsWith(path.startsWith("images/") ? "image/" : "audio/"),
      `不支持的媒体类型：${path}`,
    );
    const id = `media:${namespace}:${uid()}`;
    paths.set(path, id);
    media.push({
      id,
      path,
      type: mime,
      data: `data:${mime};base64,${base64(bytes)}`,
    });
  }
  let missing = 0;
  const reference = (p: string | undefined, kind: "image" | "audio") => {
    if (!p) return undefined;
    assert(
      safePath(p) && p.startsWith(kind === "image" ? "images/" : "audio/"),
      "媒体引用必须位于对应目录",
    );
    if (!paths.has(p)) {
      missing++;
      return undefined;
    }
    return paths.get(p);
  };
  const entries = raw.map((r) => {
    const e = validateEntry(r);
    e.audio = reference(e.audio, "audio");
    e.audioUS = reference(e.audioUS, "audio");
    e.audioUK = reference(e.audioUK, "audio");
    e.senses.forEach((s) => (s.image = reference(s.image, "image")));
    return e;
  });
  return planImport(
    d,
    { ...m, id: "zip-deck:" + namespace, tags: strings(m.tags) },
    entries,
    media,
    namespace,
    errors,
    missing,
  );
}
export function commitImport(d: Data, p: ImportPreview) {
  assert(!p.errors.length, "请修复全部错误后重新导入");
  assert(p.rows.length, "词库为空");
  const deckIndex = d.decks.findIndex((x) => x.id === p.deck.id);
  if (deckIndex < 0) d.decks.push(p.deck);
  else d.decks[deckIndex] = p.deck;
  const remapped = new Map<string, string>(),
    byId = new Map(d.entries.map((e, index) => [e.id, { entry: e, index }])),
    linked = new Set(d.links.filter((l) => l.deckId === p.deck.id).map((l) => l.entryId));
  for (const row of p.rows) {
    let id = remapped.get(row.target || "") || row.target;
    const found = id ? byId.get(id) : undefined, existing = found?.entry;
    if (row.kind === "conflict" && row.choice === "separate") id = uid();
    if (!existing || row.choice === "separate") {
      id = uid();
      const added = { ...row.entry, id };
      byId.set(id, { entry: added, index: d.entries.length });
      d.entries.push(added);
      if (row.kind !== "conflict" || row.choice !== "separate")
        remapped.set(row.entry.id, id);
    } else if (row.kind === "conflict" && row.choice === "update") {
      const updated = { ...row.entry, id: existing.id };
      d.entries[found!.index] = updated;
      byId.set(existing.id, { entry: updated, index: found!.index });
    }
    d.refs[`${p.namespace}:${row.sourceId}`] = id!;
    if (!linked.has(id!)) {
      d.links.push({ deckId: p.deck.id, entryId: id! });
      linked.add(id!);
    }
  }
  d.media.push(...p.media);
  const used = new Set(
    d.entries
      .flatMap((e) => [
        e.audio,
        e.audioUS,
        e.audioUK,
        ...e.senses.map((s) => s.image),
      ])
      .filter(Boolean),
  );
  d.media = d.media.filter((m) => used.has(m.id));
}
export function deckArchive(d: Data, deckId: string) {
  const deck = d.decks.find((x) => x.id === deckId)!;
  const ids = new Set(
    d.links.filter((l) => l.deckId === deckId).map((l) => l.entryId),
  );
  const files: Record<string, Uint8Array> = {};
  const paths = new Map<string, string>();
  const use = (id?: string) => {
    if (!id) return undefined;
    const m = d.media.find((m) => m.id === id);
    if (!m) return undefined;
    if (!paths.has(id)) {
      const p = `${m.type.startsWith("image") ? "images" : "audio"}/${paths.size}.${m.path.split(".").pop()}`;
      paths.set(id, p);
      files[p] = fromBase64(m.data.split(",")[1]);
    }
    return paths.get(id);
  };
  const entries = d.entries
    .filter((e) => ids.has(e.id))
    .map((e) => ({
      ...e,
      audio: use(e.audio),
      audioUS: use(e.audioUS),
      audioUK: use(e.audioUK),
      senses: e.senses.map((s) => ({ ...s, image: use(s.image) })),
    }));
  files["manifest.json"] = strToU8(
    JSON.stringify(
      {
        ...deck,
        id: deck.id,
        author: deck.author || "本地用户",
        source: deck.source || "用户创建",
        license: deck.license || "由分享者确认",
      },
      null,
      2,
    ),
  );
  files["entries.json"] = strToU8(JSON.stringify(entries, null, 2));
  return zipSync(files);
}
export async function download(
  name: string,
  bytes: Uint8Array | string,
  mime = "application/zip",
) {
  const raw = typeof bytes === "string" ? strToU8(bytes) : bytes;
  if (Capacitor.isNativePlatform()) {
    const f = await Filesystem.writeFile({
      path: name,
      data: base64(raw),
      directory: Directory.Cache,
    });
    await Share.share({ title: name, url: f.uri });
    return;
  }
  const url = URL.createObjectURL(new Blob([raw as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function backup(d: Data) {
  const files: Record<string, Uint8Array> = {},
    copy = structuredClone(d);
  let total = 0;
  copy.media.forEach((m, i) => {
    const bytes = fromBase64(m.data.split(",")[1]);
    assert(bytes.length <= MAX_FILE, "备份媒体超过单文件 10 MB 限制");
    files[`media-data/${i}.bin`] = bytes;
    total += bytes.length;
    m.data = "";
  });
  const json = strToU8(
    JSON.stringify({ format: "cijian-backup", version: 1, data: copy }),
  );
  assert(
    json.length <= MAX_FILE,
    "备份记录超过 10 MB，请分词库导出内容并保留原设备",
  );
  total += json.length;
  assert(total <= MAX_EXPANDED, "备份超过 100 MB 限制");
  files["backup.json"] = json;
  const zip = zipSync(files);
  assert(zip.length <= MAX_ARCHIVE, "备份压缩后超过 50 MB 限制");
  return zip;
}
export function readBackup(bytes: Uint8Array): Data {
  const files = unpack(bytes);
  assert(files["backup.json"], "不是词间完整备份");
  const b = JSON.parse(strFromU8(files["backup.json"]));
  assert(
    b.format === "cijian-backup" && b.version === 1 && b.data?.schema === 1,
    "备份版本不受支持",
  );
  const d = b.data as Data;
  for (const k of [
    "decks",
    "entries",
    "links",
    "media",
    "cards",
    "logs",
    "notes",
    "exams",
  ] as const)
    assert(Array.isArray(d[k]), `备份缺少 ${k}`);
  d.media.forEach((m, i) => {
    if (m.data === "") {
      const bytes = files[`media-data/${i}.bin`];
      assert(bytes, `备份缺少媒体 ${i}`);
      m.data = `data:${m.type};base64,${base64(bytes)}`;
    }
  });
  assert(
    d.settings &&
      Number.isInteger(d.settings.daily) &&
      d.settings.daily >= 1 &&
      d.settings.daily <= 200 &&
      d.settings.retention >= 0.7 &&
      d.settings.retention <= 0.97,
    "设置数据无效",
  );
  assert(
    d.refs && typeof d.refs === "object" && !Array.isArray(d.refs),
    "备份引用无效",
  );
  const unique = (rows: { id: string }[]) => {
    assert(
      rows.every((r) => r && typeof r.id === "string" && r.id),
      "实体缺少 id",
    );
    assert(new Set(rows.map((r) => r.id)).size === rows.length, "实体 id 重复");
  };
  [d.decks, d.entries, d.media, d.cards, d.logs, d.exams].forEach(unique);
  const entryIds = new Set(d.entries.map((e) => e.id)),
    deckIds = new Set(d.decks.map((e) => e.id));
  d.entries.forEach((e) => {
    validateEntry({
      ...e,
      audio: undefined,
      audioUS: undefined,
      audioUK: undefined,
      senses: e.senses.map((s) => ({ ...s, image: undefined })),
    });
  });
  assert(
    d.links.every((l) => entryIds.has(l.entryId) && deckIds.has(l.deckId)),
    "备份词库关联损坏",
  );
  assert(
    new Set(d.cards.map((c) => `${c.entryId}:${c.direction}`)).size ===
      d.cards.length,
    "重复学习卡片",
  );
  d.cards.forEach((c) =>
    assert(
      entryIds.has(c.entryId) &&
        c.direction === "en-zh" &&
        Number.isFinite(new Date(c.fsrs.dueAt).getTime()) &&
        typeof c.fsrs.stability === "number" &&
        typeof c.fsrs.difficulty === "number",
      "卡片数据损坏",
    ),
  );
  d.notes.forEach((n) =>
    assert(
      entryIds.has(n.entryId) && typeof n.text === "string",
      "笔记数据损坏",
    ),
  );
  d.media.forEach((m) =>
    assert(
      /^data:(image\/(png|jpeg|webp|gif)|audio\/(mpeg|wav|ogg|mp4));base64,[A-Za-z0-9+/=]+$/.test(
        m.data,
      ),
      "媒体数据不受支持",
    ),
  );
  const mediaIds = new Set(d.media.map((m) => m.id));
  d.entries.forEach((e) =>
    [e.audio, e.audioUS, e.audioUK, ...e.senses.map((s) => s.image)]
      .filter(Boolean)
      .forEach((id) => assert(mediaIds.has(id!), "缺失备份媒体")),
  );
  d.logs.forEach((l) =>
    assert(
      entryIds.has(l.entryId) &&
        l.before &&
        l.after &&
        [1, 2, 3, 4].includes(l.rating) &&
        Number.isFinite(Date.parse(l.at)),
      "复习记录损坏",
    ),
  );
  d.exams.forEach((e) => {
    if (e.config?.entryIds)
      assert(
        Array.isArray(e.config.entryIds) &&
          e.config.entryIds.every((id) => entryIds.has(id)) &&
          new Set(e.config.entryIds).size === e.config.entryIds.length,
        "考试固定范围损坏",
      );
    assert(
      ["active", "submitted"].includes(e.state) &&
        e.config &&
        Array.isArray(e.items) &&
        e.items.length > 0 &&
        e.answers &&
        Number.isFinite(Date.parse(e.created)) &&
        (!e.deadline || Number.isFinite(Date.parse(e.deadline))),
      "考试记录损坏",
    );
    unique(e.items);
    assert(
      new Set(e.items.map((i) => i.entryId)).size === e.items.length,
      "试卷重复词条",
    );
    e.items.forEach((i) =>
      assert(
        i.entry &&
          i.sense &&
          Array.isArray(i.options) &&
          typeof i.correct === "string",
        "考试快照损坏",
      ),
    );
  });
  assert(d.settings.reviewBatch === undefined || [0, 20, 50].includes(d.settings.reviewBatch), "复习分批设置无效");
  assert(d.settings.studyDeckId === undefined || typeof d.settings.studyDeckId === "string", "学习词库设置无效");
  const logIds = new Set(d.logs.map(log => log.id));
  for (const study of [d.study, ...Object.values(d.pausedStudies || {})].filter(
    Boolean,
  )) {
    assert(
      study &&
        (study.id === undefined || (typeof study.id === "string" && !!study.id)) &&
          (study.newReviewOf === undefined || (study.mode === "review" && !study.custom && typeof study.newReviewOf === "string" && !!study.newReviewOf)) &&
        Array.isArray(study.ids) &&
        study.ids.every((id) => entryIds.has(id)) &&
        Number.isInteger(study.index) &&
        study.index >= 0 &&
        study.index <= study.ids.length &&
        ["new", "review", "reinforce"].includes(study.mode) &&
        (study.deckId === undefined || typeof study.deckId === "string") &&
        (study.custom === undefined || typeof study.custom === "boolean") &&
        (study.reviewLogIds === undefined || (Array.isArray(study.reviewLogIds) && study.reviewLogIds.every(id => typeof id === "string" && logIds.has(id)))),
      "学习队列损坏",
    );
  }
  return d;
}
export const csvTemplate =
  "\uFEFFword,phonetic,part_of_speech,meaning_zh,phrase,example_en,example_zh,tags\nheritage,/ˈherɪtɪdʒ/,n.,遗产,cultural heritage,We should protect our cultural heritage.,我们应该保护文化遗产。,四级;传统文化\n";
