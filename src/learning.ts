import { reviewOrder } from "./review-plan";
import { Data, StudySession, cardOf, isDue, today, uid } from "./types";

export function selectedStudyDeck(d: Data): string {
  const selected = d.settings.studyDeckId;
  if (selected === "") return "";
  if (selected && d.decks.some(deck => deck.id === selected)) return selected;
  return d.decks.find(deck => deck.id === "zip-deck:cet4-shuffled")?.id || d.decks[0]?.id || "";
}
export function studyKey(mode: StudySession["mode"], deckId = "", custom = false) {
  return custom ? "custom:" + mode : deckId ? JSON.stringify([mode, deckId]) : mode;
}
export function sessionKey(s: StudySession) {
  return s.newReviewOf ? JSON.stringify(["new-review", s.deckId || "", s.newReviewOf]) : studyKey(s.mode, s.deckId, s.custom);
}
export function newReviewSource(s: StudySession) {
  return s.id || JSON.stringify([s.deckId || "", s.ids]);
}
/** Prepare a separate recall round without changing due dates or the paused due queue. */
export function prepareNewReview(d: Data) {
  const s = d.study;
  if (!s || s.mode !== "new" || s.custom || !s.ids.length || s.index < s.ids.length) return;
  const source = newReviewSource(s), key = JSON.stringify(["new-review", s.deckId || "", source]);
  d.pausedStudies ||= {};
  if (d.pausedStudies[key]) return;
  const learned = new Set(d.cards.filter(c => c.direction === "en-zh").map(c => c.entryId));
  const ids = [...new Set(s.ids)].filter(id => learned.has(id));
  if (ids.length) d.pausedStudies[key] = { id: uid(), newReviewOf: source, ids, index: 0, mode: "review", deckId: s.deckId, reviewLogIds: [] };
}
export function pendingReview(d: Data, deckId: string) {
  if (d.study?.mode === "review" && matchesStudy(d.study, deckId)) return d.study;
  for (const s of [...Object.values(d.pausedStudies || {}).filter(s => s?.newReviewOf), d.pausedStudies?.[studyKey("review", deckId)]]) {
    if (matchesStudy(s, deckId)) return s;
  }
  return undefined;
}
export function matchesStudy(s: StudySession | undefined, deckId: string) {
  return !!s && !s.custom && (s.deckId || "") === deckId && s.index < s.ids.length;
}
export function pendingStudy(d: Data) {
  const deckId = selectedStudyDeck(d);
  if (matchesStudy(d.study, deckId)) return d.study;
  const review = pendingReview(d, deckId);
  if (review?.newReviewOf) return review;
  for (const mode of ["new", "review", "reinforce"] as const) {
    const paused = d.pausedStudies?.[studyKey(mode, deckId)];
    if (matchesStudy(paused, deckId)) return paused;
  }
  return undefined;
}
export function selectStudy(
  d: Data,
  mode: StudySession["mode"],
  ids?: string[],
) {
  if (mode === "review" && !ids) prepareNewReview(d);
  const current = d.study, deckId = ids || mode === "reinforce" ? "" : selectedStudyDeck(d),
    key = studyKey(mode, deckId, !!ids);
  if (!ids && current?.mode === mode && matchesStudy(current, deckId))
    return;
  const paused = !ids ? (mode === "review" ? pendingReview(d, deckId) : d.pausedStudies?.[key]) : undefined;
  let target: StudySession;
  if (matchesStudy(paused, deckId)) target = paused!;
  else {
    const linked = new Set(d.links.filter(l => !deckId || l.deckId === deckId).map(l => l.entryId));
    const learnedToday = new Set(
      d.logs
        .filter(
          (l) =>
            !l.undone && linked.has(l.entryId) &&
            today(new Date(l.at)) === today() &&
            l.before.fsrs.reps === 0,
        )
        .map((l) => l.entryId),
    ).size;
    const cards = new Map(d.cards.map(c => [c.entryId, c])),
      reinforced = new Set(d.notes.filter(n => n.reinforce).map(n => n.entryId));
    const entries = new Map(d.entries.map(e => [e.id, e]));
    const available = deckId
      ? d.links.filter(l => l.deckId === deckId).flatMap(l => { const e = entries.get(l.entryId); return e ? [e] : []; })
      : d.entries.filter(e => linked.has(e.id));
    const queue =
      ids ||
      (mode === "new"
        ? available
            .filter((e) => !cards.has(e.id))
            .slice(0, Math.max(0, d.settings.daily - learnedToday))
        : mode === "review"
          ? available
              .filter((e) => {
                const c = cards.get(e.id);
                return c && isDue(c);
              })
              .sort(
                (a, b) => reviewOrder(cards.get(a.id)!, cards.get(b.id)!),
              ).slice(0, d.settings.reviewBatch === 0 ? undefined : d.settings.reviewBatch || 20)
          : available.filter((e) =>
              reinforced.has(e.id),
            )
      ).map((e) => e.id);
    if (!queue.length)
      throw Error(
        mode === "new"
          ? "今日新词计划已完成，或暂无新词。可在设置调整计划。"
          : "当前没有需要学习的卡片",
      );
    target = { id: uid(), ids: queue, index: 0, mode, deckId: deckId || undefined, custom: ids ? true : undefined, ...(mode === "review" ? { reviewLogIds: [] } : {}) };
  }
  d.pausedStudies ||= {};
  if (current && current.index < current.ids.length)
    d.pausedStudies[sessionKey(current)] = current;
  delete d.pausedStudies[sessionKey(target)];
  d.study = target;
}
