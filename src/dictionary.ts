export interface Word {
  id: string;
  word: string;
  pos: string;
  meaning: string;
}
export interface ImportResult {
  words: Word[];
  blank: number;
  invalid: number;
  duplicates: number;
  comments: number;
  issues: { line: number; text: string }[];
}
const POS =
  /^(?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|det|aux|modal|abbr|int|interj|phr)\.?$/i;
const validPos = (s: string) =>
  s.split(/[\/&,；;]/).every((part) => POS.test(part.trim()));
export function parseDictionary(input: string): ImportResult {
  const result: ImportResult = {
      words: [],
      blank: 0,
      invalid: 0,
      duplicates: 0,
      comments: 0,
      issues: [],
    },
    seen = new Set<string>();
  const lines = input.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length > 100000)
    throw Error("单个词典最多 100000 行，请拆分后导入");
  lines.forEach((raw, i) => {
    let line = raw.normalize("NFKC").trim();
    if (!line) {
      result.blank++;
      return;
    }
    if (line.startsWith("#") || line.startsWith("//")) {
      result.comments++;
      return;
    }
    line = line
      .replace(/^\d+[.)、]\s*/, "")
      .replace(/^【(.*)】$/, "$1")
      .trim();
    line = line.replace(/\ba&\s+ad\./g, "adj./adv.");
    const fields = line.split(/\s+/);
    let posIndex = fields.findIndex((f, j) => j > 0 && validPos(f));
    let word = fields.slice(0, posIndex).join(" "),
      pos = fields[posIndex] || "",
      meaning = fields
        .slice(posIndex + 1)
        .join(" ")
        .trim();
    // Explicit TAB-separated sources may omit a part of speech; keep it unknown.
    // Do not guess a POS or split a multiword expression on its internal spaces.
    if (posIndex < 1 && line.includes("\t")) {
      const tab = line.indexOf("\t");
      word = line.slice(0, tab).trim();
      pos = "";
      meaning = line.slice(tab + 1).trim();
      posIndex = 1;
    }
    if (
      posIndex < 1 ||
      !/^[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿ]+)*(?: [A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿ]+)*)*$/.test(
        word,
      ) ||
      word.length > 100 ||
      !/[\u3400-\u9fff]/.test(meaning) ||
      meaning.length > 1000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw)
    ) {
      result.invalid++;
      if (result.issues.length < 10)
        result.issues.push({ line: i + 1, text: raw.slice(0, 100) });
      return;
    }
    const key = JSON.stringify([
      word.toLowerCase(),
      pos.toLowerCase(),
      meaning,
    ]);
    if (seen.has(key)) {
      result.duplicates++;
      return;
    }
    seen.add(key);
    result.words.push({ id: key, word, pos, meaning });
  });
  return result;
}
export async function readDictionaryFile(file: File) {
  if (!/\.txt$/i.test(file.name)) throw Error("请选择 TXT 词典文件");
  if (file.size > 10 * 1024 * 1024) throw Error("TXT 文件最大为 10 MB");
  const bytes = await file.arrayBuffer();
  let text: string;
  try {
    if (new Uint8Array(bytes)[0] === 0xff && new Uint8Array(bytes)[1] === 0xfe)
      text = new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
    else text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw Error("无法识别文本编码，请另存为 UTF-8 后再导入");
  }
  return parseDictionary(text);
}
