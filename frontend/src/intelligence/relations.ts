// SimilarityEngine, DuplicateEngine, TaskEngine/DateEngine/PriorityEngine,
// KnowledgeGraphEngine and CollectionsEngine. Deterministic & offline.
import { getIndex, IndexData, DocVector } from "./index-engine";
import type { IDoc } from "./corpus";
import { contentTokens, normalize, extractKeywords } from "./nlp";
import { CATEGORY_LEXICON } from "./text-ops";
import { extractLinks } from "@/src/lib/links";

// ---------- SimilarityEngine ----------
function cosine(a: DocVector, b: DocVector): number {
  let dot = 0, na = 0, nb = 0;
  for (const t in a.tf) { na += a.tf[t] * a.tf[t]; if (b.tf[t]) dot += a.tf[t] * b.tf[t]; }
  for (const t in b.tf) nb += b.tf[t] * b.tf[t];
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface Related { doc: IDoc; score: number; shared: string[] }

export function relatedTo(index: IndexData, docId: string, limit = 8): Related[] {
  const base = index.vectors[docId];
  const baseDoc = index.docs[docId];
  if (!base || !baseDoc) return [];
  const baseTags = new Set(baseDoc.tags.map((t) => t.toLowerCase()));
  const out: Related[] = [];
  for (const id of Object.keys(index.vectors)) {
    if (id === docId) continue;
    const v = index.vectors[id];
    const doc = index.docs[id];
    let sim = cosine(base, v);
    const shared: string[] = [];
    // shared tags boost
    for (const t of doc.tags) if (baseTags.has(t.toLowerCase())) { sim += 0.15; shared.push(`#${t}`); }
    // shared keywords
    const commonKw = base.keywords.filter((k) => v.keywords.includes(k));
    for (const k of commonKw.slice(0, 4)) shared.push(k);
    if (sim > 0.06) out.push({ doc, score: Math.min(1, sim), shared: Array.from(new Set(shared)).slice(0, 5) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function findRelated(docId: string, limit = 8): Promise<Related[]> {
  const index = await getIndex();
  return relatedTo(index, docId, limit);
}

// ---------- DuplicateEngine ----------
export interface DuplicateGroup { kind: "exact" | "near"; docs: IDoc[]; similarity: number }

export async function findDuplicates(threshold = 0.85): Promise<DuplicateGroup[]> {
  const index = await getIndex();
  const ids = Object.keys(index.vectors);
  const groups: DuplicateGroup[] = [];
  const used = new Set<string>();
  const norm = (d: IDoc) => normalize(`${d.title} ${d.text}`).toLowerCase();
  for (let i = 0; i < ids.length; i++) {
    if (used.has(ids[i])) continue;
    const di = index.docs[ids[i]];
    if (!di || (!di.text && !di.title)) continue;
    const cluster: IDoc[] = [di];
    let kind: "exact" | "near" = "near";
    let maxSim = 0;
    for (let j = i + 1; j < ids.length; j++) {
      if (used.has(ids[j])) continue;
      const dj = index.docs[ids[j]];
      if (!dj) continue;
      const sim = cosine(index.vectors[ids[i]], index.vectors[ids[j]]);
      const exact = norm(di) === norm(dj) && norm(di).length > 0;
      if (exact || sim >= threshold) {
        cluster.push(dj);
        used.add(ids[j]);
        if (exact) kind = "exact";
        maxSim = Math.max(maxSim, exact ? 1 : sim);
      }
    }
    if (cluster.length > 1) { used.add(ids[i]); groups.push({ kind, docs: cluster, similarity: maxSim }); }
  }
  return groups.sort((a, b) => b.similarity - a.similarity);
}

// ---------- DateEngine ----------
const WEEKDAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
export interface DetectedDate { label: string; iso: string | null }

export function detectDate(text: string, base = new Date()): DetectedDate | null {
  const s = text.toLowerCase();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const addDays = (n: number) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };
  if (/\btoday\b/.test(s)) return { label: "Today", iso: iso(base) };
  if (/\btomorrow\b/.test(s)) return { label: "Tomorrow", iso: iso(addDays(1)) };
  if (/\byesterday\b/.test(s)) return { label: "Yesterday", iso: iso(addDays(-1)) };
  if (/\bnext week\b/.test(s)) return { label: "Next week", iso: iso(addDays(7)) };
  if (/\bthis week\b/.test(s)) return { label: "This week", iso: iso(addDays(3)) };
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(s)) {
      let diff = (i - base.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      return { label: WEEKDAYS[i].charAt(0).toUpperCase() + WEEKDAYS[i].slice(1), iso: iso(addDays(diff)) };
    }
  }
  const m = s.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (m) {
    const dd = parseInt(m[1]), mm = parseInt(m[2]) - 1, yy = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3])) : base.getFullYear();
    const d = new Date(yy, mm, dd);
    if (!isNaN(d.getTime())) return { label: m[0], iso: iso(d) };
  }
  return null;
}

