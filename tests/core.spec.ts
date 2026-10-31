import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { selectStudy, studyKey, selectedStudyDeck } from "../src/learning";
import { zipSync, strToU8 } from "fflate";
import { emptyData, Entry, uid, cardOf, isDue } from "../src/types";
import { addDemo } from "../src/demo";
import { allocate, createExam, grade, report, submit } from "../src/exam";
import { applyRating, rate, undoRating } from "../src/scheduler";
import {
  backup,
  commitImport,
  deckArchive,
  parseImport,
  planImport,
  readBackup,
  unpack,
} from "../src/library";
const fixture = () => {
  const d = emptyData();
  addDemo(d);
  return d;
};
test("新词与复习可切换，独立暂停队列进入完整备份", async () => {
  const d = fixture();
  selectStudy(d, "new");
  const id = d.study!.ids[0];
  applyRating(d, await rate(d, id, 1));
  d.cards[0].fsrs.dueAt = new Date(Date.now() - 1000);
  selectStudy(d, "review");
  expect(d.study!.mode).toBe("review");
  expect(d.study!.ids).toEqual([id]);
  expect(d.pausedStudies![studyKey("new", selectedStudyDeck(d))]!.index).toBe(1);
  const restored = readBackup(backup(d));
  selectStudy(restored, "new");
  expect(restored.study!.index).toBe(1);
  expect(restored.study!.ids).toHaveLength(20);
  expect(restored.pausedStudies![studyKey("review", selectedStudyDeck(restored))]!.ids).toEqual([id]);
  const before = structuredClone(restored);
  expect(() => selectStudy(restored, "reinforce")).toThrow();
  expect(restored).toEqual(before);
});
test("少量错词可切换填写题，并且同范围新卷仍只抽原错词", () => {
  const d = fixture(),
    old = createExam(d, { ...config, count: 3, type: "en-choice" });
  d.exams.push(old);
  const ids = old.items.map((i) => i.entryId),
    saved = structuredClone(old);
  const fixed = { ...old.config, entryIds: ids };
  expect(() => createExam(d, fixed)).toThrow("素材不足");
  const retried = createExam(d, { ...fixed, type: "zh-en" });
  expect(retried.config.entryIds).toEqual(ids);
  expect(new Set(retried.items.map((i) => i.entryId))).toEqual(new Set(ids));
  const next = createExam(d, retried.config);
  expect(new Set(next.items.map((i) => i.entryId))).toEqual(new Set(ids));
  expect(d.exams[0]).toEqual(saved);
  expect(retried.id).not.toBe(old.id);
});
const config = {
  decks: [],
  scope: "all",
  tag: "",
  count: 50,
  type: "mixed" as const,
  ratios: [25, 25, 25, 25],
  minutes: 10,
  practice: false,
};
test("内置图文ZIP结构可用", async () => {
  const d = emptyData(),
    bytes = readFileSync("public/sample-media.pack");
  const p = await parseImport(new File([bytes], "sample.zip"), d);
  expect(p.media).toHaveLength(8);
  expect(p.missing).toBe(0);
  commitImport(d, p);
  expect(readBackup(backup(d))).toEqual(d);
});
test("示例只包含120条内容，不包含个人进度", () => {
  const d = fixture();
  expect(d.entries.length).toBe(120);
  expect(d.cards).toHaveLength(0);
  expect(d.logs).toHaveLength(0);
  expect(d.exams).toHaveLength(0);
});
test("50/100词混合考试每词一道题，选项唯一，正确答案可判分", () => {
  const d = fixture();
  for (const count of [50, 100]) {
    const e = createExam(d, { ...config, count });
    expect(e.items).toHaveLength(count);
    expect(new Set(e.items.map((i) => i.entryId)).size).toBe(count);
    for (const i of e.items) {
      expect(grade(i, i.correct)).toBe("correct");
      if (i.options.length) {
        expect(new Set(i.options).size).toBe(4);
        expect(i.options.filter((o) => o === i.correct)).toHaveLength(1);
      }
    }
  }
});
test("词数不足不静默重复，选项素材不足不生成无效题", () => {
  const d = fixture();
  expect(() => createExam(d, { ...config, count: 121 })).toThrow("120");
  d.entries = d.entries.slice(0, 2);
  d.links = d.links.filter((l) => d.entries.some((e) => e.id === l.entryId));
  expect(() =>
    createExam(d, { ...config, count: 2, type: "en-choice" }),
  ).toThrow("素材不足");
});
test("比例按最大余数取整，总题数一致", () => {
  expect(allocate(50, [25, 25, 25, 25])).toEqual([13, 13, 12, 12]);
  for (let n = 1; n < 130; n++)
    expect(allocate(n, [20, 30, 40, 10]).reduce((a, b) => a + b, 0)).toBe(n);
  expect(() => allocate(50, [0, 0, 0, 0])).toThrow();
});
test("中文答案只精确匹配可接受答案，其余待确认", () => {
  const d = fixture(),
    e = createExam(d, { ...config, count: 1, type: "en-zh" }),
    i = e.items[0];
  expect(grade(i, "错误前缀" + i.correct)).toBe("pending");
  expect(grade(i, "")).toBe("unanswered");
  i.accepted.push("同义答案");
  expect(grade(i, "同义答案")).toBe("correct");
});
test("拼写规则仅接受已配置变体，相近拼写判错", () => {
  const e = createExam(fixture(), { ...config, count: 1, type: "zh-en" }),
    i = e.items[0];
  expect(grade(i, "  " + i.correct.toUpperCase() + " ")).toBe("correct");
  expect(grade(i, i.correct + "s")).toBe("wrong");
  i.entry.caseSensitive = true;
  expect(grade(i, i.correct.toUpperCase())).toBe("wrong");
  i.accepted.push("explicit-variant");
  expect(grade(i, "explicit-variant")).toBe("correct");
});
test("提交区分未答、待确认，考试不修改FSRS", () => {
  const d = fixture(),
    e = createExam(d, { ...config, count: 4, type: "en-zh" });
  e.items.slice(0, 2).forEach(
    (i, j) =>
      (e.answers[i.id] = {
        itemId: i.id,
        value: j ? i.correct : "不确定同义词",
        status: "pending",
        method: "auto",
      }),
  );
  d.exams.push(e);
  submit(e);
  expect(report(e)).toEqual({
    correct: 1,
    wrong: 0,
    unanswered: 2,
    pending: 1,
    score: 25,
  });
  expect(d.cards).toHaveLength(0);
});
test("考试快照、答案、选项和截止时间经过备份恢复固定，词条更新不影响快照", () => {
  const d = fixture(),
    e = createExam(d, config);
  d.exams.push(e);
  e.answers[e.items[0].id] = {
    itemId: e.items[0].id,
    value: "作答快照",
    status: "pending",
    method: "auto",
  };
  const restored = readBackup(backup(d));
  expect(restored.exams).toEqual(d.exams);
  d.entries.find((x) => x.id === e.items[0].entryId)!.word = "modified";
  expect(e.items[0].entry.word).not.toBe("modified");
});
test("FSRS实际到期，忘记进入短期学习，撤销恢复初始状态，重复方向共用卡片", async () => {
  const d = fixture(),
    id = d.entries[0].id,
    now = new Date("2026-10-29T01:00:00Z");
  d.study = { ids: [id], index: 0, mode: "new" };
  const log = await rate(d, id, 1, now);
  applyRating(d, log);
  expect(d.cards).toHaveLength(1);
  expect(cardOf(d, id)!.fsrs.reps).toBe(1);
  expect(cardOf(d, id)!.fsrs.scheduleStatus).toBe("learning");
  expect(isDue(d.cards[0], +now)).toBe(false);
  expect(isDue(d.cards[0], +now + 120000)).toBe(true);
  undoRating(d);
  expect(d.cards).toHaveLength(0);
  expect(d.study.index).toBe(0);
  expect(d.logs[0].undone).toBe(true);
  const next = await rate(d, id, 3, now);
  applyRating(d, next);
  const before = structuredClone(d.cards[0]);
  const log2 = await rate(d, id, 1, new Date(+now + 86400000));
  applyRating(d, log2);
  expect(d.cards).toHaveLength(1);
  undoRating(d);
  expect(d.cards[0]).toEqual(before);
});
test("JSON恢复后FSRS使用实际经过时间调度并保留日志版本", async () => {
  const d = fixture(),
    id = d.entries[0].id;
  applyRating(d, await rate(d, id, 3, new Date("2026-10-01")));
  const restored = readBackup(backup(d));
  const log = await rate(restored, id, 1, new Date("2026-10-29"));
  expect(log.scheduler).toContain("6.0.0");
  expect(log.raw.reviewTime).toEqual(new Date("2026-10-29"));
  expect(+new Date(log.after.fsrs.dueAt)).toBeGreaterThan(
    +new Date("2026-10-29"),
  );
});
test("CSV引号解析、多词库共享同卡片、更新保留笔记与历史", async () => {
  const d = fixture();
  const csv =
    'word,part_of_speech,meaning_zh,example_en\nunique,n.,唯一性,"An example, with a comma."';
  const p = await parseImport(new File([csv], "one.csv"), d);
  expect(p.rows[0].entry.senses[0].examples[0].en).toContain(",");
  commitImport(d, p);
  const id = d.refs["csv:one:" + p.rows[0].sourceId];
  await applyRating(d, await rate(d, id, 3));
  d.notes.push({
    entryId: id,
    text: "我的笔记",
    favorite: true,
    reinforce: false,
  });
  const p2 = await parseImport(new File([csv], "two.csv"), d);
  commitImport(d, p2);
  expect(d.links.filter((l) => l.entryId === id)).toHaveLength(2);
  expect(d.cards.filter((c) => c.entryId === id)).toHaveLength(1);
  const changed = structuredClone(p.rows[0].entry);
  changed.phrase = "changed";
  const plan = planImport(d, p.deck, [changed], [], p.namespace);
  expect(plan.rows[0].kind).toBe("conflict");
  plan.rows[0].choice = "update";
  commitImport(d, plan);
  expect(d.entries.find((e) => e.id === id)!.phrase).toBe("changed");
  expect(d.notes.find((n) => n.entryId === id)!.text).toBe("我的笔记");
  expect(d.logs.filter((l) => l.entryId === id)).toHaveLength(1);
});
test("同形不同词性或义项不盲目合并，文件内相同词条可复用", () => {
  const d = emptyData(),
    e = fixture().entries[0],
    other = {
      ...structuredClone(e),
      id: "other",
      senses: e.senses.map((s) => ({ ...s, pos: "v.", zh: "搭建校园" })),
    },
    dup = { ...structuredClone(e), id: "dup" };
  const deck = fixture().decks[0];
  commitImport(d, planImport(d, deck, [e, other, dup], [], "same"));
  expect(d.entries).toHaveLength(2);
  expect(d.links).toHaveLength(2);
});
test("CSV无效字段阻止整体导入", async () => {
  const d = emptyData(),
    p = await parseImport(
      new File(["word,meaning_zh\nokay,正常\nbad,"], "bad.csv"),
      d,
    );
  expect(p.errors.length).toBe(1);
  expect(() => commitImport(d, p)).toThrow();
  expect(d.decks).toHaveLength(0);
});
test("ZIP目录穿越与单文件解压超限被拒绝", () => {
  expect(() => unpack(zipSync({ "../escape.txt": strToU8("bad") }))).toThrow(
    "路径",
  );
  expect(() =>
    unpack(zipSync({ "images/large.png": new Uint8Array(11 * 1024 * 1024) })),
  ).toThrow("10 MB");
});
test("ZIP媒体、笔记、学习记录和考试历史完整往返，分享不含个人数据", async () => {
  const d = fixture(),
    id = d.entries[0].id;
  d.media.push({
    id: "m1",
    path: "images/a.png",
    type: "image/png",
    data: "data:image/png;base64,iVBORw0KGgo=",
  });
  d.entries[0].senses[0].image = "m1";
  d.notes.push({
    entryId: id,
    text: "PRIVATE NOTE",
    favorite: true,
    reinforce: true,
  });
  applyRating(d, await rate(d, id, 3));
  d.exams.push(createExam(d, { ...config, count: 3 }));
  const restored = readBackup(backup(d));
  expect(restored).toEqual(JSON.parse(JSON.stringify(d)));
  const zip = deckArchive(d, d.decks[0].id),
    files = unpack(zip);
  expect(Object.keys(files)).toContain("images/0.png");
  expect(new TextDecoder().decode(files["entries.json"])).not.toContain(
    "PRIVATE NOTE",
  );
  const p = await parseImport(
    new File([zip as BlobPart], "shared.zip"),
    emptyData(),
  );
  expect(p.missing).toBe(0);
  expect(p.media).toHaveLength(1);
});
test("损坏备份在替换前拒绝", () => {
  const d = fixture();
  d.links.push({ deckId: "absent", entryId: d.entries[0].id });
  expect(() => readBackup(backup(d))).toThrow("关联损坏");
});
