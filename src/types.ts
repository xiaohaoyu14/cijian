export interface Example {
  id: string;
  en: string;
  zh: string;
}
export interface Sense {
  id: string;
  pos: string;
  zh: string;
  acceptedZh: string[];
  variants: string[];
  examples: Example[];
  image?: string;
}
export interface Entry {
  id: string;
  word: string;
  phonetic: string;
  senses: Sense[];
  phrase: string;
  tags: string[];
  audio?: string;
  audioUS?: string;
  audioUK?: string;
  caseSensitive?: boolean;
}
export interface Deck {
  id: string;
  name: string;
  author: string;
  version: string;
  language: string;
  source: string;
  license: string;
  tags: string[];
  demo?: boolean;
}
export interface DeckEntry {
  deckId: string;
  entryId: string;
}
export interface Media {
  bytes?: number;
  id: string;
  path: string;
  type: string;
  data: string;
}
export interface Card {
  id: string;
  entryId: string;
  direction: "en-zh";
  fsrs: Record<string, any>;
}
export interface ReviewLog {
  id: string;
  cardId: string;
  entryId: string;
  at: string;
  rating: number;
  before: Card;
  after: Card;
  scheduler: string;
  config: { retention: number; resolved?: Record<string, unknown> };
  raw: Record<string, any>;
  undone?: boolean;
}
export interface UserNote {
  entryId: string;
  favorite: boolean;
  text: string;
  reinforce: boolean;
}
export type QuestionType = "en-zh" | "zh-en" | "en-choice" | "zh-choice";
export const TYPE_LABEL: Record<QuestionType, string> = {
  "en-zh": "看英文写中文",
  "zh-en": "看中文写英文",
  "en-choice": "英文选中文",
  "zh-choice": "中文选英文",
};
export interface ExamConfig {
  entryIds?: string[];
  decks: string[];
  scope: string;
  tag: string;
  count: number;
  type: QuestionType | "mixed";
  ratios: number[];
  minutes: number;
  practice: boolean;
}
export interface ExamItem {
  id: string;
  entryId: string;
  type: QuestionType;
  entry: Entry;
  sense: Sense;
  prompt: string;
  options: string[];
  correct: string;
  accepted: string[];
}
export interface ExamAnswer {
  itemId: string;
  value: string;
  status: "correct" | "wrong" | "unanswered" | "pending";
  method: "auto" | "manual";
  checked?: boolean;
}
export interface ExamSession {
  id: string;
  config: ExamConfig;
  items: ExamItem[];
  answers: Record<string, ExamAnswer>;
  state: "active" | "submitted";
  created: string;
  deadline?: string;
  submitted?: string;
  index: number;
}
export interface StudySession {
  id?: string;
  newReviewOf?: string;
  ids: string[];
  index: number;
  mode: "new" | "review" | "reinforce";
  lastLog?: string;
  deckId?: string;
  custom?: boolean;
  reviewLogIds?: string[];
}
export interface Data {
  schema: 1;
  decks: Deck[];
  entries: Entry[];
  links: DeckEntry[];
  media: Media[];
  cards: Card[];
  logs: ReviewLog[];
  notes: UserNote[];
  exams: ExamSession[];
  refs: Record<string, string>;
  settings: {
    daily: number;
    retention: number;
    pronunciation: "us" | "uk";
    audioEnabled?: boolean;
    studyDeckId?: string;
    reviewBatch?: 0 | 20 | 50;
  };
  builtinSources?: string[];
  study?: StudySession;
  pausedStudies?: Partial<Record<string, StudySession>>;
}
export const emptyData = (): Data => ({
  schema: 1,
  decks: [],
  entries: [],
  links: [],
  media: [],
  cards: [],
  logs: [],
  notes: [],
  exams: [],
  refs: {},
  settings: { daily: 20, retention: 0.9, pronunciation: "us" },
});
export const uid = () => crypto.randomUUID();
export const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase();
export const noteOf = (d: Data, id: string): UserNote =>
  d.notes.find((n) => n.entryId === id) || {
    entryId: id,
    favorite: false,
    text: "",
    reinforce: false,
  };
export const cardOf = (d: Data, id: string) =>
  d.cards.find((c) => c.entryId === id && c.direction === "en-zh");
export const isDue = (c: Card, now = Date.now()) =>
  new Date(c.fsrs.dueAt).getTime() <= now;
