import { Card, Data, Entry, UserNote, isDue } from "./types";

export const WORD_PAGE_SIZE = 50;
export function vocabularyIndex(d: Data) {
  const entries = new Map(d.entries.map(e => [e.id, e]));
  const cards = new Map<string, Card>();
  for (const c of d.cards) if (c.direction === "en-zh") cards.set(c.entryId, c);
  const notes = new Map<string, UserNote>(d.notes.map(n => [n.entryId, n]));
  const linked = new Set<string>(), decks = new Map<string, Set<string>>();
  for (const link of d.links) {
    if (!entries.has(link.entryId)) continue;
    linked.add(link.entryId);
    if (!decks.has(link.deckId)) decks.set(link.deckId, new Set());
    decks.get(link.deckId)!.add(link.entryId);
  }
  const search = new Map(d.entries.map(e => [e.id,
    `${e.word} ${e.senses.map(s => `${s.zh} ${s.pos}`).join(" ")} ${e.tags.join(" ")}`.toLowerCase(),
  ]));
  return { entries, cards, notes, linked, decks, search };
}
export function vocabularyCounts(index: ReturnType<typeof vocabularyIndex>, now = Date.now()) {
  const { cards, decks } = index;
  const counts = new Map<string, { all: number; fresh: number; learning: number; due: number }>();
  for (const [deckId, ids] of decks) {
    let learning = 0, due = 0;
    for (const id of ids) {
      const c = cards.get(id);
      if (c) { learning++; if (isDue(c, now)) due++; }
    }
    counts.set(deckId, { all: ids.size, fresh: ids.size - learning, learning, due });
  }
  return counts;
}
export function searchVocabulary(index: ReturnType<typeof vocabularyIndex>, deckId: string, query: string): Entry[] {
  const scope = deckId ? index.decks.get(deckId) : index.linked;
  if (!scope) return [];
  const needle = query.trim().toLowerCase();
  // Preserve the original entry order; pagination must not reshuffle words.
  return [...index.entries.values()].filter(e => scope.has(e.id) && (!needle || index.search.get(e.id)!.includes(needle)));
}
