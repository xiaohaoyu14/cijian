import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { emptyData } from "../src/types";
import { parseImport, commitImport } from "../src/library";
import { rate, applyRating } from "../src/scheduler";
import { parseTxt } from "../src/txt-import";
import { addDemo } from "../src/demo";
const bundled = JSON.parse(readFileSync("content.lock.json", "utf8"));
import { createExam } from "../src/exam";

test("旧版数据库升级后仍保留笔记、复习和考试，并追加内置四级库", async ({
  page,
}) => {
  const old = emptyData();
  addDemo(old);
  const id = old.entries[0].id;
  old.notes.push({
    entryId: id,
    text: "第一版个人笔记不能丢",
    favorite: true,
    reinforce: false,
  });
  applyRating(old, await rate(old, id, 3));
  old.exams.push(
    createExam(old, {
      decks: [],
      scope: "all",
      tag: "",
      count: 2,
      type: "zh-en",
      ratios: [25, 25, 25, 25],
      minutes: 0,
      practice: false,
    }),
  );
  await page.route("**/upgrade-baseline", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<html><body>Isolated old database fixture</body></html>",
    }),
  );
  await page.goto("/upgrade-baseline");
  await page.evaluate(
    async (data) =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("cijian-local-v1", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("state");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("state", "readwrite");
          tx.objectStore("state").put(data, "root");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    JSON.parse(JSON.stringify(old)),
  );
  await home(page);
  const before = await inspect(page);
  expect(before).toMatchObject({
    decks: 4,
    cards: 1,
    logs: 1,
    exams: 1,
    notes: 1,
  });
  expect(before.entries).toBeGreaterThanOrEqual(4543);
  await page.getByRole("link", { name: "我的词库", exact: true }).click();
  await page.getByLabel("搜索词条").fill("campus");
  await page
    .getByRole("button", { name: /^campus/ })
    .first()
    .click();
  await expect(
    page.getByPlaceholder("写下你的联想、易错点或自己的例句…"),
  ).toHaveValue("第一版个人笔记不能丢");
  await page.reload();
  expect(await inspect(page)).toEqual(before);
});

async function inspect(page: Page) {
  return page.evaluate(
    async () =>
      new Promise<any>((resolve) => {
        const r = indexedDB.open("cijian-local-v1");
        r.onsuccess = () => {
          const db = r.result,
            q = db.transaction("state").objectStore("state").get("root");
          q.onsuccess = () => {
            const d = q.result;
            resolve({
              entries: d.entries.length,
              decks: d.decks.length,
              links: d.links.length,
              cards: d.cards.length,
              logs: d.logs.filter((l: any) => !l.undone).length,
              exams: d.exams.length,
              notes: d.notes.length,
              sources: d.builtinSources,
              first: d.entries[0]?.word,
            });
            db.close();
          };
        };
      }),
  );
}
async function home(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "四级 · 乱序词库", exact: true }),
  ).toBeVisible({ timeout: 15000 });
}
async function mockPiper(page: Page) {
  await page.route("**/src/speech.ts*", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `window.__piperCalls=[];export async function initialize(){await new Promise(r=>setTimeout(r,100));return {model:'en_US-lessac-high',sampleRate:22050};}export async function speak(text){window.__piperCalls.push(text);return {};}export async function stop(){}`,
    }),
  );
}

