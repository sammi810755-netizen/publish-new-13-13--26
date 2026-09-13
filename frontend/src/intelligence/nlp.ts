// LocalIntelligenceEngine :: NLP core — 100% offline, deterministic, model-free.
// Provides LanguageEngine, tokenization, sentence detection, KeywordEngine,
// EntityEngine and TopicEngine. No network, no bundled models.

export const STOPWORDS = new Set<string>([
  "a","an","the","and","or","but","if","then","else","when","at","by","for","with","about","against",
  "between","into","through","during","before","after","above","below","to","from","up","down","in","out",
  "on","off","over","under","again","further","once","here","there","all","any","both","each","few","more",
  "most","other","some","such","no","nor","not","only","own","same","so","than","too","very","can","will",
  "just","don","should","now","i","me","my","myself","we","our","ours","you","your","yours","he","him",
  "his","she","her","it","its","they","them","their","what","which","who","whom","this","that","these",
  "those","am","is","are","was","were","be","been","being","have","has","had","having","do","does","did",
  "doing","of","as","until","while","because","how","why","where","get","got","also","like","really","much",
]);

// filler words removed by the RewriteEngine "shorten" transform
export const FILLER = new Set<string>([
  "very","really","just","actually","basically","literally","simply","quite","rather","somewhat",
  "kind","sort","of","totally","definitely","probably","maybe","perhaps","honestly","seriously",
]);

const CONTRACTIONS: Record<string, string> = {
  "can't": "cannot", "won't": "will not", "n't": " not", "'re": " are", "'ve": " have",
  "'ll": " will", "'m": " am", "i'm": "I am", "it's": "it is", "that's": "that is",
  "don't": "do not", "doesn't": "does not", "didn't": "did not", "isn't": "is not",
  "aren't": "are not", "wasn't": "was not", "weren't": "were not", "i'll": "I will",
  "we'll": "we will", "you'll": "you will", "they'll": "they will",
};

// small deterministic spelling dictionary (common typos) — never fabricates words
export const SPELL_FIXES: Record<string, string> = {
  teh: "the", adn: "and", recieve: "receive", seperate: "separate", definately: "definitely",
  occured: "occurred", untill: "until", wich: "which", becuase: "because", alot: "a lot",
  thier: "their", freind: "friend", beleive: "believe", accross: "across", acheive: "achieve",
  arguement: "argument", enviroment: "environment", goverment: "government", occassion: "occasion",
  neccessary: "necessary", tommorow: "tomorrow", tommorrow: "tomorrow", wnat: "want", wont: "won't",
  cant: "can't", dont: "don't", im: "I'm", ur: "your", u: "you", pls: "please", plz: "please",
};

export function normalize(text: string | null | undefined): string {
  if (!text) return "";
  return String(text).replace(/\s+/g, " ").trim();
}

export function toLowerTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  const m = String(text)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .match(/[\p{L}\p{N}][\p{L}\p{N}'\-]*/gu);
  return m ? m.filter((t) => t.length > 0) : [];
}

export function contentTokens(text: string | null | undefined): string[] {
  return toLowerTokens(text).filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

// ---------- LanguageEngine ----------
export interface LanguageResult {
  code: string; // ISO-ish: en, hi, und
  name: string;
  script: string;
  confidence: number;
}

export function detectLanguage(text: string | null | undefined): LanguageResult {
  const s = normalize(text);
  if (!s) return { code: "und", name: "Unknown", script: "none", confidence: 0 };
  const counts = { latin: 0, devanagari: 0, cjk: 0, arabic: 0, cyrillic: 0 };
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x0900 && cp <= 0x097f) counts.devanagari++;
    else if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3040 && cp <= 0x30ff)) counts.cjk++;
    else if (cp >= 0x0600 && cp <= 0x06ff) counts.arabic++;
    else if (cp >= 0x0400 && cp <= 0x04ff) counts.cyrillic++;
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) counts.latin++;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const top = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]) as [string, number];
  const conf = Math.min(1, top[1] / total);
  if (top[0] === "devanagari") return { code: "hi", name: "Hindi", script: "Devanagari", confidence: conf };
  if (top[0] === "cjk") return { code: "zh", name: "CJK", script: "Han", confidence: conf };
  if (top[0] === "arabic") return { code: "ar", name: "Arabic", script: "Arabic", confidence: conf };
  if (top[0] === "cyrillic") return { code: "ru", name: "Cyrillic", script: "Cyrillic", confidence: conf };
  // Latin -> refine English via stopword ratio
  const toks = toLowerTokens(s);
  const sw = toks.filter((t) => STOPWORDS.has(t)).length;
  const ratio = toks.length ? sw / toks.length : 0;
  if (ratio > 0.12) return { code: "en", name: "English", script: "Latin", confidence: Math.min(1, 0.5 + ratio) };
  return { code: "en", name: "English (approx)", script: "Latin", confidence: 0.4 };
}

