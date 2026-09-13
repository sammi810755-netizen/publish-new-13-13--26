// SearchEngine + QueryEngine + AskEngine + ExplanationEngine.
// Deterministic, offline ranked search across the local index, plus a
// natural-language "Ask My Notes" that answers only from local evidence.
import { getIndex, idf, IndexData } from "./index-engine";
import type { IDoc, DocKind } from "./corpus";
import { contentTokens, levenshtein, normalize, toLowerTokens, splitSentences, extractKeywords } from "./nlp";

export type SearchMode = "smart" | "exact" | "fuzzy" | "prefix" | "phrase" | "tag";

export interface SearchHit {
  doc: IDoc;
  score: number;
  reasons: string[];
  snippet: string;
}

export interface SearchOptions {
  mode?: SearchMode;
  kinds?: DocKind[];
  limit?: number;
}

function recencyBoost(updatedAt: string): number {
  const t = Date.parse(updatedAt || "");
  if (isNaN(t)) return 0;
  const days = (Date.now() - t) / 86400000;
  if (days < 1) return 0.5;
  if (days < 7) return 0.3;
  if (days < 30) return 0.15;
  if (days < 90) return 0.05;
  return 0;
}

function makeSnippet(text: string, terms: string[], max = 160): string {
  const s = normalize(text);
  if (!s) return "";
  const lower = s.toLowerCase();
  let idx = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (idx === -1 || i < idx)) idx = i;
  }
  if (idx === -1) return s.slice(0, max) + (s.length > max ? "\u2026" : "");
  const start = Math.max(0, idx - 40);
  const end = Math.min(s.length, start + max);
  return (start > 0 ? "\u2026" : "") + s.slice(start, end) + (end < s.length ? "\u2026" : "");
}

export async function search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
  const index = await getIndex();
  return searchIn(index, query, opts);
}