test("用户提供的ZIP完整内置4543词，重复导入保留学习记录和笔记", async () => {
  const d = emptyData(),
    file = new File(
      [readFileSync("public/builtin-cet4.pack")],
      "四级 · 乱序词库.zip",
    );
  const p = await parseImport(file, d);
  expect(p.rows).toHaveLength(4543);
  expect(p.errors).toHaveLength(0);
  expect(p.deck.demo).toBe(false);
  commitImport(d, p);
  expect(d.entries).toHaveLength(4543);
  const id = d.entries[0].id;
  d.notes.push({
    entryId: id,
    text: "保留的个人笔记",
    favorite: true,
    reinforce: false,
  });
  applyRating(d, await rate(d, id, 3));
  commitImport(d, await parseImport(file, d));
  expect(d.entries).toHaveLength(4543);
  expect(d.links).toHaveLength(4543);
  expect(d.cards).toHaveLength(1);
  expect(d.logs).toHaveLength(1);
  expect(d.notes[0].text).toBe("保留的个人笔记");
});
test("TXT作为额外导入入口，不替代已有词库", async () => {
  const d = emptyData();
  const p = await parseTxt(
    new File(["heritage n. 遗产\n\ninvalid\nheritage n. 遗产"], "words.txt"),
    d,
  );
  expect(p.cleaning).toEqual({ blank: 1, invalid: 1, duplicates: 1 });
  commitImport(d, p);
  expect(d.decks[0].name).toBe("words");
  expect(d.entries).toHaveLength(1);
});
test("首次打开原完整界面与4543内置词库，重开不重复或生成学习记录", async ({
  page,
}) => {
  await home(page);
  for (const name of [
    "今日学习",
    "我的词库",
    "个人考试",
    "学习统计",
    "偏好设置",
  ])
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  for (const name of ["开始复习", "学习新词"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  const first = await inspect(page);
  expect(first).toMatchObject({
    entries: bundled.combined.uniqueEntries,
    decks: 3,
    links: bundled.combined.links,
    cards: 0,
    logs: 0,
    exams: 0,
  });
  await page.reload();
  await home(page);
  expect(await inspect(page)).toEqual(first);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "deliverables/完整版-今日学习.png",
    fullPage: true,
  });
});
test("内置四级库可生成50和100词试卷，提交后历史保持独立", async ({ page }) => {
  await home(page);
  await page.getByRole("link", { name: "个人考试", exact: true }).click();
  await page.getByRole("button", { name: "生成试卷并预览信息" }).click();
  await page.getByRole("button", { name: "开始考试", exact: true }).click();
  await expect(page.locator(".answer-grid button")).toHaveCount(50);
  await page.getByRole("button", { name: "提前交卷" }).click();
  await page.getByRole("button", { name: "确认交卷" }).click();
  await expect(
    page.getByRole("heading", { name: "个人考试报告", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回考试", exact: true }).click();
  await page.getByRole("button", { name: "100 词", exact: true }).click();
  await page.getByRole("button", { name: "生成试卷并预览信息" }).click();
  await page.getByRole("button", { name: "开始考试", exact: true }).click();
  await expect(page.locator(".answer-grid button")).toHaveCount(100);
  expect((await inspect(page)).exams).toBe(2);
  expect((await inspect(page)).cards).toBe(0);
});
test("单词旁Piper点读不改变学习记录，开关关闭后保留整个学习功能", async ({
  page,
}) => {
  await mockPiper(page);
  await home(page);
  await page.getByRole("link", { name: "我的词库", exact: true }).click();
  await page.getByRole("button", { name: "朗读 access", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__piperCalls))
    .toEqual(["access"]);
  expect((await inspect(page)).cards).toBe(0);
  await page.getByRole("link", { name: "偏好设置", exact: true }).click();
  await page.getByRole("switch", { name: "开启发音" }).click();
  await page.getByRole("link", { name: "今日学习", exact: true }).click();
  await page.getByRole("button", { name: "学习新词", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "朗读 access", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "3 记得", exact: true }).click();
  await expect(page.getByText("2 / 20", { exact: true })).toBeVisible();
  expect((await inspect(page)).cards).toBe(1);
});
test("恢复的完整版保留CSV/ZIP与TXT导入、详情、笔记、统计和完整备份", async ({
  page,
}) => {
  await home(page);
  await page.getByRole("link", { name: "我的词库", exact: true }).click();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "我的补充.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("specialword n. 特别单词\nbad\n"),
    });
  await expect(page.getByRole("dialog", { name: "导入预览" })).toBeVisible();
  await expect(page.getByText(/TXT 清洗/)).toBeVisible();
  await page.getByRole("button", { name: "确认导入 1 条" }).click();
  expect((await inspect(page)).decks).toBe(4);
  await page.getByLabel("搜索词条").fill("specialword");
  await page
    .getByRole("button", { name: /^specialword/ })
    .first()
    .click();
  await page
    .getByPlaceholder("写下你的联想、易错点或自己的例句…")
    .fill("新版没有删除第一版笔记功能");
  await page.getByRole("button", { name: "保存笔记" }).click();
  await page.getByRole("button", { name: "关闭详情" }).click();
  await page.getByRole("link", { name: "学习统计", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "近 14 天的积累" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "偏好设置", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整备份" }).click();
  await (await download).saveAs("test-results/完整版-备份.zip");
  await page
    .locator("input[type=file]")
    .setInputFiles("test-results/完整版-备份.zip");
  await page.getByRole("button", { name: "确认替换当前全部数据" }).click();
  expect((await inspect(page)).entries).toBe(bundled.combined.uniqueEntries + 1);
  expect((await inspect(page)).notes).toBe(1);
});
