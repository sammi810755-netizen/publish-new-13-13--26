// SummaryEngine, GrammarEngine/RewriteEngine, TagEngine, CategoryEngine,
// TitleEngine, StudyEngine and NoteConversions. All deterministic & offline.
import {
  contentTokens, extractKeywords, splitSentences, splitLines, normalize,
  expandContractions, FILLER, SPELL_FIXES, toLowerTokens,
} from "./nlp";
import { rankSentences } from "./search";

// ---------- SummaryEngine ----------
export function summarize(text: string, sentences = 3): { summary: string; confidence: number } {
  const clean = normalize(text);
  const all = splitSentences(clean);
  if (all.length === 0) return { summary: "", confidence: 0 };
  if (all.length <= sentences) return { summary: all.join(" "), confidence: 0.5 };
  const picked = rankSentences(clean, "", sentences);
  return { summary: picked.join(" "), confidence: Math.min(0.85, 0.4 + picked.length * 0.12) };
}

// ---------- GrammarEngine + RewriteEngine ----------
export type RewriteStyle = "fix" | "shorten" | "expand" | "formal" | "simple" | "bullets" | "headings";
export interface RewriteResult { text: string; changed: boolean; note: string }
const NO_SAFE = "No safe rewrite was found.";

function fixGrammar(text: string): string {
  let s = text;
  // spelling fixes (word-boundary, case-insensitive, preserve simple)
  s = s.replace(/[\p{L}']+/gu, (w) => {
    const low = w.toLowerCase();
    if (SPELL_FIXES[low]) {
      const fixed = SPELL_FIXES[low];
      return w[0] === w[0].toUpperCase() && w.length > 1 ? fixed.charAt(0).toUpperCase() + fixed.slice(1) : fixed;
    }
    return w;
  });
  // standalone "i" -> "I"
  s = s.replace(/\bi\b/g, "I");
  // collapse spaces, fix space before punctuation
  s = s.replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1").replace(/([,.!?;:])(?=[^\s\d])/g, "$1 ");
  // capitalize sentence starts
  s = s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, p1, p2) => p1 + p2.toUpperCase());
  // ensure terminal punctuation
  s = s.trim();
  if (s && !/[.!?\u2026]$/.test(s)) s += ".";
  return s;
}

export function rewrite(text: string, style: RewriteStyle): RewriteResult {
  const src = normalize(text);
  if (!src) return { text: "", changed: false, note: NO_SAFE };
  let out = src;
  switch (style) {
    case "fix":
      out = fixGrammar(src);
      break;
    case "shorten": {
      const words = src.split(/\s+/).filter((w) => !FILLER.has(w.toLowerCase()));
      out = fixGrammar(words.join(" "));
      break;
    }
    case "expand":
      out = fixGrammar(expandContractions(src));
      break;
    case "formal":
      out = fixGrammar(expandContractions(src)
        .replace(/\b(gonna)\b/gi, "going to").replace(/\b(wanna)\b/gi, "want to")
        .replace(/\b(kids?)\b/gi, "children").replace(/\b(a lot)\b/gi, "considerably")
        .replace(/\b(get)\b/gi, "obtain").replace(/\b(ok|okay)\b/gi, "acceptable"));
      break;
    case "simple":
      out = fixGrammar(expandContractions(src)
        .replace(/\b(utilize)\b/gi, "use").replace(/\b(approximately)\b/gi, "about")
        .replace(/\b(commence)\b/gi, "start").replace(/\b(terminate)\b/gi, "end")
        .replace(/\b(purchase)\b/gi, "buy").replace(/\b(assist)\b/gi, "help"));
      break;
    case "bullets": {
      const parts = splitSentences(src);
      if (parts.length < 1) return { text: "", changed: false, note: NO_SAFE };
      out = parts.map((p) => `\u2022 ${p.replace(/[.]$/, "")}`).join("\n");
      break;
    }
    case "headings": {
      const lines = splitLines(src.length ? src : text);
      const first = lines[0] || splitSentences(src)[0] || "";
      const rest = lines.slice(1).join("\n") || splitSentences(src).slice(1).join(" ");
      const heading = first.replace(/[.]$/, "").replace(/\b\w/g, (c) => c.toUpperCase());
      out = `# ${heading}${rest ? "\n\n" + rest : ""}`;
      break;
    }
  }
  out = out.trim();
  const changed = out.length > 0 && out !== src;
  if (!changed) return { text: src, changed: false, note: NO_SAFE };
  return { text: out, changed: true, note: `Rewritten (${style}).` };
}

