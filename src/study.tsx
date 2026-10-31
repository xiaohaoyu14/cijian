import { ReviewCardInfo, ReviewAnswerPreview, ReviewRoundSummary } from "./reviews-ui";
import { MediaImage, MediaAudio } from "./media";
import { PronounceWord } from "./pronunciation";
import { useState, useRef, useEffect } from "react";
import {
  ArrowLeft,
  Eye,
  RotateCcw,
  Pause,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { Data, cardOf } from "./types";
import { getData, mutate } from "./store";
import { Actions, Empty, PageHead } from "./main";
import { useActionGate } from "./use-action-gate";
import { studyCursor, commitStudyRating, commitStudyUndo } from "./study-actions";
import { rate } from "./scheduler";
import { beginStudy } from "./overview";
export function Study({ d, a }: { d: Data; a: Actions }) {
  const session = d.study,
    [revealedToken, setRevealedToken] = useState<string>(),
    [rating, setRating] = useState(false);
  const gradeGate = useActionGate(300), undoGate = useActionGate(300), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const token = studyCursor(d);
  const id = session?.ids[session.index],
    entry = d.entries.find((e) => e.id === id),
    isNew = id && !cardOf(d, id),
    show = revealedToken === token || isNew;
  if (!session)
    return (
      <Empty
        title="选择今天的学习任务"
        text="从今日学习进入新词、到期复习或巩固列表。"
      >
        <button onClick={() => a.go("today")}>返回今日学习</button>
      </Empty>
    );
  const done = session.index >= session.ids.length;
  const undo = () => {
    if (gradeGate.pending) return;
    const expected = token;
    void undoGate.run(() => a.run(async () => {
      setRating(true);
      try {
        await mutate(x => commitStudyUndo(x, expected));
        gradeGate.resetCooldown();
        if (mounted.current) setRevealedToken(undefined);
      } finally { if (mounted.current) setRating(false); }
    }, "已撤销上次评分，恢复原卡片状态"));
  };
  return (
    <>
      <PageHead
        eyebrow="ONE WORD AT A TIME"
        title={
          session.mode === "new"
            ? "学习新词"
            : session.mode === "review"
              ? session.newReviewOf ? "新词即时复习" : "间隔复习"
              : "错词巩固"
        }
        description={`当前词库：${session?.custom ? "指定巩固范围" : d.decks.find(deck => deck.id === session?.deckId)?.name || "全部词库"}。先回忆，再查看答案。`}
      >
        <button
          className="outline"
          disabled={rating}
          onClick={() => { if (!gradeGate.pending && !undoGate.pending) a.go("today"); }}
        >
          <Pause size={16} />
          暂停并保存
        </button>
      </PageHead>
      <div className="study-progress">
        <span>
          {done ? "本轮已完成" : `${session.index + 1} / ${session.ids.length}`}
        </span>
        <div className="progress-track">
          <i
            style={{
              width:
                Math.round((session.index / session.ids.length) * 100) + "%",
            }}
          />
        </div>
        <button
          disabled={!session.lastLog || rating}
          className="text-button"
          onClick={undo}
        >
          <RotateCcw size={15} />
          撤销上次评分
        </button>
      </div>
      {done ? (
        <section className="panel study-complete">
          <CheckCircle2 size={58} />
          <h2>这一轮，完成了。</h2>
          <p>你已完成 {session.ids.length} 张卡片，记忆正在一点点生根。</p>
          {session.mode === "new" && <><p>刚学过的这一批词，现在就可以再回忆一遍，不用等待到期。</p><button disabled={rating} onClick={() => beginStudy(d, "review", a)}>立即复习这批新词<ArrowRight size={17} /></button></>}
          <p className="subtle">
            短期重学卡片到期后，会再次出现在今日待复习中。
          </p>
          {session.mode === "review" && <ReviewRoundSummary d={d} a={a} />}
          <button onClick={() => a.go("today")}>
            返回今日学习
            <ArrowRight size={17} />
          </button>
        </section>
      ) : !entry ? (
        <Empty title="这张卡片已不存在" text="返回今日学习重新开始。" />
      ) : (
        <section className="panel study-card">
          {session.newReviewOf && <p className="subtle">正在复习刚学过的新词；先回忆再查看答案，评分后继续按 FSRS 安排。</p>}
          <span className="mini-label">
            {isNew ? "NEW WORD · 初次相遇" : "RECALL FIRST · 先回忆"}
          </span>
          <h2>
            <PronounceWord entry={entry} enabled={d.settings.audioEnabled !== false} a={a} />
          </h2>
          <div className="study-context">
            {entry.senses
              .map((s) => s.pos)
              .filter((v, i, arr) => arr.indexOf(v) === i)
              .join(" / ")}
          </div>
          {!show ? (
            <div className="recall-hidden">
              <p>
                这个词是什么意思？
                <br />
                <span>在心里给出答案，然后揭晓。</span>
              </p>
              <button
                onClick={() => {
                  setRevealedToken(token);
                }}
              >
                <Eye size={18} />
                查看答案
              </button>
            </div>
          ) : (
            <div key={token} className={"study-answer" + (!isNew ? " answer-reveal" : "")}>
              <p className="phonetic">{entry.phonetic}</p>
              {entry.senses.map((s) => (
                <div key={s.id}>
                  <h3>
                    {s.pos} {s.zh}
                  </h3>
                  {s.image && d.media.find((m) => m.id === s.image) && (
                    <MediaImage id={s.image} alt={s.zh} />
                  )}{" "}
                  {s.examples.map((ex) => (
                    <blockquote key={ex.id}>
                      <p>{ex.en}</p>
                      <span>{ex.zh}</span>
                    </blockquote>
                  ))}
                </div>
              ))}
              {entry.phrase && <p className="phrase">{entry.phrase}</p>}
              {(() => {
                const mid =
                    (d.settings.pronunciation === "us"
                      ? entry.audioUS
                      : entry.audioUK) || entry.audio,
                  m = d.media.find((m) => m.id === mid);
                return m ? (
                  <MediaAudio id={m.id} />
                ) : (
                  <p className="subtle">
                    点击上方单词或喇叭，可用 Piper 离线点读
                  </p>
                );
              })()}
              <button
                className="text-button"
                onClick={() => a.openEntry(entry.id)}
              >
                笔记与完整详情 ↗
              </button>
              {session.mode === "review" && <><ReviewCardInfo d={d} entryId={entry.id} /><ReviewAnswerPreview d={d} entryId={entry.id} /></>}
              <div className="rating-help">
                “有点费力”指回忆正确但困难；回忆错误应选“忘记了”。
              </div>
              <div className="rating-buttons">
                {["忘记了", "有点费力", "记得", "很熟悉"].map((label, i) => (
                  <button
                    key={label}
                    disabled={rating}
                    className={"rate rate-" + i}
                    onClick={() => {
                      if (undoGate.pending) return;
                      const expected = token;
                      void gradeGate.run(() => a.run(async () => {
                        setRating(true);
                        try {
                          const latest = getData();
                          if (studyCursor(latest) !== expected) throw Error("卡片已更新，请重试");
                          const log = await rate(latest, entry.id, i + 1);
                          await mutate(x => commitStudyRating(x, expected, log));
                          if (mounted.current) setRevealedToken(undefined);
                        } finally { if (mounted.current) setRating(false); }
                      }));
                    }}
                  >
                    <span>{["1", "2", "3", "4"][i]}</span>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
      <p className="study-footnote">
        评分只更新本方向的 FSRS 卡片 · 退出后自动保留本轮进度
      </p>
    </>
  );
}