// ---------- Sentence detection ----------
export function splitSentences(text: string | null | undefined): string[] {
  const s = normalize(text);
  if (!s) return [];
  const parts = s
    .replace(/([.!?\u0964])\s+/g, "$1\u0001")
    .split(/\u0001|\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  return parts;
}

export function splitLines(text: string | null | undefined): string[] {
  if (!text) return [];
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
}

// ---------- Levenshtein (bounded) for fuzzy match ----------
export function levenshtein(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  const prev = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    let cur = i;
    let best = cur;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const val = Math.min(prev[j] + 1, cur + 1, prev[j - 1] + cost);
      prev[j - 1] = cur;
      cur = val;
      if (val < best) best = val;
    }
    prev[bl] = cur;
    if (best > max) return max + 1;
  }
  return prev[bl];
}

// ---------- KeywordEngine ----------
export interface Keyword { term: string; score: number; count: number }

export function extractKeywords(text: string | null | undefined, limit = 12): Keyword[] {
  const toks = contentTokens(text);
  if (!toks.length) return [];
  const freq = new Map<string, number>();
  for (const t of toks) freq.set(t, (freq.get(t) || 0) + 1);
  // bigram boost for multiword topics
  const bigrams = new Map<string, number>();
  for (let i = 0; i < toks.length - 1; i++) {
    const bg = `${toks[i]} ${toks[i + 1]}`;
    bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
  }
  const maxF = Math.max(...freq.values());
  const out: Keyword[] = [];
  freq.forEach((count, term) => {
    const lengthBoost = Math.min(1, term.length / 8);
    out.push({ term, count, score: (count / maxF) * (0.7 + 0.3 * lengthBoost) });
  });
  bigrams.forEach((count, term) => {
    if (count >= 2) out.push({ term, count, score: (count / maxF) * 1.2 });
  });
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------- EntityEngine ----------
export interface Entity { text: string; type: "person_or_place" | "date" | "email" | "url" | "number" | "hashtag" }

export function extractEntities(text: string | null | undefined): Entity[] {
  const s = normalize(text);
  if (!s) return [];
  const out: Entity[] = [];
  const seen = new Set<string>();
  const push = (t: string, type: Entity["type"]) => {
    const k = `${type}:${t.toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ text: t, type });
  };
  (s.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).forEach((e) => push(e, "email"));
  (s.match(/https?:\/\/[^\s]+/g) || []).forEach((e) => push(e, "url"));
  (s.match(/#[\p{L}\p{N}_]+/gu) || []).forEach((e) => push(e, "hashtag"));
  (s.match(/\b\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?\b/g) || []).forEach((e) => push(e, "date"));
  // Capitalized multi-word sequences (proper nouns), excluding sentence starts heuristically
  const capSeq = s.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g) || [];
  for (const seq of capSeq) {
    const first = seq.split(/\s+/)[0].toLowerCase();
    if (STOPWORDS.has(first) && seq.split(/\s+/).length === 1) continue;
    push(seq, "person_or_place");
  }
  return out.slice(0, 30);
}

// ---------- TopicEngine ----------
export function detectTopics(text: string | null | undefined, limit = 5): string[] {
  return extractKeywords(text, limit * 2)
    .filter((k) => k.count >= 1)
    .slice(0, limit)
    .map((k) => k.term);
}

export function expandContractions(text: string): string {
  let out = text;
  for (const [k, v] of Object.entries(CONTRACTIONS)) {
    out = out.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), v);
  }
  return out;
}
