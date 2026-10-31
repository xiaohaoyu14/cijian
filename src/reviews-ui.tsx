import { studyStartGate, studyStartKey } from "./study-actions";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Data, Card } from "./types";
import { Actions, PageHead } from "./main";
import { beginStudy } from "./overview";
import { mutate } from "./store";
import { selectedStudyDeck, matchesStudy, pendingReview, selectStudy } from "./learning";
import { reviewPlan, reviewHistory, memoryStage, STAGE_LABELS, roundResults, dateTime, durationLabel, dayStart } from "./review-plan";
import { memoryPrediction, reviewPreview } from "./scheduler";

export function useReviewClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = setInterval(update, 15000);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, []);
  return now;
}
function MemoryChart({ card, retention }: { card: Card; retention: number }) {
  const [curve, setCurve] = useState<Awaited<ReturnType<typeof memoryPrediction>>>(null);
  useEffect(() => {
    let active = true;
    memoryPrediction(card, retention).then(value => { if (active) setCurve(value); }).catch(() => { if (active) setCurve(null); });
    return () => { active = false; };
  }, [card, retention]);
  if (!curve) return <p className="subtle">当前记录不足以展示长期回忆概率；先按计划复习，继续积累真实反馈。</p>;
  const points = curve.map(p => `${30 + p.day * 40},${160 - p.probability * 130}`).join(" ");
  return <div className="memory-chart">
    <h3>若此后不复习，预计如何变化</h3>
    <p>预计当前回忆概率 <strong>{Math.round(curve[0].probability * 100)}%</strong></p>
    <svg viewBox="0 0 340 190" role="img" aria-label="未来七天不复习的FSRS模型回忆概率估计">
      <line x1="30" x2="310" y1="160" y2="160" stroke="#cbd7ca" />
      <line x1="30" x2="310" y1={160 - retention * 130} y2={160 - retention * 130} stroke="#9baa82" strokeDasharray="4 4" />
      <polyline fill="none" stroke="#2b6a50" strokeWidth="3" points={points} />
      {curve.map(p => <circle key={p.day} cx={30 + p.day * 40} cy={160 - p.probability * 130} r="3" fill="#2b6a50" />)}
      <text x="30" y="181">现在</text><text x="144" y="181">3天后</text><text x="276" y="181">7天后</text>
      <text x="30" y="18">虚线：{Math.round(retention * 100)}%目标</text>
    </svg>
    <small>基于当前FSRS状态和默认参数的模型估计，非实测、非保证；实际复习后曲线会变化。</small>
  </div>;
}
export function ReviewPlan({ d, a }: { d: Data; a: Actions }) {
  const now = useReviewClock(), deckId = selectedStudyDeck(d);
  const plan = useMemo(() => reviewPlan(d, deckId, now), [d, deckId, now]);
  const [filter, setFilter] = useState("due"), [query, setQuery] = useState(""), [page, setPage] = useState(0), [detail, setDetail] = useState<string>();
  useEffect(() => { setFilter("due"); setPage(0); setDetail(undefined); }, [deckId]);
  const saved = pendingReview(d, deckId);
  const deferredQuery = useDeferredValue(query);
  const resume = matchesStudy(saved, deckId), chosenDate = plan.forecast.find(day => day.date === filter);
  const rows = useMemo(() => plan.rows.filter(row => {
    if (filter === "due" && row.due > +now) return false;
    if (filter === "steady" && row.stage !== "steady") return false;
    if (filter === "weak" && row.stage !== "relearning") return false;
    if (chosenDate) {
      const index = plan.forecast.indexOf(chosenDate);
      if (row.due >= dayStart(now, index + 1) || (index > 0 && row.due < dayStart(now, index))) return false;
    }
    return row.entry.word.toLowerCase().includes(deferredQuery.toLowerCase());
  }), [plan, filter, now, chosenDate, deferredQuery]);
  const pages = Math.max(1, Math.ceil(rows.length / 50)), currentPage = Math.min(page, pages - 1), selected = plan.rows.find(row => row.entry.id === detail);
  const switchFilter = (value: string) => { setFilter(value); setPage(0); };
  return <>
    <PageHead eyebrow="REVIEW WITH A PLAN" title="复习计划" description="先回忆，再揭晓；把每一次反馈变成下一次合适的相遇。">
      <button className="outline" onClick={() => a.go("today")}>返回今日学习</button>
    </PageHead>
    <section className="panel review-scope">
      <label>当前复习词库 <select aria-label="复习词库" value={deckId} onChange={e => { const value = e.target.value; void a.run(() => mutate(x => { x.settings.studyDeckId = value; })); }}>
        {d.decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}<option value="">全部词库（混合复习）</option>
      </select></label>
      <p className="subtle">沿用首页的词库选择；共有词条只算一次，学习记录继续共享。</p>
    </section>
    <div className="review-metrics">
      <div><span>现在待复习</span><strong data-testid="review-due">{plan.due.length}</strong><small>含往日逾期 {plan.overdue} 词</small></div>
      <div><span>到期短期学习 / 重学</span><strong>{plan.relearning}</strong><small>优先唤醒不稳的记忆</small></div>
      <div><span>今天稍后到期</span><strong data-testid="review-later">{plan.later.length}</strong><small>未到时间不提前计入待复习</small></div>
      <div><span>今日已复习词数</span><strong data-testid="review-done">{plan.doneWords}</strong><small>{plan.feedbacks} 次反馈，同词不重复计数</small></div>
    </div>
    <section className="panel review-start">
      <div><h2>按自己的节奏，分批完成</h2><p>到期词先处理短期学习 / 重学，再按到期时间从早到晚安排。</p></div>
      <div className="button-row">
        <label>每轮词数 <select aria-label="每轮复习词数" value={d.settings.reviewBatch ?? 20} onChange={e => { const value = Number(e.target.value) as 0 | 20 | 50; void a.run(() => mutate(x => { x.settings.reviewBatch = value; })); }}>
          <option value="20">20 词</option><option value="50">50 词</option><option value="0">全部到期词</option>
        </select></label>
        <button disabled={!plan.due.length && !resume} onClick={() => beginStudy(d, "review", a)}>{resume ? "继续本轮复习" : "开始计划复习"}</button>
      </div>
        {resume && <p className="subtle">{saved?.newReviewOf ? "新词即时复习已准备好，无需等待到期。" : "已有未完成任务："}{saved!.index} / {saved!.ids.length}。调整每轮词数从下一轮生效，不会丢掉当前进度。</p>}
      {!plan.due.length && <p className="notice">现在没有到期词。{plan.next ? `下一次到期：${dateTime(plan.next)}（${durationLabel(plan.next - +now)}）。` : "学过新词并留下真实反馈后，这里会自动形成复习计划。"}</p>}
      {plan.due.length > d.settings.daily * 2 && <p className="notice">复习积压较多，建议先完成一轮复习，今天可少学一些新词。每日新词设置仍由你决定。</p>}
    </section>
    <div className="review-columns">
      <section className="panel"><h2>今天到期的词，什么时候学过</h2><p className="subtle">按首次学习记录分组，仅用于查看；实际到期时间由FSRS逐词计算。</p>
        <div className="review-origins">{plan.origins.map(group => <div key={group.label}><span>{group.label}</span><strong>{group.count}</strong></div>)}</div>
      </section>
      <section className="panel"><h2>未来七天到期安排</h2><p className="subtle">今天包含积压。只统计当前已有卡片，不含以后新学或重学增加的任务；会随反馈变化。</p>
        <div className="review-calendar">{plan.forecast.map(day => <button key={day.date} aria-label={`查看${day.label}到期词`} aria-pressed={filter === day.date} onClick={() => switchFilter(day.date)}><span>{day.label}</span><strong>{day.count}</strong></button>)}</div>
      </section>
    </div>
    <section className="panel">
      <div className="section-title"><h2>单词记忆档案</h2><span className="subtle">已学 {plan.rows.length} 词 · 较稳固 {plan.steady} 词</span></div>
      <div className="review-filters">{[["due", "现在到期"], ["weak", "待重学"], ["steady", "较稳固"], ["all", "全部已学"]].map(([value, label]) => <button className="outline small" key={value} aria-pressed={filter === value} onClick={() => switchFilter(value)}>{label}</button>)}</div>
      {chosenDate && <p>正在查看：{chosenDate.label}到期的词{chosenDate === plan.forecast[0] ? "（含积压）" : ""}</p>}
      <input aria-label="查找复习单词" placeholder="查找英文单词" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} />
      <div className="review-word-list" aria-busy={query !== deferredQuery}>{rows.slice(currentPage * 50, (currentPage + 1) * 50).map(row => <button key={row.card.id} className="review-word-row" aria-label={`查看记忆档案 ${row.entry.word}`} onClick={() => setDetail(row.entry.id)}>
        <div><strong>{row.entry.word}</strong><small>已复习 {row.history.reviews} 次 · 成功回忆 {row.history.successDays} 天</small></div>
        <div><span className="tag">{STAGE_LABELS[row.stage]}</span><small>{dateTime(row.due)} 到期</small></div>
      </button>)}</div>
      {!rows.length && <p className="review-empty">当前没有符合条件的已学词。这里只显示真实学习记录，不会填充演示进度。</p>}
      <div className="button-row"><button className="outline small" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{rows.length} 词 · 第 {currentPage + 1} / {pages} 页</span><button className="outline small" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button></div>
    </section>
    <section className="panel review-explanation"><h2>怎样才算记得更稳</h2><p>没有“记满几次就永远不忘”的次数。我们记录实际跨日回忆表现，而不是把当天连续点击当作长期掌握。</p><p>“较稳固”是进度标签：处于长期复习状态、最近一次忘记之后在至少3个不同日期回忆正确，且模型稳定性达到30天。它是本软件的展示规则，不是记忆保证，也不会停止安排复习。</p><p>“有点费力”仍表示回忆正确但困难；回忆错误请选择“忘记了”。保持率目标为 {Math.round(d.settings.retention * 100)}%，可在原设置中调整，目标并非保证。</p></section>
    {selected && <div className="modal-backdrop"><section className="modal compact review-memory" role="dialog" aria-label="单词记忆档案">
      <button className="icon close" aria-label="关闭记忆档案" onClick={() => setDetail(undefined)}>×</button>
      <span className="eyebrow">YOUR MEMORY RECORD</span><h2>{selected.entry.word}</h2><p>{selected.entry.senses.map(s => `${s.pos} ${s.zh}`).join("；")}</p>
      <span className="tag">{STAGE_LABELS[selected.stage]}</span>
      <dl className="memory-facts"><div><dt>首次学习</dt><dd>{dateTime(selected.history.firstLearned)}</dd></div><div><dt>最近反馈</dt><dd>{dateTime(selected.history.last?.at)}</dd></div><div><dt>复习反馈次数</dt><dd>{selected.history.reviews}</dd></div><div><dt>成功回忆天数</dt><dd>{selected.history.successDays} 天（同日只计一天）</dd></div><div><dt>最近忘记后成功天数</dt><dd>{selected.history.streakDays} 天</dd></div><div><dt>复习中忘记次数</dt><dd>{selected.history.forgotten}</dd></div><div><dt>模型稳定性</dt><dd>{Number(selected.card.fsrs.stability || 0).toFixed(1)} 天</dd></div><div><dt>下次到期</dt><dd>{dateTime(selected.due)}</dd></div></dl>
      <MemoryChart card={selected.card} retention={d.settings.retention} />
      <p className="subtle">次数来自未撤销的回忆日志，不包含首次讲解、浏览或考试。成功天数累计的是回忆正确的日期，不要求每天连续；忘记后重新累计近期成功天数。</p>
    </section></div>}
  </>;
}
export function ReviewCardInfo({ d, entryId }: { d: Data; entryId: string }) {
  const history = useMemo(() => reviewHistory(d.logs.filter(l => l.entryId === entryId)), [d.logs, entryId]);
  const card = d.cards.find(c => c.entryId === entryId);
  return card ? <div className="review-card-info"><span>{STAGE_LABELS[memoryStage(card, history)]}</span><span>复习 {history.reviews} 次 · 成功回忆 {history.successDays} 天</span><span>上次：{dateTime(card.fsrs.lastReviewAt || undefined)}</span></div> : null;
}
export function ReviewAnswerPreview({ d, entryId }: { d: Data; entryId: string }) {
  const card = d.cards.find(c => c.entryId === entryId), now = useReviewClock();
  const [values, setValues] = useState<Awaited<ReturnType<typeof reviewPreview>>>([]);
  useEffect(() => {
    let active = true;setValues([]);
    if (card) reviewPreview(card, d.settings.retention, now).then(result => { if (active) setValues(result); }).catch(() => {});
    return () => { active = false; };
  }, [card, d.settings.retention, now]);
  if (!values.length) return null;
  return <div className="review-answer-preview"><p>选择反馈后，预计下次复习</p><div>{values.map(item => <span key={item.grade} title={dateTime(item.dueAt)}><b>{["忘记了", "有点费力", "记得", "很熟悉"][item.grade - 1]}</b>{durationLabel(+new Date(item.dueAt) - +now)}</span>)}</div><small>预览不写入记录；实际时间以点击反馈时的调度结果为准。</small></div>;
}
export function ReviewRoundSummary({ d, a }: { d: Data; a: Actions }) {
  const session = d.study!, now = useReviewClock();
  const plan = useMemo(() => reviewPlan(d, session.deckId || "", now), [d, session.deckId, now]);
  const result = roundResults(d, session);
  return <div className="review-round-summary"><h3>这一轮结束，计划还在继续</h3>
    {result.recorded ? <><p>{result.partial ? `本轮共有 ${session.ids.length} 词，已保存 ${result.words} 词的反馈明细（旧任务可能只覆盖升级后的部分）。` : `本轮已处理 ${result.words} 个不同词。`}</p><div className="review-result-grades">{result.grades.map((count, index) => <span key={index}>{["忘记了", "有点费力", "记得", "很熟悉"][index]} <b>{count}</b></span>)}</div></> : <p>旧任务未记录本轮反馈明细；原有复习日志仍完整保留。</p>}
    <p>现在仍有 <strong>{plan.due.length}</strong> 词到期，今天稍后还有 <strong>{plan.later.length}</strong> 词到期。</p>
    {plan.next && <p>下次到期：{dateTime(plan.next)}（{durationLabel(plan.next - +now)}）。忘记的词到达短期重学时间后再安排。</p>}
    <div className="button-row"><button disabled={!plan.due.length} onClick={() => studyStartGate.run(studyStartKey("review", session.deckId || ""), () => a.run(async () => { await mutate(x => { x.settings.studyDeckId = session.deckId || ""; selectStudy(x, "review"); }); }))}>继续下一批复习</button><button className="outline" onClick={() => a.go("review-plan")}>查看复习计划</button></div>
  </div>;
}
