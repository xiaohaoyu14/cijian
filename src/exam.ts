import {
  Data,
  Entry,
  ExamConfig,
  ExamItem,
  ExamSession,
  QuestionType,
  TYPE_LABEL,
  cardOf,
  norm,
  noteOf,
  uid,
} from "./types";
export const types: QuestionType[] = [
  "en-zh",
  "zh-en",
  "en-choice",
  "zh-choice",
];
export function pool(d: Data, c: ExamConfig) {
  if (c.entryIds) return d.entries.filter((e) => c.entryIds!.includes(e.id));
  const ids = new Set(
    d.links
      .filter((l) => !c.decks.length || c.decks.includes(l.deckId))
      .map((l) => l.entryId),
  );
  const wrong = new Set(
    d.exams
      .filter((e) => e.state === "submitted")
      .flatMap((e) =>
        e.items
          .filter((i) => e.answers[i.id]?.status === "wrong")
          .map((i) => i.entryId),
      ),
  );
  return d.entries.filter(
    (e) =>
      ids.has(e.id) &&
      (c.scope !== "learned" || !!cardOf(d, e.id)) &&
      (c.scope !== "favorites" || noteOf(d, e.id).favorite) &&
      (c.scope !== "wrong" || wrong.has(e.id)) &&
      (c.scope !== "tag" || e.tags.includes(c.tag)),
  );
}
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const meaningSet = (e: Entry) =>
  new Set(
    e.senses
      .flatMap((s) =>
        [s.zh, ...s.acceptedZh].flatMap((z) =>
          z.split(/[；;、，,\/]/).map(norm),
        ),
      )
      .filter(Boolean),
  );
const intersects = (a: Set<string>, b: Set<string>) =>
  [...a].some((s) => b.has(s));
function choices(e: Entry, all: Entry[], type: QuestionType): string[] | null {
  const s = e.senses[0],
    own = meaningSet(e),
    correct = type === "en-choice" ? s.zh : e.word;
  // Conservative choice generation: same POS, disjoint authored meanings and spellings.
  const meanings = [own],
    spellings = [new Set([norm(e.word), ...s.variants.map(norm)])],
    seen = new Set([norm(correct)]),
    options = [correct];
  for (const x of shuffle(all)) {
    if (x.id === e.id || norm(x.senses[0].pos) !== norm(s.pos)) continue;
    const zs = meaningSet(x),
      ws = new Set([
        norm(x.word),
        ...x.senses.flatMap((s) => s.variants.map(norm)),
      ]);
    const value = type === "en-choice" ? x.senses[0].zh : x.word;
    if (
      !value ||
      seen.has(norm(value)) ||
      meanings.some((m) => intersects(m, zs)) ||
      spellings.some((m) => intersects(m, ws))
    )
      continue;
    options.push(value);
    seen.add(norm(value));
    meanings.push(zs);
    spellings.push(ws);
    if (options.length === 4) return shuffle(options);
  }
  return null;
}
export function allocate(count: number, ratios: number[]): number[] {
  if (
    ratios.some((r) => !Number.isFinite(r) || r < 0) ||
    !ratios.some((r) => r > 0)
  )
    throw Error("混合比例需要非负数且合计大于零");
  const sum = ratios.reduce((a, b) => a + b, 0),
    raw = ratios.map((r) => (r / sum) * count),
    result = raw.map(Math.floor);
  const order = raw
    .map((r, i) => ({ i, frac: r - result[i] }))
    .sort((a, b) => b.frac - a.frac);
  const remain = count - result.reduce((a, b) => a + b, 0);
  for (let j = 0; j < remain; j++) result[order[j].i]++;
  return result;
}
export function createExam(
  d: Data,
  c: ExamConfig,
  override?: string[],
): ExamSession {
  let entries = pool(d, c);
  if (override) entries = d.entries.filter((e) => override.includes(e.id));
  if (!Number.isInteger(c.count) || c.count < 1 || c.count > 500)
    throw Error("题量请填写 1–500 的整数");
  if (c.count > entries.length)
    throw Error(
      `当前范围只有 ${entries.length} 个不同词条，请把题量调整到 ${entries.length} 或更少`,
    );
  if (!Number.isFinite(c.minutes) || c.minutes < 0 || c.minutes > 300)
    throw Error("限时请填写 0–300 分钟");
  const counts =
    c.type === "mixed"
      ? allocate(c.count, c.ratios)
      : types.map((t) => (t === c.type ? c.count : 0));
  const remaining = shuffle(entries),
    items: ExamItem[] = [];
  // Allocate constrained choice questions first; never duplicate entries to fill a paper.
  for (const ti of [2, 3, 0, 1]) {
    const type = types[ti];
    let made = 0;
    for (let n = remaining.length - 1; n >= 0 && made < counts[ti]; n--) {
      const e = remaining[n],
        sense = e.senses[0],
        options = ti >= 2 ? choices(e, entries, type) : [];
      if (!options) continue;
      const correct =
        type === "en-zh" || type === "en-choice" ? sense.zh : e.word;
      items.push({
        id: uid(),
        entryId: e.id,
        type,
        entry: structuredClone(e),
        sense: structuredClone(sense),
        prompt: type === "en-zh" || type === "en-choice" ? e.word : sense.zh,
        options,
        correct,
        accepted:
          type === "en-zh" || type === "en-choice"
            ? [sense.zh, ...sense.acceptedZh]
            : [e.word, ...sense.variants],
      });
      remaining.splice(n, 1);
      made++;
    }
    if (made < counts[ti])
      throw Error(
        `${TYPE_LABEL[type]} 的唯一选项素材不足（需要 ${counts[ti]}，可生成 ${made}）。请减少该题型比例，或增加同词性、释义明确的词条。`,
      );
  }
  const now = new Date();
  return {
    id: uid(),
    config: structuredClone(override ? { ...c, entryIds: [...override] } : c),
    items: shuffle(items),
    answers: {},
    state: "active",
    created: now.toISOString(),
    deadline:
      c.minutes > 0
        ? new Date(+now + c.minutes * 60000).toISOString()
        : undefined,
    index: 0,
  };
}
export function grade(item: ExamItem, value: string) {
  const normalize = (s: string) =>
    item.type === "zh-en" && item.entry.caseSensitive
      ? s.normalize("NFKC").trim()
      : norm(s);
  const v = normalize(value);
  if (!v) return "unanswered" as const;
  if (item.accepted.some((a) => normalize(a) === v)) return "correct" as const;
  return item.type === "en-zh" ? ("pending" as const) : ("wrong" as const);
}
export function submit(session: ExamSession) {
  if (session.state === "submitted") return;
  for (const item of session.items) {
    const a = session.answers[item.id];
    session.answers[item.id] = {
      itemId: item.id,
      value: a?.value || "",
      status: grade(item, a?.value || ""),
      method: "auto",
    };
  }
  session.state = "submitted";
  session.submitted = new Date().toISOString();
}
export function report(s: ExamSession) {
  const values = s.items.map((i) => s.answers[i.id]);
  const count = (status: string) =>
    values.filter((a) => a?.status === status).length;
  return {
    correct: count("correct"),
    wrong: count("wrong"),
    unanswered: count("unanswered"),
    pending: count("pending"),
    score: Math.round((count("correct") / s.items.length) * 100),
  };
}
