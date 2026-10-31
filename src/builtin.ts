import { Data } from "./types";
import { commitImport, parseImport } from "./library";
import bundled from "../content.lock.json";
export const BUILTIN_ID = "cet4-shuffled:1.0:4543";
export const BUILTIN_SOURCES = [
  { ...bundled, asset: "builtin-cet4.pack" },
  ...bundled.additional,
];
export async function installBuiltin(d: Data): Promise<boolean> {
  const pending = BUILTIN_SOURCES.filter(s => !d.builtinSources?.includes(`${s.id}:${s.version}:${s.entryCount}`));
  if (!pending.length) return false;
  // Parse all additions into a draft. Failure must not expose a partial installation.
  const draft = structuredClone(d);
  for (const source of pending) {
    const response = await fetch("/" + source.asset);
    if (!response.ok) throw Error(`无法读取内置${source.name}，请重新安装完整版本`);
    const bytes = await response.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .map(n => n.toString(16).padStart(2, "0")).join("");
    if (digest !== source.sha256) throw Error(`内置${source.name}文件校验失败`);
    const preview = await parseImport(new File([bytes], source.name + ".zip"), draft);
    if (preview.errors.length || preview.rows.length !== source.entryCount)
      throw Error(`内置${source.name}词数校验失败`);
    commitImport(draft, preview);
    draft.builtinSources = [...(draft.builtinSources || []), `${source.id}:${source.version}:${source.entryCount}`];
  }
  Object.assign(d, draft);
  return true;
}
