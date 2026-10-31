import { KeyedActionGate } from "./action-gate";
import { Data, cardOf } from "./types";
import { applyRating, rate, undoRating } from "./scheduler";
import { prepareNewReview, newReviewSource, sessionKey } from "./learning";

// Shared by all study entry points, even if a click navigates to a different page.
export const studyStartGate = new KeyedActionGate(300);
export function studyStartKey(mode: string, deckId: string, ids?: string[]) {
  return JSON.stringify([mode, ids ? { ids } : deckId]);
}
export function studyCursor(d: Data): string {
  const s = d.study;
  if (!s) return "";
  return JSON.stringify([s.id || s.ids, s.deckId || "", s.mode, !!s.custom,
    s.index, s.ids[s.index] || "", s.lastLog || ""]);
}
function assertCursor(d: Data, expected: string) {
  if (!expected || studyCursor(d) !== expected) throw Error("学习任务已更新，本次操作未写入，请重新操作");
}
export function commitStudyRating(d: Data, expected: string, log: Awaited<ReturnType<typeof rate>>) {
  assertCursor(d, expected);
  const current = d.study!;
  if (current.ids[current.index] !== log.entryId) throw Error("当前单词已改变，本次评分未写入");
  const card = cardOf(d, log.entryId);
  if (card ? JSON.stringify(card) !== JSON.stringify(log.before) : log.before.fsrs.reps !== 0)
    throw Error("单词复习记录已改变，本次评分未写入");
  applyRating(d, log);
  prepareNewReview(d);
}
export function commitStudyUndo(d: Data, expected: string) {
  assertCursor(d, expected);
  const s = d.study!;
  const source = s.mode === "new" && s.index === s.ids.length ? newReviewSource(s) : undefined;
  undoRating(d);
  if (source) {
    for (const pending of Object.values(d.pausedStudies || {})) {
      if (pending?.newReviewOf === source && pending.index === 0) delete d.pausedStudies![sessionKey(pending)];
    }
  }
}
