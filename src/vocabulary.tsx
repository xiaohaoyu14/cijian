import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { vocabularyIndex, vocabularyCounts, searchVocabulary, WORD_PAGE_SIZE } from "./vocabulary-index";
import {
  Plus,
  Search,
  Upload,
  Download,
  BookOpen,
  MoreHorizontal,
  Star,
  Volume2,
  X,
  Pencil,
  Trash2,
  ArrowLeft,
  ImageOff,
} from "lucide-react";
import { Data, Deck, Entry, cardOf, isDue, noteOf, uid } from "./types";
import { getData, mutate, hydrateMedia } from "./store";
import { MediaImage, MediaAudio, PicturePicker } from "./media";
import { PronounceWord, PronounceIcon } from "./pronunciation";
import { parseTxt } from "./txt-import";
import { Actions, Empty, PageHead } from "./main";
import {
  ImportPreview,
  commitImport,
  csvTemplate,
  deckArchive,
  download,
  parseImport,
  validateEntry,
} from "./library";
import { addDemo } from "./demo";
import { beginStudy } from "./overview";
export function Libraries({ d, a }: { d: Data; a: Actions }) {
  const [deckId, setDeckId] = useState(""),
    [query, setQuery] = useState(""),
    [entryPage, setEntryPage] = useState(0),
    [countTime, setCountTime] = useState(Date.now),
    [preview, setPreview] = useState<ImportPreview>(),
    [previewPage, setPreviewPage] = useState(0),
    [previewQuery, setPreviewQuery] = useState(""),
    [remove, setRemove] = useState<string>(),
    [editDeck, setEditDeck] = useState<Deck>(),
    [editor, setEditor] = useState<Entry | "new">(),
    file = useRef<HTMLInputElement>(null);
  useEffect(() => { setPreviewPage(0); setPreviewQuery(""); }, [preview?.deck.id]);
  useEffect(() => {
    const update = () => setCountTime(Date.now());
    const timer = setInterval(update, 15000);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, []);
  const deferredQuery = useDeferredValue(query), deferredPreviewQuery = useDeferredValue(previewQuery);
  const index = useMemo(() => vocabularyIndex(d), [d]);
  const counts = useMemo(() => vocabularyCounts(index), [index, countTime]);
  const previewRows = useMemo(() => (preview?.rows || []).map((row, index) => ({ row, index }))
    .filter(({row}) => `${row.entry.word} ${row.entry.senses.map(s => s.zh).join(" ")}`.toLowerCase().includes(deferredPreviewQuery.toLowerCase())), [preview?.rows, deferredPreviewQuery]);
  const previewPages = Math.max(1, Math.ceil(previewRows.length / 100));
  const deck = d.decks.find((x) => x.id === deckId);
  const entries = useMemo(() => searchVocabulary(index, deckId, deferredQuery), [index, deckId, deferredQuery]);
  const entryPages = Math.max(1, Math.ceil(entries.length / WORD_PAGE_SIZE)), currentEntryPage = Math.min(entryPage, entryPages - 1);
  const changeDeck = (id: string) => { setDeckId(id); setEntryPage(0); };
  return (
    <>
      <PageHead
        eyebrow="YOUR WORD COLLECTION"
        title="我的词库"
        description="收藏每一个值得记住的词，建立自己的语言世界。"
      >
        <div className="button-row">
          <button
            className="outline"
            onClick={() =>
              setEditDeck({
                id: uid(),
                name: "",
                author: "本地用户",
                version: "1",
                language: "en",
                source: "手动创建",
                license: "由分享者确认",
                tags: [],
              })
            }
          >
            <Plus size={17} />
            新建词库
          </button>
          <button onClick={() => file.current?.click()}>
            <Upload size={17} />
            导入词库
          </button>
        </div>
      </PageHead>
      <input
        ref={file}
        hidden
        type="file"
        accept=".csv,.zip,.txt"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f)
            a.run(async () =>
              setPreview(
                /\.txt$/i.test(f.name)
                  ? await parseTxt(f, getData())
                  : await parseImport(f, getData()),
              ),
            );
          e.target.value = "";
        }}
      />
      <div className="import-strip">
        <div>
          <BookOpen size={20} />
          <span>
            支持 CSV、TXT 与 ZIP 词库，每次最多 10000 词，TXT 最大 10 MB；导入前预览。内置四级、六级与 SAT 三套词库，个人记录独立保留。
          </span>
        </div>
        <div className="button-row">
          <button
            className="text-button"
            onClick={() =>
              a.run(async () => {
                const response = await fetch("/sample-media.pack");
                if (!response.ok) throw Error("示例包暂时无法读取");
                setPreview(
                  await parseImport(
                    new File([await response.blob()], "图文示例.zip"),
                    getData(),
                  ),
                );
              })
            }
          >
            体验图文示例包
          </button>
          <button
            className="text-button"
            onClick={() =>
              a.run(() =>
                download(
                  "词间导入模板.csv",
                  csvTemplate,
                  "text/csv;charset=utf-8",
                ),
              )
            }
          >
            <Download size={15} />
            CSV 模板
          </button>
        </div>
      </div>
      {!d.decks.length ? (
        <Empty
          title="还没有词库"
          text="导入你自己的词库，或用无学习记录的示例词库开始。"
        >
          <div className="button-row">
            <button onClick={() => file.current?.click()}>
              导入 CSV / ZIP
            </button>
            <button
              className="outline"
              onClick={() =>
                a.run(() => mutate(addDemo), "已添加 120 个示例词条")
              }
            >
              添加示例词库
            </button>
          </div>
        </Empty>
      ) : (
        <>
          <div className="library-cards">
            {d.decks.map((x, i) => {
              const n = counts.get(x.id) || { all: 0, fresh: 0, learning: 0, due: 0 };
              return (
                <section
                  key={x.id}
                  className={
                    "panel library-card " + (deckId === x.id ? "selected" : "")
                  }
                >
                  <div className="section-title">
                    <span className={"book-cover cover-" + (i % 3)}>
                      <BookOpen />
                      <small>{x.demo ? "STARTER" : "MY WORDS"}</small>
                    </span>
                    <div className="button-row">
                      <button
                        className="icon"
                        aria-label={"编辑词库 " + x.name}
                        onClick={() => setEditDeck(structuredClone(x))}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon"
                        aria-label={"导出词库 " + x.name}
                        onClick={() =>
                          a.run(async () =>
                            download(
                              x.name + ".zip",
                              deckArchive(await hydrateMedia(d, x.id), x.id),
                            ),
                          )
                        }
                      >
                        <Download size={16} />
                      </button>
                      <button
                        className="icon"
                        aria-label={"删除词库 " + x.name}
                        onClick={() => setRemove(x.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <button
                    className="bare deck-name"
                    onClick={() => changeDeck(deckId === x.id ? "" : x.id)}
                  >
                    <h3>{x.name}</h3>
                  </button>
                  <div className="tags">
                    {x.demo && <span className="tag">示例内容</span>}
                    {x.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="deck-numbers">
                    <span>
                      <b>{n.all}</b>词条
                    </span>
                    <span>
                      <b>{n.fresh}</b>新词
                    </span>
                    <span>
                      <b>{n.learning}</b>学习中
                    </span>
                    <span>
                      <b>{n.due}</b>到期
                    </span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => changeDeck(deckId === x.id ? "" : x.id)}
                  >
                    {deckId === x.id ? "取消筛选" : "浏览词库"} →
                  </button>
                </section>
              );
            })}
          </div>
          <section className="panel">
            <div className="section-title">
              <h2>
                {deck?.name || "全部词条"}{" "}
                <span className="count">{entries.length}</span>
              </h2>
              {deck && (
                <button
                  className="small outline"
                  onClick={() => setEditor("new")}
                >
                  <Plus size={15} />
                  添加词条
                </button>
              )}
            </div>
            <div className="search-field">
              <Search size={18} />
              <input
                aria-label="搜索词条"
                value={query}
                placeholder="搜索英文、中文或主题标签…"
                onChange={(e) => { setQuery(e.target.value); setEntryPage(0); }}
              />
              {deckId && (
                <button className="text-button" onClick={() => changeDeck("")}>
                  全部词库
                </button>
              )}
            </div>
            {entries.length ? (
              <div className="entry-list" aria-busy={query !== deferredQuery}>
                {entries.slice(currentEntryPage * WORD_PAGE_SIZE, (currentEntryPage + 1) * WORD_PAGE_SIZE).map((e) => (
                  <div className="entry-row" key={e.id}>
                    <button
                      className="bare entry-main"
                      onClick={() => a.openEntry(e.id)}
                    >
                      <strong>{e.word}</strong>
                      <span>{e.phonetic}</span>
                      <p>
                        {e.senses.map((s) => `${s.pos} ${s.zh}`).join("；")}
                      </p>
                    </button>
                    <PronounceIcon entry={e} enabled={d.settings.audioEnabled !== false} a={a} />
                    <span
                      className={
                        "state-tag " + (index.cards.has(e.id) ? "learned" : "")
                      }
                    >
                      {index.cards.has(e.id)
                        ? isDue(index.cards.get(e.id)!)
                          ? "待复习"
                          : "学习中"
                        : "新词"}
                    </span>
                    <button
                      className="icon"
                      aria-label={"收藏 " + e.word}
                      onClick={() =>
                        a.run(() =>
                          mutate((x) => {
                            const n = noteOf(x, e.id);
                            if (!x.notes.includes(n)) x.notes.push(n);
                            n.favorite = !n.favorite;
                          }),
                        )
                      }
                    >
                      <Star
                        size={18}
                        fill={index.notes.get(e.id)?.favorite ? "#c59444" : "none"}
                        color={
                          index.notes.get(e.id)?.favorite ? "#c59444" : "currentColor"
                        }
                      />
                    </button>
                    <button
                      className="icon"
                      aria-label={"编辑 " + e.word}
                      onClick={() => setEditor(structuredClone(e))}
                    >
                      <Pencil size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                title="没有找到词条"
                text="试试其他关键词，或向此词库添加内容。"
              />
            )}
            <nav className="word-pagination" aria-label="词条分页">
              <p className="subtle" aria-live="polite">共 {entries.length} 条 · 第 {currentEntryPage + 1} / {entryPages} 页 · 每页 {WORD_PAGE_SIZE} 条</p>
              <div className="button-row">
                <button className="outline small" disabled={currentEntryPage === 0} onClick={() => setEntryPage(0)}>词条首页</button>
                <button className="outline small" disabled={currentEntryPage === 0} onClick={() => setEntryPage(currentEntryPage - 1)}>词条上一页</button>
                <button className="outline small" disabled={currentEntryPage + 1 >= entryPages} onClick={() => setEntryPage(currentEntryPage + 1)}>词条下一页</button>
                <button className="outline small" disabled={currentEntryPage + 1 >= entryPages} onClick={() => setEntryPage(entryPages - 1)}>词条末页</button>
              </div>
            </nav>
          </section>
        </>
      )}
      {preview && (
        <div className="modal-backdrop">
          <section className="modal wide" role="dialog" aria-label="导入预览">
            <button
              className="icon close"
              aria-label="关闭导入预览"
              onClick={() => setPreview(undefined)}
            >
              <X />
            </button>
            <div className="eyebrow">IMPORT PREVIEW</div>
            <h2>导入预览 · {preview.deck.name}</h2>
            <p>
              {preview.deck.author || "未填写作者"} · v{preview.deck.version} ·
              授权：{preview.deck.license}
            </p>
            <p className="subtle">
              来源：{preview.deck.source} · 语言：{preview.deck.language}
            </p>
            <div className="preview-counts">
              {(["new", "duplicate", "conflict"] as const).map((k, i) => (
                <div key={k}>
                  <b>{preview.rows.filter((r) => r.kind === k).length}</b>
                  {["新增", "重复复用", "内容冲突"][i]}
                </div>
              ))}
              <div>
                <b>{preview.errors.length}</b>错误
              </div>
              <div>
                <b>{preview.missing}</b>缺失媒体
              </div>
            </div>
            {"cleaning" in preview && (
              <p className="notice">
                TXT 清洗：跳过 {(preview as any).cleaning.blank} 行空行、
                {(preview as any).cleaning.invalid} 行异常、
                {(preview as any).cleaning.duplicates} 行重复；有效词条{" "}
                {preview.rows.length} 个。
              </p>
            )}
            {preview.missing > 0 && (
              <div className="notice">缺失媒体将跳过，文字功能不受影响。</div>
            )}
            {preview.errors.length > 0 && (
              <div className="notice error">
                {preview.errors.slice(0, 20).map((e, i) => (
                  <p key={i}>{e}</p>
                ))}
                请修复后重新导入；当前不会写入任何词条。
              </div>
            )}
            {preview.rows.some((r) => r.kind === "conflict") && (
              <div className="notice">
                相同稳定标识或相同拼写、词性和义项存在内容差异。逐项选择如何处理；更新只改词条内容，保留学习与考试记录。
              </div>
            )}
            <label>查找预览词条
              <input aria-label="查找预览词条" value={previewQuery} onChange={e => { setPreviewQuery(e.target.value); setPreviewPage(0); }} placeholder="单词或中文释义" />
            </label>
            <p className="subtle">预览匹配 {previewRows.length} 条，每页最多显示 100 条；确认导入包含全部 {preview.rows.length} 条。</p>
            <div className="preview-list">
              {previewRows.slice(previewPage * 100, (previewPage + 1) * 100).map(({row: r, index: i}) => (
                <div key={i} className="preview-row">
                  <div>
                    <strong>{r.entry.word}</strong>
                    <p>
                      {r.entry.senses.map((s) => `${s.pos} ${s.zh}`).join("；")}
                    </p>
                    {r.kind === "conflict" && (
                      <small>
                        现有：
                        {index.entries
                          .get(r.target || "")
                          ?.senses.map((s) => `${s.pos} ${s.zh}`)
                          .join("；") || "本次文件内重复"}
                      </small>
                    )}
                  </div>
                  {r.kind === "conflict" ? (
                    <select
                      aria-label={"冲突处理 " + r.entry.word}
                      value={r.choice}
                      onChange={(e) =>
                        setPreview({
                          ...preview,
                          rows: preview.rows.map((x, j) =>
                            j === i
                              ? { ...x, choice: e.target.value as any }
                              : x,
                          ),
                        })
                      }
                    >
                      <option value="keep">复用现有内容</option>
                      <option value="update">更新词条内容</option>
                      <option value="separate">作为不同词条</option>
                    </select>
                  ) : (
                    <span className="tag">
                      {r.kind === "new" ? "新增" : "复用"}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="button-row">
              <button className="outline" disabled={previewPage === 0} onClick={() => setPreviewPage(p => p - 1)}>预览上一页</button>
              <span aria-live="polite">第 {previewPage + 1} / {previewPages} 页</span>
              <button className="outline" disabled={previewPage + 1 >= previewPages} onClick={() => setPreviewPage(p => p + 1)}>预览下一页</button>
            </div>
            <div className="button-row">
              <button
                disabled={!!preview.errors.length || !preview.rows.length}
                onClick={() =>
                  a.run(async () => {
                    await mutate((x) => commitImport(x, preview));
                    setPreview(undefined);
                  }, "词库已导入，个人记录已保留")
                }
              >
                确认导入 {preview.rows.length} 条
              </button>
              <button className="outline" onClick={() => setPreview(undefined)}>
                取消
              </button>
            </div>
            <p className="subtle">
              同形词只有词性与义项一致才建议复用；内容更新不会重置卡片。共享导出不包含个人数据。
            </p>
          </section>
        </div>
      )}
      {remove && (
        <div className="modal-backdrop">
          <section
            className="modal compact"
            role="dialog"
            aria-label="删除词库"
          >
            <h2>删除这本词库？</h2>
            <p>
              将移除词库及关联。词条、笔记、卡片和考试历史仍保留；其他词库中的相同词条不受影响。
            </p>
            <div className="button-row">
              <button
                className="danger"
                onClick={() =>
                  a.run(async () => {
                    await mutate((x) => {
                      x.decks = x.decks.filter((k) => k.id !== remove);
                      x.links = x.links.filter((k) => k.deckId !== remove);
                    });
                    if (deckId === remove) changeDeck("");
                    setRemove(undefined);
                  }, "词库已删除，个人历史已保留")
                }
              >
                删除词库
              </button>
              <button className="outline" onClick={() => setRemove(undefined)}>
                取消
              </button>
            </div>
          </section>
        </div>
      )}
      {editDeck && (
        <div className="modal-backdrop">
          <section
            className="modal compact"
            role="dialog"
            aria-label="编辑词库"
          >
            <h2>
              {d.decks.some((x) => x.id === editDeck.id)
                ? "编辑词库"
                : "新建词库"}
            </h2>
            <label>
              词库名称
              <input
                value={editDeck.name}
                onChange={(e) =>
                  setEditDeck({ ...editDeck, name: e.target.value })
                }
              />
            </label>
            <label>
              主题标签（分号分隔）
              <input
                value={editDeck.tags.join(";")}
                onChange={(e) =>
                  setEditDeck({
                    ...editDeck,
                    tags: e.target.value.split(/[;；]/),
                  })
                }
              />
            </label>
            <label>
              作者
              <input
                value={editDeck.author}
                onChange={(e) =>
                  setEditDeck({ ...editDeck, author: e.target.value })
                }
              />
            </label>
            <label>
              来源与授权
              <input
                value={editDeck.license}
                onChange={(e) =>
                  setEditDeck({ ...editDeck, license: e.target.value })
                }
              />
            </label>
            <div className="button-row">
              <button
                onClick={() =>
                  a.run(async () => {
                    if (!editDeck.name.trim()) throw Error("请填写词库名称");
                    await mutate((x) => {
                      const i = x.decks.findIndex((v) => v.id === editDeck.id);
                      if (i < 0) x.decks.push(editDeck);
                      else x.decks[i] = editDeck;
                    });
                    changeDeck(editDeck.id);
                    setEditDeck(undefined);
                  }, "词库已保存")
                }
              >
                保存
              </button>
              <button
                className="outline"
                onClick={() => setEditDeck(undefined)}
              >
                取消
              </button>
            </div>
          </section>
        </div>
      )}
      {editor && (
        <EntryEditor
          entry={editor}
          deckId={deckId}
          a={a}
          close={() => setEditor(undefined)}
        />
      )}
    </>
  );
}
export function EntryDetail({ id, d, a }: { id: string; d: Data; a: Actions }) {
  const entry = d.entries.find((e) => e.id === id),
    n = noteOf(d, id),
    [text, setText] = useState(n.text),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    setText(noteOf(d, id).text);
    setSaved(false);
  }, [id]);
  if (!entry)
    return (
      <Empty title="词条不存在" text="词库可能已经更新，请返回重新选择。" />
    );
  const card = cardOf(d, id),
    logs = d.logs
      .filter((l) => l.entryId === id)
      .slice(-10)
      .reverse(),
    audioId =
      (d.settings.pronunciation === "us" ? entry.audioUS : entry.audioUK) ||
      entry.audio,
    media = d.media.find((m) => m.id === audioId);
  return (
    <>
      <span className="eyebrow">WORD EXPLORER</span>
      <div className="word-heading">
        <h2>
          <PronounceWord entry={entry} enabled={d.settings.audioEnabled !== false} a={a} />
        </h2>
        <button
          className="icon"
          aria-label="收藏单词"
          onClick={() =>
            a.run(() =>
              mutate((x) => {
                const note = noteOf(x, id);
                if (!x.notes.includes(note)) x.notes.push(note);
                note.favorite = !note.favorite;
              }),
            )
          }
        >
          <Star size={23} fill={n.favorite ? "#c59444" : "none"} />
        </button>
      </div>
      <p className="phonetic">{entry.phonetic || "未提供音标"}</p>
      {media ? (
        <MediaAudio id={media.id} />
      ) : (
        <p className="media-missing">
          <Volume2 size={15} />
          点击英文旁的喇叭，即可使用 Piper 离线美式女声朗读
        </p>
      )}
      <div className="tags">
        {entry.tags.map((t) => (
          <span className="tag" key={t}>
            {t}
          </span>
        ))}
      </div>
      {entry.senses.map((s, i) => (
        <section className="sense" key={s.id}>
          <div className="sense-title">
            <span>{String(i + 1).padStart(2, "0")}</span>
            <b>
              {s.pos} {s.zh}
            </b>
          </div>
          {s.image && d.media.find((m) => m.id === s.image) ? (
            <MediaImage id={s.image} alt={`${entry.word}：${s.zh}`} />
          ) : (
            <div className="media-missing">
              <ImageOff size={15} />
              此义项暂无图片
            </div>
          )}
          <PicturePicker
            entryId={entry.id}
            senseId={s.id}
            hasImage={!!s.image}
            a={a}
          />
          {s.examples.map((ex) => (
            <blockquote key={ex.id}>
              <p>{ex.en}</p>
              <span>{ex.zh}</span>
            </blockquote>
          ))}
          {!s.examples.length && <p className="subtle">此义项暂无例句</p>}
        </section>
      ))}
      {entry.phrase && (
        <div className="phrase">
          <b>常用搭配</b>
          <p>{entry.phrase}</p>
        </div>
      )}
      <label>
        个人笔记
        <textarea
          placeholder="写下你的联想、易错点或自己的例句…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
        />
      </label>
      <button
        className="small outline"
        onClick={() =>
          a.run(async () => {
            await mutate((x) => {
              const note = noteOf(x, id);
              if (!x.notes.includes(note)) x.notes.push(note);
              note.text = text;
            });
            setSaved(true);
          })
        }
      >
        {saved ? "已保存" : "保存笔记"}
      </button>
      <h3 className="history-title">学习历史</h3>
      <p className="subtle">
        {card
          ? `难度 ${Number(card.fsrs.difficulty).toFixed(2)} · 稳定性 ${Number(card.fsrs.stability).toFixed(2)} 天 · 下次到期 ${new Date(card.fsrs.dueAt).toLocaleString("zh-CN")}`
          : "还未开始学习此词"}
      </p>
      {logs.map((l) => (
        <div key={l.id} className="history-row">
          <span>{new Date(l.at).toLocaleString("zh-CN")}</span>
          <span>
            {["", "忘记了", "有点费力", "记得", "很熟悉"][l.rating]}
            {l.undone ? "（已撤销）" : ""}
          </span>
        </div>
      ))}
    </>
  );
}
function EntryEditor({
  entry,
  deckId,
  a,
  close,
}: {
  entry: Entry | "new";
  deckId: string;
  a: Actions;
  close: () => void;
}) {
  const initial: Entry =
    entry === "new"
      ? {
          id: uid(),
          word: "",
          phonetic: "",
          phrase: "",
          tags: [],
          senses: [
            {
              id: uid(),
              pos: "n.",
              zh: "",
              acceptedZh: [],
              variants: [],
              examples: [],
            },
          ],
        }
      : entry;
  const [draft, setDraft] = useState<Entry>(structuredClone(initial));
  const sense = (i: number, patch: Partial<Entry["senses"][number]>) =>
    setDraft({
      ...draft,
      senses: draft.senses.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    });
  return (
    <div className="modal-backdrop">
      <section className="modal wide" role="dialog" aria-label="词条编辑">
        <h2>{entry === "new" ? "添加词条" : "编辑词条"}</h2>
        <p>
          每个义项分别填写词性、释义和例句。保存后可在单词详情添加图片，点击单词即可尝试点读。
        </p>
        <div className="form-columns">
          <label>
            英文单词（必填）
            <input
              aria-label="英文单词"
              value={draft.word}
              onChange={(e) => setDraft({ ...draft, word: e.target.value })}
            />
          </label>
          <label>
            音标
            <input
              value={draft.phonetic}
              onChange={(e) => setDraft({ ...draft, phonetic: e.target.value })}
            />
          </label>
        </div>
        <label>
          常用搭配
          <input
            value={draft.phrase}
            onChange={(e) => setDraft({ ...draft, phrase: e.target.value })}
          />
        </label>
        <label>
          主题标签（分号分隔）
          <input
            value={draft.tags.join(";")}
            onChange={(e) =>
              setDraft({ ...draft, tags: e.target.value.split(/[;；]/) })
            }
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={!!draft.caseSensitive}
            onChange={(e) =>
              setDraft({ ...draft, caseSensitive: e.target.checked })
            }
          />
          英文拼写考试需要区分大小写
        </label>
        {draft.senses.map((s, i) => (
          <section className="sense editor-sense" key={s.id}>
            <div className="section-title">
              <h3>义项 {i + 1}</h3>
              <button
                className="icon"
                aria-label={"删除义项 " + (i + 1)}
                disabled={draft.senses.length === 1}
                onClick={() =>
                  setDraft({
                    ...draft,
                    senses: draft.senses.filter((_, j) => j !== i),
                  })
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="form-columns">
              <label>
                词性
                <input
                  aria-label={"词性 " + (i + 1)}
                  value={s.pos}
                  onChange={(e) => sense(i, { pos: e.target.value })}
                  placeholder="n. / v. / adj."
                />
              </label>
              <label>
                中文释义（必填）
                <input
                  aria-label={"中文释义 " + (i + 1)}
                  value={s.zh}
                  onChange={(e) => sense(i, { zh: e.target.value })}
                />
              </label>
            </div>
            <label>
              考试可接受的中文答案（分号分隔，完整精确匹配）
              <input
                value={s.acceptedZh.join(";")}
                onChange={(e) =>
                  sense(i, { acceptedZh: e.target.value.split(/[;；]/) })
                }
              />
            </label>
            <label>
              明确允许的英文变体（分号分隔）
              <input
                value={s.variants.join(";")}
                onChange={(e) =>
                  sense(i, { variants: e.target.value.split(/[;；]/) })
                }
              />
            </label>
            {s.examples.map((ex, j) => (
              <div className="example-editor" key={ex.id}>
                <div className="form-columns">
                  <label>
                    英文例句
                    <input
                      value={ex.en}
                      onChange={(e) =>
                        sense(i, {
                          examples: s.examples.map((x, k) =>
                            k === j ? { ...x, en: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    中文翻译
                    <input
                      value={ex.zh}
                      onChange={(e) =>
                        sense(i, {
                          examples: s.examples.map((x, k) =>
                            k === j ? { ...x, zh: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
                <button
                  className="text-button"
                  onClick={() =>
                    sense(i, { examples: s.examples.filter((_, k) => k !== j) })
                  }
                >
                  移除此例句
                </button>
              </div>
            ))}
            <button
              className="text-button"
              onClick={() =>
                sense(i, {
                  examples: [...s.examples, { id: uid(), en: "", zh: "" }],
                })
              }
            >
              <Plus size={14} />
              添加此义项的例句
            </button>
          </section>
        ))}
        <button
          className="outline small"
          onClick={() =>
            setDraft({
              ...draft,
              senses: [
                ...draft.senses,
                {
                  id: uid(),
                  pos: "",
                  zh: "",
                  acceptedZh: [],
                  variants: [],
                  examples: [],
                },
              ],
            })
          }
        >
          <Plus size={15} />
          添加义项
        </button>
        <div className="button-row" style={{ marginTop: 25 }}>
          <button
            onClick={() =>
              a.run(async () => {
                const sanitized = {
                  ...draft,
                  audio: undefined,
                  audioUS: undefined,
                  audioUK: undefined,
                  senses: draft.senses.map((s) => ({ ...s, image: undefined })),
                };
                const e = validateEntry(sanitized);
                e.audio = draft.audio;
                e.audioUS = draft.audioUS;
                e.audioUK = draft.audioUK;
                e.senses.forEach((s, i) => (s.image = draft.senses[i].image));
                await mutate((d) => {
                  const i = d.entries.findIndex((x) => x.id === e.id);
                  if (i < 0) d.entries.push(e);
                  else d.entries[i] = e;
                  if (
                    deckId &&
                    !d.links.some(
                      (l) => l.deckId === deckId && l.entryId === e.id,
                    )
                  )
                    d.links.push({ deckId, entryId: e.id });
                });
                close();
              }, "词条已保存，学习与考试历史已保留")
            }
          >
            保存词条
          </button>
          <button className="outline" onClick={close}>
            取消
          </button>
        </div>
      </section>
    </div>
  );
}
