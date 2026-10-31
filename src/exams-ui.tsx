import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  ClipboardCheck,
  CheckCircle2,
  RotateCcw,
  BookmarkPlus,
  Flag,
  Play,
  X,
} from "lucide-react";
import { Data, ExamConfig, ExamSession, TYPE_LABEL, noteOf } from "./types";
import { getData, mutate } from "./store";
import { createExam, grade, pool, report, submit, types } from "./exam";
import { Actions, Empty, PageHead } from "./main";
import { beginStudy } from "./overview";
import { PronounceIcon } from "./pronunciation";
const defaultConfig: ExamConfig = {
  decks: [],
  scope: "all",
  tag: "",
  count: 50,
  type: "mixed",
  ratios: [25, 25, 25, 25],
  minutes: 0,
  practice: false,
};
function AnswerInput({
  value,
  disabled,
  onAnswer,
}: {
  value: string;
  disabled: boolean;
  onAnswer: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      aria-label="考试答案"
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      value={draft}
      disabled={disabled}
      placeholder="写下你的答案…"
      onChange={(e) => {
        setDraft(e.target.value);
        onAnswer(e.target.value);
      }}
    />
  );
}
export function Exams({ d, a }: { d: Data; a: Actions }) {
  const [config, setConfig] = useState<ExamConfig>(defaultConfig),
    [view, setView] = useState<string>(),
    [prepared, setPrepared] = useState<ExamSession>(),
    [time, setTime] = useState(Date.now()),
    [confirmSubmit, setConfirmSubmit] = useState(false);
  const active = d.exams.find((e) => e.state === "active"),
    session = d.exams.find((e) => e.id === view),
    tags = [...new Set(d.entries.flatMap((e) => e.tags))],
    available = pool(d, config).length;
  const send = (id: string) =>
    a.run(
      () =>
        mutate((x) => {
          const s = x.exams.find((e) => e.id === id);
          if (s) submit(s);
        }),
      "试卷已提交",
    );
  useEffect(() => {
    const t = setInterval(() => setTime(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Deadline is absolute. Leaving the app never pauses a timed paper.
  useEffect(() => {
    const expired = d.exams.filter(
      (e) =>
        e.state === "active" && e.deadline && Date.parse(e.deadline) <= time,
    );
    if (expired.length)
      a.run(
        () =>
          mutate((x) => {
            for (const e of x.exams)
              if (
                e.state === "active" &&
                e.deadline &&
                Date.parse(e.deadline) <= Date.now()
              )
                submit(e);
          }),
        "限时考试已到期并自动提交",
      );
  }, [time, d.exams]);
  const startPrepared = () =>
    a.run(async () => {
      if (getData().exams.some((e) => e.state === "active"))
        throw Error("请先完成进行中的考试");
      const now = Date.now(),
        p = prepared!;
      p.created = new Date(now).toISOString();
      p.deadline = p.config.minutes
        ? new Date(now + p.config.minutes * 60000).toISOString()
        : undefined;
      await mutate((x) => x.exams.push(p));
      setView(p.id);
      setPrepared(undefined);
    }, "试卷已创建并保存");
  const retry = (old: ExamSession, wrongOnly: boolean) =>
    a.run(async () => {
      if (active) throw Error("请先完成进行中的考试");
      const ids = wrongOnly
        ? old.items
            .filter((i) => old.answers[i.id]?.status === "wrong")
            .map((i) => i.entryId)
        : undefined;
      if (wrongOnly && !ids?.length) throw Error("当前没有已判定的错词");
      const c = {
        ...old.config,
        count: ids ? ids.length : old.config.count,
        entryIds: ids || old.config.entryIds,
      };
      setConfig(c);
      setView(undefined);
      setPrepared(undefined);
      // Keep the exact range on screen even if choice materials are insufficient.
      setPrepared(createExam(getData(), c));
    });
  if (session?.state === "active") {
    const item = session.items[session.index],
      answer = session.answers[item.id],
      value = answer?.value || "",
      left = session.deadline
        ? Math.max(0, Math.ceil((Date.parse(session.deadline) - time) / 1000))
        : null;
    const answerIt = (v: string) =>
      a.run(() =>
        mutate((x) => {
          const s = x.exams.find((e) => e.id === session.id)!;
          if (s.state !== "active") return;
          if (s.deadline && Date.parse(s.deadline) <= Date.now()) {
            submit(s);
            return;
          }
          s.answers[item.id] = {
            itemId: item.id,
            value: v,
            status: "pending",
            method: "auto",
          };
        }),
      );
    const answered = Object.values(session.answers).filter((a) =>
        a.value.trim(),
      ).length,
      locked = session.config.practice && answer?.checked;
    return (
      <>
        <PageHead
          eyebrow={session.config.practice ? "PRACTICE MODE" : "FOCUS MODE"}
          title={session.config.practice ? "练习考试" : "正式考试"}
          description="试题与选项已固定；每次作答都会保存到本地。"
        >
          <button className="outline" onClick={() => setView(undefined)}>
            保存并退出
          </button>
        </PageHead>
        <div className="exam-toolbar">
          <span>
            {session.index + 1} / {session.items.length} 题
          </span>
          <span>{TYPE_LABEL[item.type]}</span>
          <span className={left !== null && left < 60 ? "error-text" : ""}>
            <Clock3 size={16} />
            {left === null
              ? "不限时"
              : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
          </span>
        </div>
        <section className="panel question-card">
          <span className="mini-label">
            QUESTION {String(session.index + 1).padStart(2, "0")}
          </span>
          <h2>
            {item.prompt}{" "}
            {item.type.startsWith("en") && (
              <PronounceIcon entry={item.entry} enabled={d.settings.audioEnabled !== false} a={a} />
            )}
          </h2>
          <p className="question-context">
            {item.sense.pos}{" "}
            {item.type.startsWith("zh")
              ? "· 请根据这一义项回答"
              : "· 请回答此词性下的词义"}
          </p>
          {item.options.length ? (
            <div className="options">
              {item.options.map((option, i) => (
                <button
                  key={option}
                  className={"option " + (value === option ? "chosen" : "")}
                  disabled={locked}
                  onClick={() => answerIt(option)}
                >
                  <span>{"ABCD"[i]}</span>
                  {option}
                </button>
              ))}
            </div>
          ) : (
            <label className="answer-field">
              {item.type === "en-zh" ? "输入中文释义" : "输入英文拼写"}
              <AnswerInput
                key={item.id}
                value={value}
                disabled={!!locked}
                onAnswer={answerIt}
              />
            </label>
          )}
          {session.config.practice && (
            <>
              <button
                className="small outline"
                disabled={!value.trim() || locked}
                onClick={() =>
                  a.run(() =>
                    mutate((x) => {
                      const s = x.exams.find((e) => e.id === session.id)!;
                      if (s.answers[item.id]) s.answers[item.id].checked = true;
                    }),
                  )
                }
              >
                查看本题解析
              </button>
              {locked && (
                <div className="notice">
                  <b>
                    {grade(item, value) === "correct"
                      ? "回答正确"
                      : grade(item, value) === "pending"
                        ? "此答案需要提交后手动确认"
                        : "请核对答案"}
                  </b>
                  <p>参考答案：{item.correct}</p>
                  {item.sense.examples.map((ex) => (
                    <p key={ex.id}>
                      {ex.en}
                      <br />
                      {ex.zh}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="question-actions">
            <button
              className="outline"
              disabled={session.index === 0}
              onClick={() =>
                a.run(() =>
                  mutate((x) => {
                    x.exams.find((e) => e.id === session.id)!.index--;
                  }),
                )
              }
            >
              <ArrowLeft size={16} />
              上一题
            </button>
            {session.index < session.items.length - 1 ? (
              <button
                onClick={() =>
                  a.run(() =>
                    mutate((x) => {
                      x.exams.find((e) => e.id === session.id)!.index++;
                    }),
                  )
                }
              >
                下一题
                <ArrowRight size={16} />
              </button>
            ) : (
              <button onClick={() => setConfirmSubmit(true)}>提交试卷</button>
            )}
          </div>
        </section>
        <section className="panel">
          <div className="section-title">
            <h3>答题卡</h3>
            <span className="subtle">
              已答 {answered} / {session.items.length}
            </span>
          </div>
          <div className="answer-grid">
            {session.items.map((i, n) => (
              <button
                key={i.id}
                className={
                  (session.answers[i.id]?.value.trim() ? "answered " : "") +
                  (n === session.index ? "current" : "")
                }
                onClick={() =>
                  a.run(() =>
                    mutate((x) => {
                      x.exams.find((e) => e.id === session.id)!.index = n;
                    }),
                  )
                }
              >
                {n + 1}
              </button>
            ))}
          </div>
          <button
            className="text-button"
            onClick={() => setConfirmSubmit(true)}
          >
            提前交卷 →
          </button>
        </section>
        {confirmSubmit && (
          <div className="modal-backdrop">
            <section
              className="modal compact"
              role="dialog"
              aria-label="确认提交"
            >
              <h2>提交这份试卷？</h2>
              <p>
                已答 {answered} 题，未答 {session.items.length - answered}{" "}
                题。提交后将生成独立成绩记录。
              </p>
              <div className="button-row">
                <button
                  onClick={() => {
                    setConfirmSubmit(false);
                    send(session.id);
                  }}
                >
                  确认交卷
                </button>
                <button
                  className="outline"
                  onClick={() => setConfirmSubmit(false)}
                >
                  继续答题
                </button>
              </div>
            </section>
          </div>
        )}
      </>
    );
  }
  if (session?.state === "submitted") {
    const r = report(session),
      wrong = session.items.filter(
        (i) => session.answers[i.id]?.status === "wrong",
      );
    return (
      <>
        <PageHead
          eyebrow="YOUR EXAM REPORT"
          title="个人考试报告"
          description={`${new Date(session.created).toLocaleString("zh-CN")} · ${session.items.length} 个不同词条 · ${session.config.practice ? "练习模式" : "正式模式"}`}
        >
          <button className="outline" onClick={() => setView(undefined)}>
            <ArrowLeft size={16} />
            返回考试
          </button>
        </PageHead>
        <section className="panel report-summary">
          <div className="score">
            <strong>{r.score}</strong>
            <span>/ 100</span>
            <p>{r.pending ? "暂定成绩 · 待人工确认" : "最终成绩"}</p>
          </div>
          <div className="report-counts">
            <span>
              <b>{r.correct}</b>正确
            </span>
            <span>
              <b>{r.wrong}</b>错误
            </span>
            <span>
              <b>{r.unanswered}</b>未答
            </span>
            <span>
              <b>{r.pending}</b>待确认
            </span>
          </div>
        </section>
        {r.pending > 0 && (
          <div className="notice">
            中文自由输入不做简单包含判分。未匹配预设可接受答案的作答进入待确认；请对照参考释义，逐题确认是否正确。确认后成绩自动更新。
          </div>
        )}
        <div className="button-row report-buttons">
          <button disabled={!wrong.length} onClick={() => retry(session, true)}>
            <RotateCcw size={17} />
            只重练错词（{wrong.length}）
          </button>
          <button className="outline" onClick={() => retry(session, false)}>
            生成同范围新试卷
          </button>
          <button
            className="outline"
            disabled={!wrong.length}
            onClick={() =>
              a.run(
                () =>
                  mutate((x) => {
                    for (const i of wrong) {
                      const n = noteOf(x, i.entryId);
                      if (!x.notes.includes(n)) x.notes.push(n);
                      n.reinforce = true;
                    }
                  }),
                "错词已加入巩固列表，不直接修改 FSRS",
              )
            }
          >
            <BookmarkPlus size={17} />
            错词加入巩固
          </button>
          <button
            className="text-button"
            onClick={() => beginStudy(d, "reinforce", a)}
          >
            进入回忆巩固 →
          </button>
        </div>
        <section className="panel">
          <h2>按题型统计</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>题型</th>
                  <th>正确 / 题量</th>
                  <th>正确率</th>
                  <th>判分方式</th>
                </tr>
              </thead>
              <tbody>
                {types.map((t) => {
                  const items = session.items.filter((i) => i.type === t),
                    correct = items.filter(
                      (i) => session.answers[i.id]?.status === "correct",
                    ).length,
                    manual = items.filter(
                      (i) => session.answers[i.id]?.method === "manual",
                    ).length;
                  return items.length ? (
                    <tr key={t}>
                      <td>{TYPE_LABEL[t]}</td>
                      <td>
                        {correct} / {items.length}
                      </td>
                      <td>{Math.round((correct / items.length) * 100)}%</td>
                      <td>
                        自动 {items.length - manual} · 人工 {manual}
                      </td>
                    </tr>
                  ) : null;
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <h2>逐题回顾</h2>
          {session.items.map((item, n) => {
            const ans = session.answers[item.id],
              status = ans?.status || "unanswered";
            return (
              <article className={"report-item " + status} key={item.id}>
                <div className="section-title">
                  <h3>
                    {n + 1}. {item.prompt}{" "}
                    <PronounceIcon entry={item.entry} enabled={d.settings.audioEnabled !== false} a={a} />
                    <small>
                      {item.sense.pos} · {TYPE_LABEL[item.type]}
                    </small>
                  </h3>
                  <span className="tag">
                    {
                      {
                        correct: "正确",
                        wrong: "错误",
                        pending: "待确认",
                        unanswered: "未答",
                      }[status]
                    }{" "}
                    · {ans?.method === "manual" ? "人工确认" : "自动判分"}
                  </span>
                </div>
                {item.options.length > 0 && (
                  <p className="subtle">选项：{item.options.join(" / ")}</p>
                )}
                <p>
                  你的答案：<b>{ans?.value || "（未作答）"}</b>
                </p>
                <p>参考答案：{item.correct}</p>
                {item.sense.examples.map((ex) => (
                  <blockquote key={ex.id}>
                    <p>{ex.en}</p>
                    <span>{ex.zh}</span>
                  </blockquote>
                ))}
                {!item.sense.examples.length && (
                  <p className="subtle">此题快照未提供例句</p>
                )}
                {(status === "pending" || ans?.method === "manual") && (
                  <div className="button-row">
                    <button
                      className="small"
                      onClick={() =>
                        a.run(() =>
                          mutate((x) => {
                            const answer = x.exams.find(
                              (e) => e.id === session.id,
                            )!.answers[item.id];
                            answer.status = "correct";
                            answer.method = "manual";
                          }),
                        )
                      }
                    >
                      确认正确
                    </button>
                    <button
                      className="small outline"
                      onClick={() =>
                        a.run(() =>
                          mutate((x) => {
                            const answer = x.exams.find(
                              (e) => e.id === session.id,
                            )!.answers[item.id];
                            answer.status = "wrong";
                            answer.method = "manual";
                          }),
                        )
                      }
                    >
                      确认错误
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      </>
    );
  }
  return (
    <>
      <PageHead
        eyebrow="KNOW WHAT YOU KNOW"
        title="个人考试"
        description="用一次自测，发现已经掌握的词与下一步的方向。"
      />
      {active && (
        <div className="resume-banner">
          <div>
            <h3>你有一场尚未完成的考试</h3>
            <p>
              {active.items.length} 题 · 已答{" "}
              {
                Object.values(active.answers).filter((a) => a.value.trim())
                  .length
              }{" "}
              题{active.deadline ? " · 退出后计时继续" : " · 不限时"}
            </p>
          </div>
          <button onClick={() => setView(active.id)}>
            <Play size={16} />
            继续考试
          </button>
        </div>
      )}
      <div className="exam-setup-grid">
        <section className="panel exam-config">
          <h2>创建一场适合你的考试</h2>
          {config.entryIds && (
            <div className="notice">
              <h3>已固定本场重练范围</h3>
              <p>
                仅从这 {available}{" "}
                个词条抽题。可以调整题量与题型；若不足以生成选择题，请改用填写题。
              </p>
              <button
                className="text-button"
                onClick={() => setConfig({ ...config, entryIds: undefined })}
              >
                取消固定范围，重新选择
              </button>
            </div>
          )}
          <div className="form-section">
            <h3>
              <span>01</span>选择考试范围
            </h3>
            <label>
              词库（不勾选表示全部词库）
              <div className="deck-checkboxes">
                {d.decks.length ? (
                  d.decks.map((deck) => (
                    <label className="check-label" key={deck.id}>
                      <input
                        type="checkbox"
                        disabled={!!config.entryIds}
                        checked={config.decks.includes(deck.id)}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            decks: e.target.checked
                              ? [...config.decks, deck.id]
                              : config.decks.filter((id) => id !== deck.id),
                          })
                        }
                      />
                      {deck.name}
                    </label>
                  ))
                ) : (
                  <span className="subtle">还没有词库，请先导入。</span>
                )}
              </div>
            </label>
            <div className="form-columns">
              <label>
                词条范围
                <select
                  aria-label="考试范围"
                  disabled={!!config.entryIds}
                  value={config.scope}
                  onChange={(e) =>
                    setConfig({ ...config, scope: e.target.value })
                  }
                >
                  <option value="all">全词库（包含尚未学过的词）</option>
                  <option value="learned">已学单词</option>
                  <option value="favorites">收藏单词</option>
                  <option value="wrong">历史错词</option>
                  <option value="tag">指定主题标签</option>
                </select>
              </label>
              {config.scope === "tag" && (
                <label>
                  主题标签
                  <select
                    disabled={!!config.entryIds}
                    value={config.tag}
                    onChange={(e) =>
                      setConfig({ ...config, tag: e.target.value })
                    }
                  >
                    <option value="">选择标签</option>
                    {tags.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <p className="subtle">
              当前可用 <b>{available}</b> 个不同词条
              {!config.entryIds && config.scope === "all"
                ? "，包括尚未学习的内容。"
                : "。"}
            </p>
          </div>
          <div className="form-section">
            <h3>
              <span>02</span>题量与题型
            </h3>
            <div className="segmented">
              {[50, 100].map((n) => (
                <button
                  key={n}
                  className={config.count === n ? "selected" : ""}
                  onClick={() => setConfig({ ...config, count: n })}
                >
                  {n} 词
                </button>
              ))}
              <label>
                自定义
                <input
                  aria-label="自定义题量"
                  type="number"
                  min="1"
                  max="500"
                  value={config.count}
                  onChange={(e) =>
                    setConfig({ ...config, count: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <p className="subtle">
              每词一道题，不重复抽词凑题量。词数不足时请主动调整。
            </p>
            <label>
              题型
              <select
                aria-label="考试题型"
                value={config.type}
                onChange={(e) =>
                  setConfig({ ...config, type: e.target.value as any })
                }
              >
                <option value="mixed">混合模式</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            {config.type === "mixed" && (
              <div className="ratio-grid">
                {types.map((t, i) => (
                  <label key={t}>
                    {TYPE_LABEL[t]}
                    <input
                      aria-label={TYPE_LABEL[t] + "比例"}
                      type="number"
                      min="0"
                      value={config.ratios[i]}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          ratios: config.ratios.map((v, j) =>
                            j === i ? Number(e.target.value) : v,
                          ),
                        })
                      }
                    />
                    <small>比例权重</small>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="form-section">
            <h3>
              <span>03</span>模式与时间
            </h3>
            <div className="form-columns">
              <label>
                考试模式
                <select
                  aria-label="考试模式"
                  value={config.practice ? "practice" : "formal"}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      practice: e.target.value === "practice",
                    })
                  }
                >
                  <option value="formal">正式模式 · 交卷前不显示答案</option>
                  <option value="practice">练习模式 · 答题后可查看解析</option>
                </select>
              </label>
              <label>
                限时（分钟，0 表示不限时）
                <input
                  aria-label="考试限时"
                  type="number"
                  min="0"
                  max="300"
                  value={config.minutes}
                  onChange={(e) =>
                    setConfig({ ...config, minutes: Number(e.target.value) })
                  }
                />
              </label>
            </div>
          </div>
          <button
            disabled={!!active || !available}
            onClick={() =>
              a.run(async () => setPrepared(createExam(getData(), config)))
            }
          >
            生成试卷并预览信息
            <ArrowRight size={17} />
          </button>
        </section>
        <aside className="exam-notes">
          <ClipboardCheck size={32} />
          <h2>
            测的是现在，
            <br />
            练的是未来。
          </h2>
          <p>一次考试有多少词，就有多少个不同词条。</p>
          <p>中文释义无法可靠自动判定时，由你对照词库确认。</p>
          <p>考试记录独立保存，不会把一次选择题答对当成长久记忆。</p>
          <span className="mini-label">YOUR PACE. YOUR PROGRESS.</span>
        </aside>
      </div>
      <section className="panel">
        <h2>
          考试历史{" "}
          <span className="count">
            {d.exams.filter((e) => e.state === "submitted").length}
          </span>
        </h2>
        {d.exams.some((e) => e.state === "submitted") ? (
          <div className="history-list">
            {[...d.exams]
              .reverse()
              .filter((e) => e.state === "submitted")
              .map((e) => {
                const r = report(e);
                return (
                  <button
                    className="exam-history"
                    key={e.id}
                    onClick={() => setView(e.id)}
                  >
                    <ClipboardCheck size={22} />
                    <div>
                      <h3>
                        {e.items.length} 词 ·{" "}
                        {e.config.type === "mixed"
                          ? "混合模式"
                          : TYPE_LABEL[e.config.type]}
                      </h3>
                      <p>
                        {new Date(e.created).toLocaleString("zh-CN")} ·{" "}
                        {r.pending ? "暂定成绩" : "最终成绩"}
                      </p>
                    </div>
                    <b>
                      {r.score}
                      <small>分</small>
                    </b>
                    <ArrowRight size={17} />
                  </button>
                );
              })}
          </div>
        ) : (
          <Empty
            title="每一次自测，都会留下足迹"
            text="完成考试后，在这里查看成绩、错词与巩固方向。"
          />
        )}
      </section>
      {prepared && (
        <div className="modal-backdrop">
          <section
            className="modal compact"
            role="dialog"
            aria-label="确认考试信息"
          >
            <span className="eyebrow">READY WHEN YOU ARE</span>
            <h2>确认考试信息</h2>
            <p>
              {prepared.items.length} 道题，来自{" "}
              {new Set(prepared.items.map((i) => i.entryId)).size} 个不同词条。
            </p>
            {types.map((t) => {
              const n = prepared.items.filter((i) => i.type === t).length;
              return (
                n > 0 && (
                  <p key={t}>
                    {TYPE_LABEL[t]}：{n} 题
                  </p>
                )
              );
            })}
            <p>
              {prepared.config.practice ? "练习模式" : "正式模式"} ·{" "}
              {prepared.config.minutes
                ? `${prepared.config.minutes} 分钟，退出后计时继续`
                : "不限时"}
            </p>
            <p className="subtle">
              试题与选项已固定，开始时记录截止时间。重练建立新考试，不覆盖历史。
            </p>
            <div className="button-row">
              <button onClick={startPrepared}>开始考试</button>
              <button
                className="outline"
                onClick={() => setPrepared(undefined)}
              >
                返回调整
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
