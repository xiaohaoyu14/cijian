import { test, expect } from "@playwright/test";
import { parseDictionary, readDictionaryFile } from "../src/dictionary";
test("TXT清洗空行、异常行、注释、重复行，保留同形不同词性义项", () => {
  const p = parseDictionary(
    "\uFEFFheritage  n.  遗产\r\n\n# comment\nheritage n. 遗产\nrecord n. 记录\nrecord v. 记录\ninvalid\nword n. noChinese\n【culture  n.  文化】\n1. take off  v.  起飞\n",
  );
  expect(p.words.map((w) => w.word)).toEqual([
    "heritage",
    "record",
    "record",
    "culture",
    "take off",
  ]);
  expect(p.blank).toBe(1);
  expect(p.invalid).toBe(2);
  expect(p.duplicates).toBe(1);
  expect(p.comments).toBe(1);
  expect(p.issues.map((i) => i.line)).toEqual([7, 8]);
});
test("空输入、词性组合与英文格式限制", () => {
  expect(parseDictionary("").words).toHaveLength(0);
  expect(
    parseDictionary(
      "good adj. 好的\nwork n./v. 工作\nwell-known adj. 知名的\ndon’t v. 不要",
    ).words,
  ).toHaveLength(4);
  expect(
    parseDictionary("123 n. 数字\nhello unknown 你好\n<script> n. 脚本")
      .invalid,
  ).toBe(3);
});
test("读取UTF8、UTF16LE并拒绝超限与非TXT", async () => {
  expect(
    (await readDictionaryFile(new File(["apple n. 苹果"], "words.txt")))
      .words[0].meaning,
  ).toBe("苹果");
  const bytes = Buffer.concat([
    Buffer.from([255, 254]),
    Buffer.from("apple n. 苹果", "utf16le"),
  ]);
  expect(
    (await readDictionaryFile(new File([bytes], "utf16.txt"))).words,
  ).toHaveLength(1);
  await expect(readDictionaryFile(new File(["a"], "a.csv"))).rejects.toThrow(
    "TXT",
  );
  await expect(
    readDictionaryFile(
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.txt"),
    ),
  ).rejects.toThrow("10 MB");
});