// ---------- CategoryEngine ----------
export const CATEGORY_LEXICON: Record<string, string[]> = {
  Study: ["study","exam","revision","lecture","assignment","homework","chapter","syllabus","notes","class","course","semester","quiz","formula","theorem","definition"],
  Work: ["meeting","project","deadline","client","report","email","presentation","manager","team","task","standup","invoice","proposal","office"],
  Personal: ["birthday","family","friend","home","personal","diary","journal","gift","anniversary","weekend"],
  Finance: ["budget","expense","salary","invoice","payment","tax","bank","savings","loan","investment","money","cost","price","bill"],
  Health: ["workout","gym","diet","doctor","medicine","health","sleep","water","calories","exercise","yoga","meditation","steps"],
  Project: ["milestone","sprint","feature","bug","release","roadmap","backlog","deploy","scope","deliverable"],
  Research: ["research","paper","study","experiment","hypothesis","data","analysis","reference","citation","survey","method"],
  Travel: ["flight","hotel","trip","travel","itinerary","passport","visa","booking","packing","destination","vacation"],
  Ideas: ["idea","brainstorm","concept","maybe","could","what if","inspiration","thought","vision"],
};

export function suggestCategories(text: string, title = ""): { category: string; score: number }[] {
  const toks = new Set(contentTokens(`${title} ${title} ${text}`));
  const results: { category: string; score: number }[] = [];
  for (const [cat, words] of Object.entries(CATEGORY_LEXICON)) {
    let hits = 0;
    for (const w of words) if (toks.has(w)) hits++;
    if (hits > 0) results.push({ category: cat, score: Math.min(1, hits / 4) });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 3);
}

// ---------- TagEngine ----------
export function suggestTags(text: string, title = "", existingTags: string[] = []): { tag: string; score: number; source: string }[] {
  const kws = extractKeywords(`${title} ${title} ${text}`, 10);
  const existingLower = new Set(existingTags.map((t) => t.toLowerCase()));
  const out: { tag: string; score: number; source: string }[] = [];
  const seen = new Set<string>();
  // reuse existing tags whose term appears
  const toks = new Set(contentTokens(`${title} ${text}`));
  for (const et of existingTags) {
    if (toks.has(et.toLowerCase()) && !seen.has(et.toLowerCase())) {
      out.push({ tag: et, score: 0.9, source: "existing tag" });
      seen.add(et.toLowerCase());
    }
  }
  for (const k of kws) {
    if (k.term.includes(" ")) continue;
    if (seen.has(k.term) || existingLower.has(k.term)) continue;
    seen.add(k.term);
    out.push({ tag: k.term, score: k.score, source: "keyword" });
  }
  for (const cat of suggestCategories(text, title)) {
    const t = cat.category.toLowerCase();
    if (!seen.has(t)) { out.push({ tag: t, score: cat.score * 0.8, source: "category" }); seen.add(t); }
  }
  return out.slice(0, 8);
}

// ---------- TitleEngine ----------
export function suggestTitles(text: string): string[] {
  const clean = normalize(text);
  if (!clean) return [];
  const out: string[] = [];
  const firstSent = splitSentences(clean)[0] || "";
  if (firstSent) {
    const words = firstSent.split(/\s+/).slice(0, 8).join(" ").replace(/[.,;:]$/, "");
    if (words) out.push(words.replace(/\b\w/, (c) => c.toUpperCase()));
  }
  const kws = extractKeywords(clean, 6).map((k) => k.term);
  if (kws.length >= 2) out.push(kws.slice(0, 3).map((w) => w.replace(/\b\w/, (c) => c.toUpperCase())).join(" "));
  if (kws.length) out.push(kws[0].replace(/\b\w/, (c) => c.toUpperCase()) + " \u2014 Notes");
  return Array.from(new Set(out.filter(Boolean))).slice(0, 3);
}

// ---------- StudyEngine ----------
export interface Flashcard { front: string; back: string }
export interface StudyPack {
  keyPoints: string[];
  terms: { term: string; definition: string }[];
  questions: string[];
  flashcards: Flashcard[];
  difficulty: "Easy" | "Medium" | "Hard";
}

