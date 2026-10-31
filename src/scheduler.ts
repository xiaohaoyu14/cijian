import { DefaultScheduler, Rating } from "ts-fsrs";
import { FSRS7_DEFAULT_WEIGHTS } from "ts-fsrs/models/fsrs-7";
import { Card, Data, uid, cardOf } from "./types";
export const SCHEDULER = "ts-fsrs@6.0.0 / FSRS-7";
const schedulers = new Map<number, ReturnType<typeof DefaultScheduler>>();
export function scheduler(retention: number) {
  if (!schedulers.has(retention))
    schedulers.set(
      retention,
      DefaultScheduler({
        version: "FSRS-7",
        weights: [...FSRS7_DEFAULT_WEIGHTS],
        desiredRetention: retention,
        enableShortTerm: true,
        learningSteps: ["1m", "10m"],
        relearningSteps: ["10m"],
        enableFuzz: false,
      }),
    );
  return schedulers.get(retention)!;
}
export async function rate(
  d: Data,
  entryId: string,
  rating: number,
  now = new Date(),
) {
  const s = await scheduler(d.settings.retention);
  const existing = cardOf(d, entryId);
  const before: Card = existing
    ? structuredClone(existing)
    : {
        id: `${entryId}:en-zh`,
        entryId,
        direction: "en-zh",
        fsrs: s.newCard({ now }),
      };
  const revived = {
    ...before.fsrs,
    dueAt: new Date(before.fsrs.dueAt),
    lastReviewAt: before.fsrs.lastReviewAt
      ? new Date(before.fsrs.lastReviewAt)
      : null,
  };
  const result = s.review({
    card: revived as any,
    grade: rating as 1 | 2 | 3 | 4,
    now,
  });
  const after = { ...before, fsrs: result.card };
  return {
    id: uid(),
    cardId: before.id,
    entryId,
    at: now.toISOString(),
    rating,
    before,
    after,
    scheduler: SCHEDULER,
    config: {
      retention: d.settings.retention,
      resolved: structuredClone(s.config),
    },
    raw: result.revlog,
  };
}
export function applyRating(d: Data, log: Awaited<ReturnType<typeof rate>>) {
  const index = d.cards.findIndex((c) => c.id === log.cardId);
  if (index < 0) d.cards.push(log.after);
  else d.cards[index] = log.after;
  d.logs.push(log);
  if (d.study) {
    d.study.index++;
    d.study.lastLog = log.id;
    if (d.study.mode === "review") (d.study.reviewLogIds ||= []).push(log.id);
  }
  const n = d.notes.find((n) => n.entryId === log.entryId);
  if (n && log.rating >= 3) n.reinforce = false;
}
export function undoRating(d: Data) {
  const id = d.study?.lastLog;
  const log = d.logs.find((l) => l.id === id && !l.undone);
  if (!log) return;
  const latest = d.logs
    .filter((l) => l.cardId === log.cardId && !l.undone)
    .at(-1);
  if (latest?.id !== id) throw Error("已有后续复习，不能撤销此记录");
  const i = d.cards.findIndex((c) => c.id === log.cardId);
  if (log.before.fsrs.reps === 0) d.cards.splice(i, 1);
  else d.cards[i] = log.before;
  log.undone = true;
  if (d.study) {
    d.study.index = Math.max(0, d.study.index - 1);
    delete d.study.lastLog;
  }
}

/** Official scheduler preview only: never creates or applies review logs. */
export async function reviewPreview(card: Card, retention: number, now = new Date()) {
  const s = await scheduler(retention);
  const revived = { ...card.fsrs, dueAt: new Date(card.fsrs.dueAt), lastReviewAt: card.fsrs.lastReviewAt ? new Date(card.fsrs.lastReviewAt) : null };
  return Array.from(s.preview({ card: revived as any, now })).map(result => ({ grade: result.grade, dueAt: new Date(result.card.dueAt).toISOString() }));
}
export async function memoryPrediction(card: Card, retention: number, now = new Date()) {
  if (card.fsrs.scheduleStatus !== "review" || !(Number(card.fsrs.stability) > 0) || !card.fsrs.lastReviewAt) return null;
  const s = await scheduler(retention), last = new Date(card.fsrs.lastReviewAt);
  if (!Number.isFinite(+last) || +last > +now) return null;
  return Array.from({ length: 8 }, (_, day) => {
    const checked = new Date(now.getTime() + day * 86400000);
    const probability = s.model.forgettingCurve(card.fsrs as any, s.chrono.difference(last, checked));
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw Error("记忆估计不可用");
    return { day, probability };
  });
}
