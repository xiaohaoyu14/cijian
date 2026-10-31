import { Card, Data, ReviewLog, StudySession, today } from "./types";

const DAY = 86400000;
export const STAGE_LABELS = { initial: "初学", building: "巩固中", steady: "较稳固", relearning: "待重学" };
export function dayStart(date: Date, offset = 0) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset).getTime();
}
export function calendarAge(value: string | Date | undefined, now: Date): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(+date)) return null;
  const ordinal = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.max(0, Math.round((ordinal(now) - ordinal(date)) / DAY));
}
export function reviewHistory(logs: ReviewLog[]) {
  const sorted = logs.filter(l => !l.undone).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const reviews = sorted.filter(l => l.before.fsrs.reps > 0);
  const successDays = new Set<string>(), streakDays = new Set<string>();
  for (const log of reviews) {
    if (log.rating === 1) streakDays.clear();
    else { successDays.add(today(new Date(log.at))); streakDays.add(today(new Date(log.at))); }
  }
  return {
    firstLearned: sorted.find(l => l.before.fsrs.reps === 0)?.at,
    last: sorted.at(-1), reviews: reviews.length,
    successDays: successDays.size, streakDays: streakDays.size,
    forgotten: reviews.filter(l => l.rating === 1).length,
  };
}
export type History = ReturnType<typeof reviewHistory>;
export function shortTerm(card: Card) {
  return ["learning", "relearning"].includes(card.fsrs.scheduleStatus);
}
export function memoryStage(card: Card, history: History): keyof typeof STAGE_LABELS {
  if (card.fsrs.scheduleStatus === "relearning" || history.last?.rating === 1) return "relearning";
  // An explicit product progress label, never a scheduling rule or a permanence claim.
  if (card.fsrs.scheduleStatus === "review" && Number(card.fsrs.stability) >= 30 && history.streakDays >= 3)
    return "steady";
  if (card.fsrs.scheduleStatus === "learning" || !history.reviews) return "initial";
  return "building";
}
export function reviewOrder(a: Card, b: Card) {
  return Number(shortTerm(b)) - Number(shortTerm(a)) || +new Date(a.fsrs.dueAt) - +new Date(b.fsrs.dueAt) || a.entryId.localeCompare(b.entryId);
}
export function reviewPlan(d: Data, deckId: string, now = new Date()) {
  const linked = new Set(d.links.filter(l => !deckId || l.deckId === deckId).map(l => l.entryId));
  const entries = new Map(d.entries.map(e => [e.id, e]));
  const histories = new Map<string, ReviewLog[]>();
  for (const log of d.logs) {
    if (log.undone || !linked.has(log.entryId)) continue;
    if (!histories.has(log.entryId)) histories.set(log.entryId, []);
    histories.get(log.entryId)!.push(log);
  }
  const rows = d.cards.filter(c => c.direction === "en-zh" && linked.has(c.entryId) && entries.has(c.entryId)).map(card => {
    const history = reviewHistory(histories.get(card.entryId) || []);
    return { card, entry: entries.get(card.entryId)!, history, stage: memoryStage(card, history), due: +new Date(card.fsrs.dueAt) };
  }).sort((a, b) => reviewOrder(a.card, b.card));
  const due = rows.filter(r => r.due <= +now);
  const later = rows.filter(r => r.due > +now && r.due < dayStart(now, 1));
  const todayLogs = [...histories.values()].flat().filter(l => l.before.fsrs.reps > 0 && today(new Date(l.at)) === today(now));
  const sourceLabels = ["今天学的", "昨天学的", "2—6 天前学的", "7—29 天前学的", "30 天及更早学的", "首次学习日期未知"];
  const origins = sourceLabels.map(label => ({ label, count: 0 }));
  for (const row of due) {
    const age = calendarAge(row.history.firstLearned, now);
    const index = age === null ? 5 : age === 0 ? 0 : age === 1 ? 1 : age < 7 ? 2 : age < 30 ? 3 : 4;
    origins[index].count++;
  }
  const forecast = Array.from({ length: 7 }, (_, i) => ({
    date: today(new Date(dayStart(now, i))),
    label: i === 0 ? "今天" : i === 1 ? "明天" : new Date(dayStart(now, i)).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }),
    count: rows.filter(r => r.due < dayStart(now, i + 1) && (i === 0 || r.due >= dayStart(now, i))).length,
  }));
  return {
    rows, due, later, forecast, origins,
    overdue: due.filter(r => r.due < dayStart(now)).length,
    relearning: due.filter(r => shortTerm(r.card)).length,
    doneWords: new Set(todayLogs.map(l => l.entryId)).size,
    feedbacks: todayLogs.length,
    next: rows.filter(r => r.due > +now).sort((a, b) => a.due - b.due)[0]?.due,
    steady: rows.filter(r => r.stage === "steady").length,
  };
}
export function roundResults(d: Data, session: StudySession) {
  const ids = new Set(session.reviewLogIds || []);
  const logs = d.logs.filter(l => ids.has(l.id) && !l.undone);
  return { recorded: !!session.reviewLogIds, partial: logs.length < session.index, words: new Set(logs.map(l => l.entryId)).size,
    grades: [1, 2, 3, 4].map(rating => logs.filter(l => l.rating === rating).length) };
}
export function durationLabel(milliseconds: number) {
  if (milliseconds <= 0) return "现在到期";
  const minutes = Math.max(1, Math.ceil(milliseconds / 60000));
  if (minutes < 60) return `${minutes} 分钟后`;
  if (minutes < 1440) return `${Math.round(minutes / 60 * 10) / 10} 小时后`;
  return `${Math.round(minutes / 1440 * 10) / 10} 天后`;
}
export function dateTime(value: string | Date | number | undefined) {
  return value === undefined ? "暂无记录" : new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