export function buildStudyPack(text: string, title = ""): StudyPack {
  const clean = normalize(text);
  const sents = splitSentences(clean);
  const keyPoints = rankSentences(clean, title, Math.min(6, Math.max(3, Math.round(sents.length / 3))));
  // terms + definitions: sentence patterns "X is/are/means Y"
  const terms: { term: string; definition: string }[] = [];
  const flashcards: Flashcard[] = [];
  const defRe = /^(.{2,60}?)\s+(?:is|are|means|refers to|is defined as|was|were)\s+(.{5,})$/i;
  for (const s of sents) {
    const m = s.match(defRe);
    if (m) {
      const term = m[1].replace(/^(the|a|an)\s+/i, "").trim();
      const def = m[2].replace(/[.]$/, "").trim();
      if (term.split(/\s+/).length <= 6) {
        terms.push({ term, definition: def });
        flashcards.push({ front: `What ${/\bare\b/i.test(s) ? "are" : "is"} ${term}?`, back: def });
      }
    }
  }
  // fallback flashcards from keywords
  if (flashcards.length < 3) {
    for (const k of extractKeywords(clean, 6)) {
      const host = sents.find((s) => s.toLowerCase().includes(k.term));
      if (host) flashcards.push({ front: `Explain: ${k.term}`, back: host });
    }
  }
  // questions
  const questions: string[] = [];
  for (const t of terms.slice(0, 5)) questions.push(`What is ${t.term}?`);
  for (const kp of keyPoints.slice(0, 3)) {
    const kws = extractKeywords(kp, 1)[0];
    if (kws) questions.push(`Explain the significance of "${kws.term}".`);
  }
  const words = toLowerTokens(clean).length;
  const difficulty: StudyPack["difficulty"] = words > 400 ? "Hard" : words > 150 ? "Medium" : "Easy";
  return {
    keyPoints,
    terms: terms.slice(0, 12),
    questions: Array.from(new Set(questions)).slice(0, 10),
    flashcards: flashcards.slice(0, 12),
    difficulty,
  };
}

// ---------- NoteConversions ----------
export type ConversionKind = "checklist" | "tasks" | "outline" | "summary" | "flashcards" | "questions" | "table";

export interface ConversionPreview {
  kind: ConversionKind;
  lines: string[]; // preview lines
  data: any; // structured payload for creation
}

export function convert(text: string, title: string, kind: ConversionKind): ConversionPreview {
  const clean = normalize(text);
  const lines = splitLines(text).length > 1 ? splitLines(text) : splitSentences(clean);
  switch (kind) {
    case "checklist":
      return { kind, lines: lines.map((l) => `\u2610 ${l.replace(/^[-*\u2022]\s*/, "")}`), data: { items: lines.map((l) => l.replace(/^[-*\u2022]\s*/, "")) } };
    case "tasks": {
      const items = lines.map((l) => l.replace(/^[-*\u2022]\s*/, ""));
      return { kind, lines: items.map((l) => `\u25A1 ${l}`), data: { tasks: items } };
    }
    case "outline": {
      const kws = extractKeywords(clean, 4).map((k) => k.term);
      const out = [`# ${title || "Outline"}`, ...lines.map((l) => `  \u2022 ${l}`)];
      if (kws.length) out.push(`\nKey topics: ${kws.join(", ")}`);
      return { kind, lines: out, data: { outline: out } };
    }
    case "summary": {
      const s = summarize(clean, 3);
      return { kind, lines: [s.summary || "(nothing to summarize)"], data: { summary: s.summary } };
    }
    case "flashcards": {
      const pack = buildStudyPack(clean, title);
      return { kind, lines: pack.flashcards.map((f) => `Q: ${f.front}\nA: ${f.back}`), data: { flashcards: pack.flashcards } };
    }
    case "questions": {
      const pack = buildStudyPack(clean, title);
      return { kind, lines: pack.questions.length ? pack.questions : ["No questions could be generated."], data: { questions: pack.questions } };
    }
    case "table": {
      const rows = lines.map((l) => l.split(/\s[-:\u2013]\s|\t|,\s?/).map((c) => c.trim()));
      return { kind, lines: rows.map((r) => r.join(" | ")), data: { rows } };
    }
  }
}
