import { Data, uid } from "./types";
import { readDictionaryFile } from "./dictionary";
import { planImport } from "./library";
export async function parseTxt(file: File, d: Data) {
  const cleaned = await readDictionaryFile(file),
    name = file.name.replace(/\.txt$/i, "");
  if (!cleaned.words.length)
    throw Error("TXT 中没有有效词条，请使用：单词  词性  中文释义");
  if (cleaned.words.length > 10000)
    throw Error("每次最多导入 10000 个有效词条，请按词库分卷后导入");
  const entries = cleaned.words.map((w) => ({
    id: "txt:" + encodeURIComponent(w.id),
    word: w.word,
    phonetic: "",
    phrase: "",
    tags: [],
    senses: [
      {
        id: uid(),
        pos: w.pos,
        zh: w.meaning,
        acceptedZh: [],
        variants: [],
        examples: [],
      },
    ],
  }));
  const preview = planImport(
    d,
    {
      id: "txt-deck:" + name,
      name,
      author: "",
      version: "1",
      language: "en",
      source: "本地 TXT 导入",
      license: "由导入者确认",
      tags: [],
    },
    entries,
    [],
    "txt:" + name,
  );
  return {
    ...preview,
    cleaning: {
      blank: cleaned.blank,
      invalid: cleaned.invalid,
      duplicates: cleaned.duplicates,
    },
  };
}
