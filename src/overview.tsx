import { BackupPanel } from "./backup-ui";
import { studyStartGate, studyStartKey } from "./study-actions";
import { stopPronunciation } from "./pronunciation";
import { APP_VERSION } from "./version";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  RotateCcw,
  Target,
  Plus,
  Check,
  Sprout,
  Clock3,
  Flame,
  ArrowUpRight,
  CalendarDays,
  Bookmark,
} from "lucide-react";
import { Data, cardOf, isDue, today } from "./types";
import { mutate, mediaBytes } from "./store";
import { addDemo } from "./demo";
import { Actions, Empty, PageHead } from "./main";
import { selectStudy, selectedStudyDeck, pendingStudy, pendingReview } from "./learning";
export function beginStudy(
  d: Data,
  mode: "new" | "review" | "reinforce",
  a: Actions,
  ids?: string[],
) {
  return studyStartGate.run(studyStartKey(mode, mode === "reinforce" ? "" : selectedStudyDeck(d), ids), () => a.run(async () => {
    await mutate((x) => selectStudy(x, mode, ids));
    a.go("study");
  }));
}
export function Dashboard({ d, a }: { d: Data; a: Actions }) {
  const deckId = selectedStudyDeck(d),
    currentDeck = d.decks.find(deck => deck.id === deckId),
    linkedIds = new Set(d.links.filter(l => !deckId || l.deckId === deckId).map(l => l.entryId)),
    cardIds = new Set(d.cards.map(c => c.entryId));
  const logs = d.logs.filter((l) => !l.undone),
    daily = logs.filter((l) => linkedIds.has(l.entryId) && today(new Date(l.at)) === today()),
    fresh = new Set(
      daily.filter((l) => l.before.fsrs.reps === 0).map((l) => l.entryId),
    ).size,
    reviews = daily.filter((l) => l.before.fsrs.reps > 0).length,
    due = d.cards.filter(
      (c) => isDue(c) && linkedIds.has(c.entryId),
    ).length,
    newCount = d.entries.filter(
      (e) => !cardIds.has(e.id) && linkedIds.has(e.id),
    ).length,
    progress = Math.min(100, (fresh / d.settings.daily) * 100),
    pending = pendingStudy(d), readyReview = pendingReview(d, deckId);
  const date = new Date().toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const days = new Set(logs.map((l) => today(new Date(l.at))));
  let streak = 0;
  for (let i = 0; i < 366; i++) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    if (days.has(today(day))) streak++;
    else if (i !== 0) break;
  }
  return (
    <>
      <PageHead
        eyebrow="A LITTLE EVERY DAY"
        title="今日学习"
        description="不必一口气记住所有，今天再前进一步。"
      >
        <span className="date-chip">
          <CalendarDays size={16} />
          {date}
        </span>
      </PageHead>
      <section className="panel study-deck-picker" aria-label="学习词库选择">
        <div>
          <label htmlFor="study-deck">选择学习词库</label>
          <p>当前词库：<strong>{currentDeck?.name || "全部词库"}</strong> · {linkedIds.size} 个词条</p>
          <small>新词与复习按所选词库安排，共有词条的学习进度共用。</small>
        </div>
        <select id="study-deck" aria-label="学习词库" value={deckId} onChange={e => {
          const id = e.target.value;
          stopPronunciation();
          void a.run(() => mutate(x => { x.settings.studyDeckId = id; }));
        }}>
          {d.decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
          <option value="">全部词库（混合学习）</option>
        </select>
      </section>
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-kicker">
            <span /> 属于你的词汇成长计划
          </span>
          <h2>
            让每一次相遇，
            <br />
            都成为更牢固的记忆。
          </h2>
          <p>
            先唤醒旧知，再认识新词。
            <br className="mobile-br" /> 按照记忆的节奏，慢慢积累。
          </p>
          <button
            className="light"
            onClick={() =>
              beginStudy(d, pending ? pending.mode : due ? "review" : "new", a)
            }
          >
            {pending ? "继续上次学习" : due ? "开始今日复习" : "开始学习新词"}
            <ArrowRight size={17} />
          </button>
          <span className="hero-foot">
            {due
              ? `${due} 个词等待再次相遇`
              : `今日计划 · ${d.settings.daily} 个新词`}
          </span>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span className="art-star">✧</span>
          <div className="word-card back-card">
            <span>re·mem·ber</span>
            <small>记住每一次进步</small>
          </div>
          <div className="word-card front-card">
            <span className="word-tag">WORD BY WORD</span>
            <h3>grow</h3>
            <small>/ɡrəʊ/</small>
            <div className="art-line" />
            <b>v. 成长；逐渐变得</b>
            <p>A little progress, every day.</p>
            <span className="art-leaf">
              <Sprout size={35} />
            </span>
          </div>
          <span className="art-small">让积累发生。</span>
        </div>
      </section>
      <div className="metrics">
        <Metric
          icon={<RotateCcw />}
          label="待复习"
          value={due}
          suffix="词"
          note="根据实际到期时间"
          color="peach"
        />
        <Metric
          icon={<BookOpen />}
          label="今日新词"
          value={`${fresh} / ${d.settings.daily}`}
          suffix="词"
          note={`当前词库还有 ${newCount} 个新词`}
          color="green"
        />
        <Metric
          icon={<Target />}
          label="今日已复习"
          value={reviews}
          suffix="次"
          note="每次回忆都算进步"
          color="blue"
        />
        <Metric
          icon={<Flame />}
          label="连续学习"
          value={streak}
          suffix="天"
          note={streak ? "保持自己的节奏" : "从今天，开启积累"}
          color="yellow"
        />
      </div>
      {due > d.settings.daily * 2 && (
        <div className="notice">
          目前积压 {due}{" "}
          张复习卡片，建议先复习，或在设置中减少每日新词量。你仍可自行选择学习新词。
        </div>
      )}
      <div className="dashboard-grid">
        <section className="panel plan-panel">
          <div className="section-title">
            <h2>今天，学一点</h2>
            <span className="subtle">YOUR DAILY ROUTINE</span>
          </div>
          <div className="routine-row">
            <span className="routine-icon peach">
              <RotateCcw />
            </span>
            <div>
              <h3>唤醒记忆</h3>
              <p>{readyReview?.newReviewOf ? `新词即时复习：还剩 ${readyReview.ids.length - readyReview.index} 词，无需等待到期` : "先回忆，再揭晓答案"}</p>
            </div>
            <b>
              {due}
              <small> 个待复习</small>
            </b>
            <button
              className="small outline"
              onClick={() => beginStudy(d, "review", a)}
            >
              开始复习
              <ArrowRight size={15} />
            </button>
          </div>
          <div className="review-plan-shortcut"><button className="text-button" onClick={() => a.go("review-plan")}>查看复习计划 →</button><small>到期日历 · 分批复习 · 记忆档案</small></div>
          <div className="routine-row">
            <span className="routine-icon green">
              <BookOpen />
            </span>
            <div>
              <h3>认识新词</h3>
              <p>让词义、例句连接起来</p>
            </div>
            <b>
              {Math.max(0, Math.min(newCount, d.settings.daily - fresh))}
              <small> 个计划内</small>
            </b>
            <button
              className="small outline"
              onClick={() => beginStudy(d, "new", a)}
            >
              学习新词
              <ArrowRight size={15} />
            </button>
          </div>
          <div className="daily-progress">
            <div>
              <span>新词计划完成度</span>
              <b>{Math.round(progress)}%</b>
            </div>
            <div className="progress-track">
              <i style={{ width: progress + "%" }} />
            </div>
            <small>
              {fresh >= d.settings.daily
                ? "今天的目标达成了。"
                : "一点一滴，也会成为很大的进步。"}
            </small>
          </div>
        </section>
        <section className="exam-teaser">
          <span className="mini-label">CHECK YOURSELF</span>
          <ClipboardIllustration />
          <h2>
            记住了多少，
            <br />
            试一试就知道。
          </h2>
          <p>
            自由选择范围与题型，
            <br />
            用一次自测发现需要巩固的词。
          </p>
          <button className="text-button" onClick={() => a.go("exam")}>
            开始个人自测
            <ArrowUpRight size={18} />
          </button>
        </section>
      </div>
      <div className="section-title library-title">
        <h2>
          我的词库 <span className="count">{d.decks.length}</span>
        </h2>
        <button className="text-button" onClick={() => a.go("decks")}>
          管理词库
          <ArrowRight size={15} />
        </button>
      </div>
      {d.decks.length ? (
        <div className="deck-grid">
          {d.decks.slice(0, 3).map((deck, i) => (
            <button
              className="deck-preview"
              key={deck.id}
              onClick={() => a.go("decks")}
            >
              <span className={"book-cover cover-" + i}>
                <BookOpen />
                <small>{deck.demo ? "STARTER" : "MY WORDS"}</small>
              </span>
              <div>
                <h3>{deck.name}</h3>
                <p>
                  {d.links.filter((l) => l.deckId === deck.id).length} 词条 ·{" "}
                  {deck.demo ? "示例内容" : "本地词库"}
                </p>
                <span className="tag">{deck.tags[0] || "自定义词库"}</span>
              </div>
              <Chevron />
            </button>
          ))}
        </div>
      ) : (
        <div className="welcome-import">
          <div>
            <h3>你的词汇旅程，从一本词库开始。</h3>
            <p>
              导入自己的 CSV / ZIP 词库，也可以添加 120 词示例词库体验功能。
            </p>
          </div>
          <button className="outline" onClick={() => a.go("decks")}>
            <Plus size={17} />
            导入词库
          </button>
          <button
            className="text-button"
            onClick={() =>
              a.run(() => mutate(addDemo), "已添加示例词库，没有生成学习记录")
            }
          >
            添加示例
          </button>
        </div>
      )}
    </>
  );
}
function Chevron() {
  return <ArrowUpRight size={17} className="subtle" />;
}
function ClipboardIllustration() {
  return (
    <div className="clipboard-art">
      <div />
      <span>✓</span>
      <i />
      <span>✓</span>
      <i />
      <span>○</span>
      <i />
    </div>
  );
}
function Metric({
  icon,
  label,
  value,
  suffix,
  note,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  suffix: string;
  note: string;
  color: string;
}) {
  return (
    <section className="metric">
      <span className={"metric-icon " + color}>{icon}</span>
      <span className="metric-label">{label}</span>
      <strong>
        {value}
        <small>{suffix}</small>
      </strong>
      <p>{note}</p>
    </section>
  );
}
export function Statistics({ d, a }: { d: Data; a: Actions }) {
  const logs = d.logs.filter((l) => !l.undone),
    recalls = logs.filter((l) => l.before.fsrs.reps > 0),
    submitted = d.exams.filter((e) => e.state === "submitted"),
    answers = submitted.flatMap((e) =>
      e.items.map((i) => ({ type: i.type, a: e.answers[i.id] })),
    ),
    choices = answers.filter((x) => x.type.includes("choice")),
    spelling = answers.filter((x) => x.type === "zh-en");
  const acc = (xs: typeof answers) =>
    xs.length
      ? Math.round(
          (xs.filter((x) => x.a?.status === "correct").length / xs.length) *
            100,
        ) + "%"
      : "—";
  const days = Array.from({ length: 14 }, (_, i) => {
    const dt = new Date();
    dt.setDate(dt.getDate() - 13 + i);
    const key = today(dt),
      ls = logs.filter((l) => today(new Date(l.at)) === key);
    return {
      key,
      label: `${dt.getMonth() + 1}/${dt.getDate()}`,
      fresh: ls.filter((l) => l.before.fsrs.reps === 0).length,
      review: ls.filter((l) => l.before.fsrs.reps > 0).length,
      exams: submitted.filter((e) => today(new Date(e.submitted!)) === key)
        .length,
    };
  });
  const max = Math.max(1, ...days.map((x) => x.fresh + x.review));
  return (
    <>
      <PageHead
        eyebrow="YOUR PROGRESS"
        title="学习统计"
        description="真实的每一次回忆，都是成长的证据。"
      />
      <div className="metrics">
        <Metric
          icon={<BookOpen />}
          label="累计学习词条"
          value={d.cards.length}
          suffix="词"
          note="英文识义方向"
          color="green"
        />
        <Metric
          icon={<RotateCcw />}
          label="自评回忆成功"
          value={
            recalls.length
              ? Math.round(
                  (recalls.filter((l) => l.rating >= 2).length /
                    recalls.length) *
                    100,
                ) + "%"
              : "—"
          }
          suffix=""
          note="有点费力 / 记得 / 很熟悉"
          color="peach"
        />
        <Metric
          icon={<Check />}
          label="选择题正确率"
          value={acc(choices)}
          suffix=""
          note={`已提交 ${choices.length} 题，未答计入分母`}
          color="blue"
        />
        <Metric
          icon={<Target />}
          label="拼写正确率"
          value={acc(spelling)}
          suffix=""
          note={`已提交 ${spelling.length} 题，未答计入分母`}
          color="yellow"
        />
      </div>
      <section className="panel">
        <div className="section-title">
          <h2>近 14 天的积累</h2>
          <span className="subtle">
            新学 <span className="legend fresh" /> 复习{" "}
            <span className="legend review" />
          </span>
        </div>
        <div className="bar-chart">
          {days.map((x) => (
            <div
              key={x.key}
              className="bar-col"
              title={`${x.key} 新学 ${x.fresh} / 复习 ${x.review} / 考试 ${x.exams}`}
            >
              <small>{x.fresh + x.review || ""}</small>
              <div className="bar-space">
                <div
                  className="bar fresh"
                  style={{ height: (x.fresh / max) * 135 + "px" }}
                />
                <div
                  className="bar review"
                  style={{ height: (x.review / max) * 135 + "px" }}
                />
              </div>
              <span>{x.label}</span>
            </div>
          ))}
        </div>
        <p className="subtle">
          考试：{submitted.length} 场 · 待确认中文题：
          {answers.filter((x) => x.a?.status === "pending").length} 题 ·
          到期复习积压：{d.cards.filter((c) => isDue(c)).length} 张
        </p>
      </section>
      <section className="panel">
        <h2>每日明细</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>新学</th>
                <th>复习</th>
                <th>完成考试</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((x) => (
                <tr key={x.key}>
                  <td>{x.key}</td>
                  <td>{x.fresh}</td>
                  <td>{x.review}</td>
                  <td>{x.exams}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="notice">
        自评回忆表现、选择题与拼写分别统计；考试成绩不会直接改变 FSRS
        学习状态。自评中的“有点费力”表示回忆正确但困难。
      </div>
    </>
  );
}
export function Settings({ d, a }: { d: Data; a: Actions }) {
  const [daily, setDaily] = useState(String(d.settings.daily)),
    [retention, setRetention] = useState(
      String(Math.round(d.settings.retention * 100)),
    ),
    [voice, setVoice] = useState(d.settings.pronunciation);
  useEffect(() => {
    setDaily(String(d.settings.daily));
    setRetention(String(Math.round(d.settings.retention * 100)));
    setVoice(d.settings.pronunciation);
  }, [d.settings.daily, d.settings.retention, d.settings.pronunciation]);
  return (
    <>
      <PageHead
        eyebrow="MAKE IT YOURS"
        title="偏好设置"
        description="调整学习节奏，也照顾好你的数据。"
      />
      <section className="panel settings-panel">
        <h2>学习计划</h2>
        <div className="settings-row">
          <div>
            <h3>Piper 单词点读</h3>
            <p>
              点击单词或喇叭实时朗读；en_US-lessac-high
              美式女声，无需系统语音包。首次使用会加载内置模型。
            </p>
          </div>
          <button
            role="switch"
            aria-label="开启发音"
            aria-checked={d.settings.audioEnabled !== false}
            className="outline"
            onClick={() =>
              a.run(async () => {
                stopPronunciation();
                await mutate((x) => {
                  x.settings.audioEnabled = x.settings.audioEnabled === false;
                });
              })
            }
          >
            {d.settings.audioEnabled === false ? "已关闭" : "已开启"}
          </button>
        </div>
        <div className="settings-row">
          <div>
            <h3>每日新词数量</h3>
            <p>复习积压时，可以适当减少。范围 1–200。</p>
          </div>
          <input
            aria-label="每日新词数量"
            type="number"
            min="1"
            max="200"
            value={daily}
            onChange={(e) => setDaily(e.target.value)}
          />
        </div>
        <div className="settings-row">
          <div>
            <h3>目标保持率</h3>
            <p>
              FSRS 的调度目标，并非记忆效果的保证。更高目标通常需要更多复习。
            </p>
          </div>
          <label className="inline">
            <input
              aria-label="目标保持率"
              type="number"
              min="70"
              max="97"
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
            />
            %
          </label>
        </div>
        <div className="settings-row">
          <div>
            <h3>发音偏好</h3>
            <p>
              此项控制词库自带音频的英美偏好。单词喇叭固定使用内置 Piper
              美式女声，不依赖系统 TTS。
            </p>
          </div>
          <select
            aria-label="发音偏好"
            value={voice}
            onChange={(e) => setVoice(e.target.value as "us" | "uk")}
          >
            <option value="us">美式发音</option>
            <option value="uk">英式发音</option>
          </select>
        </div>
        <button
          onClick={() =>
            a.run(async () => {
              const n = Number(daily),
                r = Number(retention);
              if (
                !Number.isInteger(n) ||
                n < 1 ||
                n > 200 ||
                !Number.isFinite(r) ||
                r < 70 ||
                r > 97
              )
                throw Error("请填写有效的每日数量和保持率");
              await mutate((x) => {
                x.settings = {
                  ...x.settings,
                  daily: n,
                  retention: r / 100,
                  pronunciation: voice,
                };
              });
            }, "设置已保存")
          }
        >
          保存设置
        </button>
        <p className="subtle">
          调度器：ts-fsrs 6.0.0 ·
          FSRS-7。参数变更在下一次评分时生效，保留原始历史。
        </p>
      </section>
      <BackupPanel d={d} a={a} />
      <section className="panel">
        <h2>图片、语音与存储</h2>
        <p>
          当前媒体 {d.media.length} 个，文件内容约{" "}
          {(
            d.media.reduce((total, m) => total + mediaBytes(m), 0) /
            1024 /
            1024
          ).toFixed(2)}{" "}
          MB。此数不含数据库编码和内置 Piper 模型，实际设备占用更大。
        </p>
        <p>
          添加的图片自动缩至最长边 960 像素，每张最多 250
          KB；媒体分开保存，日常只读取当前词条。完整导出时会临时读取媒体。
        </p>
        <p>
          点击单词喇叭使用 APK 内置的 Piper
          高精度美式女声模型，实时推理，不调用系统或在线语音。模型约114
          MB，首次解包另需约132
          MB空间；仅支持arm64-v8a设备。词库原有音频播放器仍可使用。
        </p>
        <h2>关于本地存储</h2>
        <p>
          安卓应用将数据保存在自身 WebView 的 IndexedDB
          中，位于应用私有数据目录。默认无需账号；仅手动使用云存档时连接你配置的服务。卸载应用或清除应用数据会移除本机记录，请定期导出或备份。
        </p>
        <p>
          桌面开发版数据位于当前浏览器、当前站点的
          IndexedDB（cijian-local-v1）。它与安卓应用的数据空间独立，可以通过备份迁移。
        </p>
        <p className="subtle">
          词间 {APP_VERSION} · 首版仅对英文识义卡片进行 FSRS
          调度。拼写、选择等题型用于独立考试。
        </p>
      </section>
    </>
  );
}
