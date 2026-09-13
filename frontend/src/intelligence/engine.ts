// LocalIntelligenceEngine — single facade that all screens talk to. Every call
// is wrapped so that an intelligence failure NEVER breaks the notes app: on
// error it returns a safe empty/neutral result. 100% offline, model-free.
import { getIndex, rebuildIndex, indexHealth, clearCache } from "./index-engine";
import { search, askMyNotes, SearchMode, SearchHit, AskAnswer } from "./search";
import { detectLanguage, extractKeywords, extractEntities, detectTopics } from "./nlp";
import {
  summarize, rewrite, RewriteStyle, suggestTags, suggestCategories, suggestTitles,
  buildStudyPack, convert, ConversionKind,
} from "./text-ops";
import {
  findRelated, findDuplicates, detectAllTasks, detectTasksIn, buildGraph, neighborsOf, buildCollections,
} from "./relations";
import type { DocKind } from "./corpus";

async function guard<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (e) { console.warn("[intelligence] failed:", e); return fallback; }
}
function guardSync<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch (e) { console.warn("[intelligence] failed:", e); return fallback; }
}

export const Intelligence = {
  // index / health
  ensureIndex: () => guard(() => getIndex(), null),
  rebuild: () => guard(() => rebuildIndex(), null),
  health: () => guard(() => indexHealth(), { ok: false, count: 0, builtAt: "", terms: 0 }),
  clearCache: () => guard(() => clearCache(), undefined),

  // search & ask
  search: (q: string, opts?: { mode?: SearchMode; kinds?: DocKind[]; limit?: number }) =>
    guard<SearchHit[]>(() => search(q, opts), []),
  ask: (q: string) =>
    guard<AskAnswer>(() => askMyNotes(q), { answer: "No reliable result found.", confidence: 0, provenance: "Local index", sources: [] }),

  // per-text analysis (sync, pure)
  language: (t: string) => guardSync(() => detectLanguage(t), { code: "und", name: "Unknown", script: "none", confidence: 0 }),
  keywords: (t: string, n?: number) => guardSync(() => extractKeywords(t, n), []),
  entities: (t: string) => guardSync(() => extractEntities(t), []),
  topics: (t: string, n?: number) => guardSync(() => detectTopics(t, n), []),
  summarize: (t: string, n?: number) => guardSync(() => summarize(t, n), { summary: "", confidence: 0 }),
  rewrite: (t: string, style: RewriteStyle) => guardSync(() => rewrite(t, style), { text: t, changed: false, note: "No safe rewrite was found." }),
  tags: (t: string, title?: string, existing?: string[]) => guardSync(() => suggestTags(t, title, existing), []),
  categories: (t: string, title?: string) => guardSync(() => suggestCategories(t, title), []),
  titles: (t: string) => guardSync(() => suggestTitles(t), []),
  study: (t: string, title?: string) => guardSync(() => buildStudyPack(t, title), { keyPoints: [], terms: [], questions: [], flashcards: [], difficulty: "Easy" as const }),
  convert: (t: string, title: string, kind: ConversionKind) => guardSync(() => convert(t, title, kind), { kind, lines: [], data: {} }),
  detectTasksIn: (t: string, src?: string) => guardSync(() => detectTasksIn(t, src), []),

  // corpus-wide
  related: (docId: string, limit?: number) => guard(() => findRelated(docId, limit), []),
  duplicates: (th?: number) => guard(() => findDuplicates(th), []),
  allTasks: () => guard(() => detectAllTasks(), []),
  graph: () => guard(() => buildGraph(), { nodes: [], edges: [], clusters: [] }),
  neighbors: (id: string) => guard(() => neighborsOf(id), []),
  collections: () => guard(() => buildCollections(), []),
};

export type { SearchHit, AskAnswer } from "./search";
export type { RewriteStyle, ConversionKind } from "./text-ops";
export type { IDoc, DocKind } from "./corpus";