export function searchIn(index: IndexData, query: string, opts: SearchOptions = {}): SearchHit[] {
  const mode = opts.mode || "smart";
  const limit = opts.limit ?? 50;
  const q = normalize(query);
  if (!q) return [];
  const qTerms = contentTokens(q);
  const rawTerms = toLowerTokens(q);
  const phrase = q.toLowerCase();
  const isTagQuery = mode === "tag" || q.startsWith("#");
  const tagQ = q.replace(/^#/, "").toLowerCase().trim();

  const hits: SearchHit[] = [];
  for (const id of Object.keys(index.docs)) {
    const doc = index.docs[id];
    if (opts.kinds && !opts.kinds.includes(doc.kind)) continue;
    const vec = index.vectors[id];
    if (!vec) continue;
    const titleLower = (doc.title || "").toLowerCase();
    const textLower = (doc.text || "").toLowerCase();
    const reasons: string[] = [];
    let score = 0;

    // tag search
    if (isTagQuery) {
      const matched = doc.tags.some((t) => t.toLowerCase().includes(tagQ));
      if (!matched) continue;
      score += 5;
      reasons.push("tag match");
    }

    // phrase
    if (mode === "phrase" || mode === "smart") {
      if (titleLower.includes(phrase)) { score += 8; reasons.push("title phrase"); }
      else if (textLower.includes(phrase)) { score += 4; reasons.push("phrase match"); }
      if (mode === "phrase" && score === 0) continue;
    }

    // exact term / tf-idf overlap
    if (mode === "exact" || mode === "smart" || mode === "fuzzy" || mode === "prefix") {
      let overlap = 0;
      for (const term of qTerms) {
        let tf = vec.tf[term] || 0;
        let matchedTerm = tf > 0;
        // prefix
        if (!matchedTerm && (mode === "prefix" || mode === "smart")) {
          for (const vt of Object.keys(vec.tf)) {
            if (vt.startsWith(term) && vt !== term) { tf = vec.tf[vt]; matchedTerm = true; reasons.push("prefix"); break; }
          }
        }
        // fuzzy
        if (!matchedTerm && (mode === "fuzzy" || mode === "smart") && term.length >= 4) {
          for (const vt of Object.keys(vec.tf)) {
            if (Math.abs(vt.length - term.length) <= 2 && levenshtein(vt, term, 2) <= (term.length > 6 ? 2 : 1)) {
              tf = vec.tf[vt]; matchedTerm = true; reasons.push("fuzzy"); break;
            }
          }
        }
        if (matchedTerm) {
          overlap += 1;
          const w = idf(index, term) * (1 + Math.log(1 + tf)) / (1 + Math.log(1 + vec.len));
          score += w * 3;
          if (titleLower.includes(term)) score += 2;
        }
      }
      if (overlap > 0 && qTerms.length > 0) {
        const coverage = overlap / qTerms.length;
        score += coverage * 3;
        if (coverage === 1) reasons.push("all terms");
      }
      if ((mode === "exact") && overlap < qTerms.length) {
        if (!titleLower.includes(phrase) && !textLower.includes(phrase)) continue;
      }
    }

    if (score <= 0) continue;
    score += recencyBoost(doc.updatedAt);
    if (doc.extra?.isFavorite) score += 0.4;
    hits.push({ doc, score, reasons: Array.from(new Set(reasons)), snippet: makeSnippet(doc.text || doc.title, rawTerms) });
  }

  hits.sort((a, b) => b.score - a.score || Date.parse(b.doc.updatedAt) - Date.parse(a.doc.updatedAt));
  return hits.slice(0, limit);
}

// ---------- QueryEngine (intent parsing) ----------
export type AskIntent =
  | "unfinished_tasks"
  | "due_this_week"
  | "summarize"
  | "related"
  | "about"
  | "count"
  | "general";

export interface ParsedQuery {
  intent: AskIntent;
  subject: string;
}

export function parseQuery(query: string): ParsedQuery {
  const q = normalize(query).toLowerCase();
  const strip = (re: RegExp) => normalize(query.replace(re, "")).replace(/[?.!]+$/, "").trim();
  if (/(unfinished|incomplete|pending|not done|todo|to-do|open)\s+(task|assignment|work|item)/.test(q) ||
      /(show|list|my)\s+(unfinished|pending|open)/.test(q))
    return { intent: "unfinished_tasks", subject: "" };
  if (/(due|deadline).*(this week|week|soon|today|tomorrow)/.test(q) || /what.*(due)/.test(q))
    return { intent: "due_this_week", subject: "" };
  if (/^summar(ize|ise|y)/.test(q) || /\bsummar(ize|ise|y)\b/.test(q))
    return { intent: "summarize", subject: strip(/summar(ize|ise|y)( my| the| of)?/i) };
  if (/(related to|similar to|notes about|find notes)/.test(q))
    return { intent: "related", subject: strip(/(find notes related to|notes related to|related to|similar to|find notes about|notes about|find)/i) };
  if (/^how many|how many|count/.test(q))
    return { intent: "count", subject: strip(/(how many|count( of)?|do i have)/i) };
  if (/what (did|have) i (write|written|wrote|note)/.test(q) || /^what.*about/.test(q) || /what are my notes/.test(q))
    return { intent: "about", subject: strip(/(what did i write about|what have i written about|what are my notes about|what did i note about|what about|about)/i) };
  return { intent: "general", subject: normalize(query) };
}

export interface AskAnswer {
  answer: string;
  confidence: number;
  provenance: string; // where the answer came from
  sources: { title: string; path: string; snippet: string; route: IDoc["route"] }[];
}

const NO_RESULT = "No reliable result found.";

export async function askMyNotes(query: string): Promise<AskAnswer> {
  const index = await getIndex();
  const parsed = parseQuery(query);
  const toSource = (h: SearchHit) => ({ title: h.doc.title || "Untitled", path: h.doc.path, snippet: h.snippet, route: h.doc.route });

  if (parsed.intent === "unfinished_tasks") {
    const tasks = Object.values(index.docs).filter((d) => d.kind === "task" && d.extra?.status !== "done");
    const checklists = Object.values(index.docs).filter(
      (d) => d.kind === "note" && d.extra?.type === "checklist" && (d.extra?.checklistDone ?? 0) < (d.extra?.checklistTotal ?? 0),
    );
    const all = [...tasks, ...checklists];
    if (!all.length) return { answer: "You have no unfinished tasks.", confidence: 1, provenance: "Deterministic rule + local tasks", sources: [] };
    return {
      answer: `You have ${all.length} unfinished item${all.length > 1 ? "s" : ""}.`,
      confidence: 0.95,
      provenance: "Local tasks & checklists",
      sources: all.slice(0, 20).map((d) => ({ title: d.title || "Untitled", path: d.path, snippet: d.extra?.dueDate ? `Due ${d.extra.dueDate}` : (d.extra?.priority ? `Priority: ${d.extra.priority}` : ""), route: d.route })),
    };
  }

  if (parsed.intent === "due_this_week") {
    const now = new Date();
    const weekEnd = new Date(now.getTime() + 7 * 86400000);
    const due = Object.values(index.docs).filter((d) => {
      const dd = d.extra?.dueDate ? Date.parse(d.extra.dueDate) : NaN;
      return !isNaN(dd) && dd >= now.getTime() - 86400000 && dd <= weekEnd.getTime() && d.extra?.status !== "done";
    });
    if (!due.length) return { answer: "Nothing is due in the next 7 days.", confidence: 0.9, provenance: "Local tasks (date rule)", sources: [] };
    return {
      answer: `${due.length} item${due.length > 1 ? "s are" : " is"} due this week.`,
      confidence: 0.9,
      provenance: "Local tasks (date rule)",
      sources: due.map((d) => ({ title: d.title, path: d.path, snippet: `Due ${d.extra?.dueDate}`, route: d.route })),
    };
  }

  if (parsed.intent === "summarize") {
    const subj = parsed.subject || query;
    const hits = searchIn(index, subj, { limit: 8 });
    if (!hits.length) return { answer: `${NO_RESULT} I couldn't find notes about "${subj}".`, confidence: 0, provenance: "Local index", sources: [] };
    const combined = hits.map((h) => `${h.doc.title}. ${h.doc.text}`).join(" ");
    const sents = rankSentences(combined, subj, 4);
    return {
      answer: sents.length ? sents.join(" ") : NO_RESULT,
      confidence: sents.length ? 0.7 : 0,
      provenance: `Extractive summary of ${hits.length} local note(s)`,
      sources: hits.map(toSource),
    };
  }

  if (parsed.intent === "count") {
    const subj = parsed.subject || query;
    const hits = searchIn(index, subj, { limit: 100 });
    return {
      answer: hits.length ? `"${subj}" appears in ${hits.length} item${hits.length > 1 ? "s" : ""}.` : NO_RESULT,
      confidence: hits.length ? 0.85 : 0,
      provenance: "Local index",
      sources: hits.slice(0, 15).map(toSource),
    };
  }

  // about / related / general -> ranked search with evidence
  const subj = parsed.subject || query;
  const hits = searchIn(index, subj, { limit: 15 });
  if (!hits.length) return { answer: NO_RESULT, confidence: 0, provenance: "Local index", sources: [] };
  const places = hits.length;
  const kw = extractKeywords(hits.map((h) => h.doc.text).join(" "), 6).map((k) => k.term).filter((t) => !subj.toLowerCase().includes(t));
  const topicLine = kw.length ? ` Related topics: ${kw.slice(0, 5).join(", ")}.` : "";
  return {
    answer: `Your notes mention "${subj}" in ${places} place${places > 1 ? "s" : ""}.${topicLine}`,
    confidence: Math.min(0.9, 0.5 + places * 0.05),
    provenance: "User notes (local index)",
    sources: hits.map(toSource),
  };
}

// ---------- Sentence ranking (shared by summary & ask) ----------
export function rankSentences(text: string, focus: string, k: number): string[] {
  const sents = splitSentences(text);
  if (sents.length <= k) return sents;
  const focusTerms = new Set(contentTokens(focus));
  const globalKw = new Map(extractKeywords(text, 25).map((x) => [x.term, x.score] as const));
  const scored = sents.map((s, i) => {
    const toks = contentTokens(s);
    let score = 0;
    for (const t of toks) {
      score += globalKw.get(t) || 0;
      if (focusTerms.has(t)) score += 0.6;
    }
    score = toks.length ? score / Math.sqrt(toks.length) : 0;
    if (i === 0) score += 0.4; // lead bias
    if (toks.length < 3) score *= 0.3;
    return { s, score, i };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
}