export function detectTime(text: string): string | null {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) || text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = m[2] ? parseInt(m[2]) : 0;
  const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// ---------- PriorityEngine ----------
export function detectPriority(text: string): "urgent" | "high" | "medium" | "low" {
  const s = text.toLowerCase();
  if (/\b(urgent|asap|immediately|critical|emergency)\b/.test(s)) return "urgent";
  if (/\b(important|high priority|priority|must|deadline|due)\b/.test(s)) return "high";
  if (/\b(low priority|whenever|someday|eventually|optional)\b/.test(s)) return "low";
  return "medium";
}

// ---------- TaskEngine ----------
export interface DetectedTask {
  text: string; task: string; date: DetectedDate | null; time: string | null;
  priority: "urgent" | "high" | "medium" | "low"; source: string;
}
const ACTION_RE = /\b(submit|finish|complete|send|call|email|buy|pay|review|read|write|prepare|book|schedule|plan|study|revise|fix|update|meet|remind|deliver|renew|clean|check)\b/i;

export function detectTasksIn(text: string, source = ""): DetectedTask[] {
  const out: DetectedTask[] = [];
  const lines = normalize(text).split(/[\n.!?\u0964]+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const hasAction = ACTION_RE.test(line);
    const date = detectDate(line);
    const time = detectTime(line);
    if (hasAction || date) {
      const task = line.replace(/^(i (need|have|want|should|must) to|todo:?|to-do:?|remember to|don't forget to)\s*/i, "").trim();
      out.push({ text: line, task: task || line, date, time, priority: detectPriority(line), source });
    }
  }
  return out.slice(0, 30);
}

export async function detectAllTasks(): Promise<DetectedTask[]> {
  const index = await getIndex();
  const out: DetectedTask[] = [];
  for (const doc of Object.values(index.docs)) {
    if (doc.kind === "task") continue;
    for (const t of detectTasksIn(`${doc.title}. ${doc.text}`, doc.path)) out.push(t);
  }
  return out.slice(0, 60);
}

// ---------- KnowledgeGraphEngine ----------
export interface GraphNode { id: string; label: string; type: "page" | "note" | "tag" | "topic"; refId?: string; route?: IDoc["route"]; degree: number }
export interface GraphEdge { source: string; target: string; type: string }
export interface KnowledgeGraph { nodes: GraphNode[]; edges: GraphEdge[]; clusters: { topic: string; nodeIds: string[] }[] }

export async function buildGraph(): Promise<KnowledgeGraph> {
  const index = await getIndex();
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const addNode = (id: string, label: string, type: GraphNode["type"], refId?: string, route?: IDoc["route"]) => {
    if (!nodes.has(id)) nodes.set(id, { id, label, type, refId, route, degree: 0 });
    return nodes.get(id)!;
  };
  const addEdge = (s: string, t: string, type: string) => {
    if (s === t) return;
    edges.push({ source: s, target: t, type });
    if (nodes.get(s)) nodes.get(s)!.degree++;
    if (nodes.get(t)) nodes.get(t)!.degree++;
  };
  const titleToId = new Map<string, string>();
  for (const doc of Object.values(index.docs)) {
    if (doc.kind !== "page" && doc.kind !== "note") continue;
    addNode(doc.id, doc.title || "Untitled", doc.kind as any, doc.refId, doc.route);
    if (doc.title) titleToId.set(doc.title.toLowerCase(), doc.id);
  }
  for (const doc of Object.values(index.docs)) {
    if (doc.kind !== "page" && doc.kind !== "note") continue;
    // parent/child (pages)
    if (doc.kind === "page" && doc.extra?.parentPageId) {
      const parentId = `page:${doc.extra.parentPageId}`;
      if (nodes.has(parentId)) addEdge(parentId, doc.id, "child of");
    }
    // tags
    for (const tag of doc.tags) {
      const tid = `tag:${tag.toLowerCase()}`;
      addNode(tid, `#${tag}`, "tag");
      addEdge(doc.id, tid, "tagged with");
    }
    // [[links]] / @mentions
    const links = extractLinks(`${doc.title} ${doc.text}`);
    for (const l of links) {
      const target = titleToId.get(l.title.toLowerCase());
      if (target) addEdge(doc.id, target, l.kind === "link" ? "links to" : "mentions");
    }
  }
  // topic clustering (shared top keyword)
  const topicMap = new Map<string, string[]>();
  for (const doc of Object.values(index.docs)) {
    if (doc.kind !== "page" && doc.kind !== "note") continue;
    const kws = extractKeywords(`${doc.title} ${doc.text}`, 2).map((k) => k.term);
    for (const kw of kws) {
      const arr = topicMap.get(kw) || [];
      arr.push(doc.id);
      topicMap.set(kw, arr);
    }
  }
  const clusters: { topic: string; nodeIds: string[] }[] = [];
  for (const [topic, ids] of topicMap.entries()) {
    if (ids.length >= 2) {
      const tid = `topic:${topic}`;
      addNode(tid, topic, "topic");
      for (const id of ids) addEdge(tid, id, "same topic");
      clusters.push({ topic, nodeIds: ids });
    }
  }
  return {
    nodes: Array.from(nodes.values()).sort((a, b) => b.degree - a.degree),
    edges,
    clusters: clusters.sort((a, b) => b.nodeIds.length - a.nodeIds.length).slice(0, 12),
  };
}

export async function neighborsOf(nodeId: string): Promise<{ node: GraphNode; via: string }[]> {
  const g = await buildGraph();
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const out: { node: GraphNode; via: string }[] = [];
  const seen = new Set<string>();
  for (const e of g.edges) {
    if (e.source === nodeId && byId.has(e.target) && !seen.has(e.target)) { out.push({ node: byId.get(e.target)!, via: e.type }); seen.add(e.target); }
    else if (e.target === nodeId && byId.has(e.source) && !seen.has(e.source)) { out.push({ node: byId.get(e.source)!, via: e.type }); seen.add(e.source); }
  }
  return out;
}

// ---------- CollectionsEngine ----------
export interface Collection { key: string; title: string; icon: string; docs: IDoc[] }

export async function buildCollections(): Promise<Collection[]> {
  const index = await getIndex();
  const docs = Object.values(index.docs);
  const now = Date.now();
  const parseT = (s: string) => { const t = Date.parse(s); return isNaN(t) ? 0 : t; };

  const recentlyUpdated = [...docs].sort((a, b) => parseT(b.updatedAt) - parseT(a.updatedAt)).slice(0, 20);
  const unfinished = docs.filter((d) => (d.kind === "task" && d.extra?.status !== "done") ||
    (d.kind === "note" && d.extra?.type === "checklist" && (d.extra?.checklistDone ?? 0) < (d.extra?.checklistTotal ?? 0)));
  const dueSoon = docs.filter((d) => {
    const dd = d.extra?.dueDate ? Date.parse(d.extra.dueDate) : NaN;
    return !isNaN(dd) && dd <= now + 7 * 86400000 && d.extra?.status !== "done";
  }).sort((a, b) => Date.parse(a.extra!.dueDate) - Date.parse(b.extra!.dueDate));
  const important = docs.filter((d) => d.extra?.isFavorite || d.extra?.priority === "urgent" || d.extra?.priority === "high");

  const byCat = (cat: string) => docs.filter((d) => {
    const toks = new Set(contentTokens(`${d.title} ${d.text} ${d.tags.join(" ")}`));
    const words = CATEGORY_LEXICON[cat];
    return words ? words.some((w) => toks.has(w)) : false;
  });

  // orphan pages: pages with no parent, not referenced by links, no children
  const g = await buildGraph();
  const connected = new Set<string>();
  for (const e of g.edges) { connected.add(e.source); connected.add(e.target); }
  const orphans = docs.filter((d) => d.kind === "page" && !d.extra?.parentPageId && !connected.has(d.id));

  const dupGroups = await findDuplicates(0.85);
  const dupDocs = dupGroups.flatMap((grp) => grp.docs);

  const cols: Collection[] = [
    { key: "recent", title: "Recently Updated", icon: "clock-outline", docs: recentlyUpdated },
    { key: "unfinished", title: "Unfinished Tasks", icon: "checkbox-blank-outline", docs: unfinished },
    { key: "due", title: "Due Soon", icon: "calendar-alert", docs: dueSoon },
    { key: "important", title: "Important", icon: "star-outline", docs: important },
    { key: "study", title: "Study Material", icon: "school-outline", docs: byCat("Study") },
    { key: "research", title: "Research", icon: "flask-outline", docs: byCat("Research") },
    { key: "project", title: "Project Notes", icon: "folder-outline", docs: byCat("Project") },
    { key: "orphan", title: "Orphan Pages", icon: "link-off", docs: orphans },
    { key: "duplicates", title: "Possible Duplicates", icon: "content-copy", docs: dupDocs },
  ];
  return cols.filter((c) => c.docs.length > 0);
}
