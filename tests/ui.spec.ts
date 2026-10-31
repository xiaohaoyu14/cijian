import { test, expect, Page } from "@playwright/test";
import { emptyData } from "../src/types";
import { addDemo } from "../src/demo";
import { createExam, submit } from "../src/exam";
import { backup } from "../src/library";
async function demo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "添加示例", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "四级起步 · 示例词库" }),
  ).toBeVisible();
}
async function adjustSavedTime(
  page: Page,
  mode: "due" | "expire" | "due-preserve",
) {
  await page.evaluate(async (mode) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("cijian-local-v1");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result,
          tx = db.transaction("state", "readwrite"),
          store = tx.objectStore("state"),
          get = store.get("root");
        get.onsuccess = () => {
          const d = get.result;
          if (mode === "due" || mode === "due-preserve") {
            d.cards[0].fsrs.dueAt = new Date(Date.now() - 1000);
            if (mode === "due") delete d.study;
          } else {
            d.exams[0].deadline = new Date(Date.now() - 1000).toISOString();
          }
          store.put(d, "root");
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, mode);
}
test("桌面真实流程：初学、隐藏答案、撤销、断网、重开后保留", async ({
  page,
}) => {
  await demo(page);
  await page.getByRole("button", { name: "学习新词", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "忘记了", exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "3 记得", exact: true }).click();
  await expect(page.getByText("2 / 20", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "撤销上次评分" }).click();
  await expect(page.getByText("1 / 20", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "忘记了", exact: false }).click();
  await page.getByRole("button", { name: "暂停并保存" }).click();
  await page.reload();
  await page.getByRole("button", { name: "继续上次学习" }).click();
  await expect(page.getByText("2 / 20", { exact: true })).toBeVisible();
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "3 记得", exact: true }).click();
  await expect(page.getByText("3 / 20", { exact: true })).toBeVisible();
  await page.context().setOffline(false);
});
test("复习答案默认隐藏，显示后四档反馈", async ({ page }) => {
  await demo(page);
  await page.getByRole("button", { name: "学习新词", exact: true }).click();
  await page.getByRole("button", { name: "忘记了", exact: false }).click();
  await expect(page.getByText("2 / 20", { exact: true })).toBeVisible();
  await adjustSavedTime(page, "due");
  await page.goto("/#today");
  await page.reload();
  await page.getByRole("button", { name: "开始复习", exact: true }).click();
  await expect(page.getByText("校园", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "查看答案", exact: true }).click();
  await expect(page.getByRole("heading", { name: "n. 校园" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "有点费力", exact: false }),
  ).toBeVisible();
});
test("中文待确认、退出恢复快照、提交后人工确认", async ({ page }) => {
  await demo(page);
  await page.getByRole("link", { name: "个人考试", exact: true }).click();
  await page.getByLabel("自定义题量").fill("2");
  await page.getByLabel("考试题型").selectOption("en-zh");
  await page.getByRole("button", { name: "生成试卷并预览信息" }).click();
  await page.getByRole("button", { name: "开始考试", exact: true }).click();
  const prompt = await page.locator(".question-card>h2").textContent();
  await page.getByLabel("考试答案").fill("一个需要人工核对的释义");
  await expect(page.getByLabel("考试答案")).toHaveValue(
    "一个需要人工核对的释义",
  );
  await page.getByRole("button", { name: "保存并退出" }).click();
  await page.reload();
  await page.getByRole("button", { name: "继续考试", exact: true }).click();
  await expect(page.locator(".question-card>h2")).toHaveText(prompt!);
  await expect(page.getByLabel("考试答案")).toHaveValue(
    "一个需要人工核对的释义",
  );
  await page.getByRole("button", { name: "提前交卷" }).click();
  await page.getByRole("button", { name: "确认交卷" }).click();
  await expect(page.getByText("暂定成绩 · 待人工确认")).toBeVisible();
  await page.getByRole("button", { name: "确认正确", exact: true }).click();
  await expect(page.getByText("最终成绩", { exact: true })).toBeVisible();
  await expect(page.locator(".score strong")).toHaveText("50");
});
test("手机布局、CSV预览与个人笔记", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#decks");
  await page.locator("input[type=file]").setInputFiles({
    name: "手机词库.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("word,meaning_zh\noffline,离线\nlocal,本地"),
  });
  await expect(page.getByRole("dialog", { name: "导入预览" })).toBeVisible();
  await page.getByRole("button", { name: "确认导入 2 条" }).click();
  await expect(page.getByText("offline", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: /offline/ })
    .first()
    .click();
  await expect(page.getByRole("dialog", { name: "单词详情" })).toBeVisible();
  await page
    .getByPlaceholder("写下你的联想、易错点或自己的例句…")
    .fill("离线笔记");
  await page.getByRole("button", { name: "保存笔记" }).click();
  await page.getByRole("button", { name: "关闭详情" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "deliverables/手机界面.png", fullPage: true });
});
test("限时考试关闭页面后按绝对截止时间自动交卷", async ({ page }) => {
  await demo(page);
  await page.getByRole("link", { name: "个人考试", exact: true }).click();
  await page.getByLabel("自定义题量").fill("1");
  await page.getByLabel("考试题型").selectOption("zh-en");
  await page.getByLabel("考试限时").fill("1");
  await page.getByRole("button", { name: "生成试卷并预览信息" }).click();
  await page.getByRole("button", { name: "开始考试", exact: true }).click();
  await expect(page.locator(".question-card")).toBeVisible();
  await adjustSavedTime(page, "expire");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "继续考试", exact: true }),
  ).not.toBeVisible();
  await expect(page.locator(".exam-history")).toBeVisible();
});
test("首页截图，无虚构学习历史", async ({ page }) => {
  await demo(page);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "deliverables/桌面界面.png", fullPage: true });
  await expect(page.locator(".metric strong").first()).toHaveText("0词");
});
test("图文音频导入、重新打开、断网读取媒体与完整备份恢复", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#decks");
  await page.getByRole("button", { name: "体验图文示例包" }).click();
  await expect(page.getByRole("dialog", { name: "导入预览" })).toBeVisible();
  await page.getByRole("button", { name: "确认导入 4 条" }).click();
  await page.reload();
  await page.context().setOffline(true);
  await page
    .getByRole("button", { name: /^mountain/ })
    .first()
    .click();
  await expect(page.locator(".sense-image")).toBeVisible();
  expect(
    await page
      .locator(".sense-image")
      .evaluate((im: HTMLImageElement) => im.complete && im.naturalWidth > 0),
  ).toBe(true);
  await page
    .locator("audio")
    .evaluate((audio: HTMLAudioElement) => audio.load());
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await page
    .getByPlaceholder("写下你的联想、易错点或自己的例句…")
    .fill("有图片和发音的离线笔记");
  await page.getByRole("button", { name: "保存笔记" }).click();
  await page.getByRole("button", { name: "关闭详情" }).click();
  await page.getByRole("link", { name: "偏好设置", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整备份" }).click();
  const saved = await download;
  await saved.saveAs("test-results/测试完整备份.zip");
  await page.getByRole("link", { name: "我的词库", exact: true }).click();
  await page
    .getByRole("button", { name: "删除词库 自然之间 · 图文示例" })
    .click();
  await page.getByRole("button", { name: "删除词库", exact: true }).click();
  await page.getByRole("link", { name: "偏好设置", exact: true }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles("test-results/测试完整备份.zip");
  await page.getByRole("button", { name: "确认替换当前全部数据" }).click();
  await page.getByRole("link", { name: "我的词库", exact: true }).click();
  await page
    .getByRole("button", { name: /^mountain/ })
    .first()
    .click();
  await expect(
    page.getByPlaceholder("写下你的联想、易错点或自己的例句…"),
  ).toHaveValue("有图片和发音的离线笔记");
  await expect(page.locator(".sense-image")).toBeVisible();
  await page.context().setOffline(false);
  await page.screenshot({ path: "deliverables/图文学习.png", fullPage: true });
});
test("真实键盘连续输入不会丢字符且重载后保留", async ({ page }) => {
  await demo(page);
  await page.getByRole("link", { name: "个人考试", exact: true }).click();
  await page.getByLabel("自定义题量").fill("1");
  await page.getByLabel("考试题型").selectOption("zh-en");
  await page.getByRole("button", { name: "生成试卷并预览信息" }).click();
  await page.getByRole("button", { name: "开始考试", exact: true }).click();
  await page
    .getByLabel("考试答案")
    .pressSequentially("carefullytypedanswer", { delay: 10 });
  await expect(page.getByLabel("考试答案")).toHaveValue("carefullytypedanswer");
  await page.reload();
  await page.getByRole("button", { name: "继续考试", exact: true }).click();
  await expect(page.getByLabel("考试答案")).toHaveValue("carefullytypedanswer");
});

test("暂停新词后可优先复习，回来仍继续新词原进度", async ({ page }) => {
  await demo(page);
  await page.getByRole("button", { name: "学习新词", exact: true }).click();
  await page.getByRole("button", { name: "1 忘记了", exact: true }).click();
  await expect(page.getByText("2 / 20", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "暂停并保存" }).click();
  await adjustSavedTime(page, "due-preserve");
  await page.reload();
  await page.getByRole("button", { name: "开始复习", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "间隔复习", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看答案", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "暂停并保存" }).click();
  await page.getByRole("button", { name: "学习新词", exact: true }).click();
  await expect(page.getByText("2 / 20", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("2 / 20", { exact: true })).toBeVisible();
});
test("本场三个错词素材不足时可改题型，历史不被覆盖", async ({ page }) => {
  // This synthetic exam fixture exists only in this isolated test browser.
  const d = emptyData();
  addDemo(d);
  const old = createExam(d, {
    decks: [],
    scope: "all",
    tag: "",
    count: 3,
    type: "en-choice",
    ratios: [25, 25, 25, 25],
    minutes: 0,
    practice: false,
  });
  for (const i of old.items)
    old.answers[i.id] = {
      itemId: i.id,
      value: i.options.find((o) => o !== i.correct)!,
      status: "wrong",
      method: "auto",
    };
  submit(old);
  d.exams.push(old);
  await page.goto("/#settings");
  await page.locator("input[type=file]").setInputFiles({
    name: "isolated-test.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(backup(d)),
  });
  await page.getByRole("button", { name: "确认替换当前全部数据" }).click();
  await page.getByRole("link", { name: "个人考试", exact: true }).click();
  await page.locator(".exam-history").click();
  await page.getByRole("button", { name: "只重练错词（3）" }).click();
  await expect(
    page.getByRole("heading", { name: "已固定本场重练范围" }),
  ).toBeVisible();
  await expect(page.getByLabel("考试范围")).toBeDisabled();
  await page.getByLabel("考试题型").selectOption("zh-en");
  await page.getByRole("button", { name: "生成试卷并预览信息" }).click();
  await page.getByRole("button", { name: "开始考试", exact: true }).click();
  await expect(page.locator(".answer-grid button")).toHaveCount(3);
  const exams = await page.evaluate(
    async () =>
      await new Promise<any[]>((resolve) => {
        const req = indexedDB.open("cijian-local-v1");
        req.onsuccess = () => {
          const db = req.result,
            q = db.transaction("state").objectStore("state").get("root");
          q.onsuccess = () => {
            resolve(q.result.exams);
            db.close();
          };
        };
      }),
  );
  expect(exams).toHaveLength(2);
  expect(exams[0].id).toBe(old.id);
  expect(exams[0].state).toBe("submitted");
  expect(new Set(exams[1].items.map((i: any) => i.entryId))).toEqual(
    new Set(old.items.map((i) => i.entryId)),
  );
});

// Isolate original regression fixtures from the new preinstalled user dictionary.
test.beforeEach(async ({ page }) => {
  await page.route("**/src/builtin.ts*", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "export async function installBuiltin(){return false;}",
    }),
  );
});
