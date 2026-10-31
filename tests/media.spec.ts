import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { emptyData } from "../src/types";
import { addDemo } from "../src/demo";
import { commitImport, parseImport, unpack } from "../src/library";
import { rate, applyRating } from "../src/scheduler";

test("添加图片自动缩小，独立存储，重开与共享导出仍包含图片", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "添加示例", exact: true }).click();
  await page.getByRole("button", { name: "学习新词", exact: true }).click();
  await page.getByRole("button", { name: "3 记得", exact: true }).click();
  await expect(page.getByText("2 / 20", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "暂停并保存" }).click();
  await page.getByRole("link", { name: "我的词库", exact: true }).click();
  await page
    .getByRole("button", { name: /^campus/ })
    .first()
    .click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1800;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "#87a578";
    c.fillRect(0, 0, 2400, 1800);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator('input[aria-label^="义项图片"]').setInputFiles({
    name: "campus.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(page.locator(".sense-image")).toBeVisible();
  expect(
    await page
      .locator(".sense-image")
      .evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeLessThanOrEqual(960);
  const stored = await page.evaluate(
    async () =>
      await new Promise<any>((resolve) => {
        const r = indexedDB.open("cijian-local-v1");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(["state", "media"]),
            q = tx.objectStore("state").get("root");
          q.onsuccess = () => {
            const d = q.result,
              m = tx.objectStore("media").get(d.media[0].id);
            m.onsuccess = () =>
              resolve({
                root: d.media[0],
                payload: m.result,
                cards: d.cards.length,
                logs: d.logs.length,
              });
          };
          tx.oncomplete = () => db.close();
        };
      }),
  );
  expect(stored.root.data).toBe("");
  expect(stored.payload.data).toMatch(/^data:image\/webp;base64,/);
  expect(stored.root.bytes).toBeLessThanOrEqual(250 * 1024);
  expect(stored.cards).toBe(1);
  expect(stored.logs).toBe(1);
  await page.reload();
  await page
    .getByRole("button", { name: /^campus/ })
    .first()
    .click();
  await expect(page.locator(".sense-image")).toBeVisible();
  await page.getByRole("button", { name: "关闭详情" }).click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出词库 四级起步 · 示例词库" })
    .click();
  const zip = unpack(readFileSync((await (await downloaded).path())!));
  expect(Object.keys(zip).some((p) => p.startsWith("images/"))).toBe(true);
});

test("旧版内嵌媒体自动迁移，原笔记、学习记录与图片仍可用", async ({ page }) => {
  const d = emptyData();
  const p = await parseImport(
    new File([readFileSync("public/sample-media.pack")], "sample.zip"),
    d,
  );
  commitImport(d, p);
  const id = d.entries.find((e) => e.word === "mountain")!.id;
  d.notes.push({
    entryId: id,
    text: "旧版个人笔记",
    favorite: true,
    reinforce: false,
  });
  applyRating(d, await rate(d, id, 3));
  const original = d.media[0].data;
  await page.route("**/migration-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body>Isolated migration test</body></html>",
    }),
  );
  await page.goto("/migration-seed");
  await page.evaluate(
    async (d) =>
      await new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("cijian-local-v1", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("state");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("state", "readwrite");
          tx.objectStore("state").put(d, "root");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    JSON.parse(JSON.stringify(d)),
  );
  await page.goto("/#decks");
  await page
    .getByRole("button", { name: /^mountain/ })
    .first()
    .click();
  await expect(page.locator(".sense-image")).toBeVisible();
  await expect(
    page.getByPlaceholder("写下你的联想、易错点或自己的例句…"),
  ).toHaveValue("旧版个人笔记");
  const result = await page.evaluate(
    async () =>
      await new Promise<any>((resolve) => {
        const r = indexedDB.open("cijian-local-v1");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(["state", "media"]),
            q = tx.objectStore("state").get("root");
          q.onsuccess = () => {
            const d = q.result,
              m = tx.objectStore("media").get(d.media[0].id);
            m.onsuccess = () =>
              resolve({
                version: db.version,
                embedded: d.media.some((m: any) => m.data),
                payload: m.result.data,
                cards: d.cards.length,
                logs: d.logs.length,
              });
          };
          tx.oncomplete = () => db.close();
        };
      }),
  );
  expect(result).toEqual({
    version: 2,
    embedded: false,
    payload: original,
    cards: 1,
    logs: 1,
  });
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
