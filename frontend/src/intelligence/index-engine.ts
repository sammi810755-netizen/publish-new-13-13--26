// IndexEngine + CacheEngine — incremental inverted index over the corpus.
// Persisted via platform KV. Rebuildable from user data at any time; detects
// corruption and self-heals. The index/cache are NEVER the source of truth.
import { kvGet, kvSet } from "@/src/db/kv";
import { buildCorpus, IDoc } from "./corpus";
import { contentTokens, extractKeywords } from "./nlp";

const INDEX_KEY = "intel.index.v1";
const CACHE_KEY = "intel.cache.v1";
const INDEX_VERSION = 1;

export interface DocVector {
  id: string;
  tf: Record<string, number>; // term -> count
  len: number; // total content tokens
  keywords: string[];
  sig: string; // updatedAt signature
}

export interface IndexData {
  version: number;
  builtAt: string;
  docs: Record<string, IDoc>;
  vectors: Record<string, DocVector>;
  df: Record<string, number>; // document frequency per term
  count: number;
}

let mem: IndexData | null = null;
let building: Promise<IndexData> | null = null;

function emptyIndex(): IndexData {
  return { version: INDEX_VERSION, builtAt: "", docs: {}, vectors: {}, df: {}, count: 0 };
}

function isValid(x: any): x is IndexData {
  return !!x && typeof x === "object" && x.version === INDEX_VERSION &&
    x.docs && x.vectors && x.df && typeof x.count === "number";
}

function vectorFor(doc: IDoc): DocVector {
  const combined = `${doc.title} ${doc.title} ${doc.text} ${doc.tags.join(" ")}`;
  const toks = contentTokens(combined);
  const tf: Record<string, number> = {};
  for (const t of toks) tf[t] = (tf[t] || 0) + 1;
  return {
    id: doc.id,
    tf,
    len: toks.length,
    keywords: extractKeywords(`${doc.title} ${doc.text}`, 8).map((k) => k.term),
    sig: doc.updatedAt || doc.createdAt || "",
  };
}

function recomputeDf(index: IndexData): void {
  const df: Record<string, number> = {};
  for (const v of Object.values(index.vectors)) {
    for (const term of Object.keys(v.tf)) df[term] = (df[term] || 0) + 1;
  }
  index.df = df;
}

// Incrementally reconcile the persisted index against the current corpus:
// only re-vectorizes docs whose signature changed; drops deleted docs.
export async function buildIndex(force = false): Promise<IndexData> {
  const corpus = await buildCorpus();
  let index: IndexData;
  if (force || !mem) {
    let stored: any = null;
    try { stored = await kvGet<any>(INDEX_KEY, null); } catch {}
    index = !force && isValid(stored) ? stored : emptyIndex();
  } else {
    index = mem;
  }

  const currentIds = new Set(corpus.map((d) => d.id));
  let changed = 0;

  // remove deleted
  for (const id of Object.keys(index.docs)) {
    if (!currentIds.has(id)) {
      delete index.docs[id];
      delete index.vectors[id];
      changed++;
    }
  }
  // add / update changed
  for (const doc of corpus) {
    const prev = index.vectors[doc.id];
    const sig = doc.updatedAt || doc.createdAt || "";
    if (!prev || prev.sig !== sig || !index.docs[doc.id]) {
      index.docs[doc.id] = doc;
      index.vectors[doc.id] = vectorFor(doc);
      changed++;
    } else {
      index.docs[doc.id] = doc; // refresh lightweight metadata (path, tags)
    }
  }

  index.count = Object.keys(index.docs).length;
  if (changed > 0 || !index.builtAt) {
    recomputeDf(index);
    index.builtAt = new Date().toISOString();
    mem = index;
    try { await kvSet(INDEX_KEY, index); } catch {}
  } else {
    mem = index;
  }
  return index;
}

export async function getIndex(): Promise<IndexData> {
  if (mem && mem.builtAt) {
    // refresh in background-ish (await but cheap when nothing changed)
    return buildIndex(false);
  }
  if (building) return building;
  building = buildIndex(false).finally(() => { building = null; });
  return building;
}

// Rebuild the entire index from scratch (recovery path).
export async function rebuildIndex(): Promise<IndexData> {
  mem = null;
  try { await kvSet(INDEX_KEY, null as any); } catch {}
  await clearCache();
  return buildIndex(true);
}

export function idf(index: IndexData, term: string): number {
  const n = index.count || 1;
  const df = index.df[term] || 0;
  return Math.log(1 + n / (1 + df));
}

export async function indexHealth(): Promise<{ ok: boolean; count: number; builtAt: string; terms: number }> {
  try {
    const stored = await kvGet<any>(INDEX_KEY, null);
    if (!isValid(stored)) {
      const rebuilt = await getIndex();
      return { ok: true, count: rebuilt.count, builtAt: rebuilt.builtAt, terms: Object.keys(rebuilt.df).length };
    }
    return { ok: true, count: stored.count, builtAt: stored.builtAt, terms: Object.keys(stored.df).length };
  } catch {
    return { ok: false, count: 0, builtAt: "", terms: 0 };
  }
}

// ---------- CacheEngine ----------
interface CacheEntry { v: any; t: number; sig: string }
let cacheMem: Record<string, CacheEntry> | null = null;

async function loadCache(): Promise<Record<string, CacheEntry>> {
  if (cacheMem) return cacheMem;
  try {
    const raw = await kvGet<any>(CACHE_KEY, null);
    cacheMem = raw && typeof raw === "object" ? raw : {};
  } catch {
    cacheMem = {};
  }
  return cacheMem!;
}

export async function cacheGet<T>(key: string, sig: string): Promise<T | null> {
  try {
    const c = await loadCache();
    const e = c[key];
    if (e && e.sig === sig) return e.v as T;
  } catch {}
  return null;
}

export async function cacheSet(key: string, sig: string, value: any): Promise<void> {
  try {
    const c = await loadCache();
    c[key] = { v: value, t: Date.now(), sig };
    // bound cache size
    const keys = Object.keys(c);
    if (keys.length > 200) {
      keys.sort((a, b) => c[a].t - c[b].t).slice(0, keys.length - 200).forEach((k) => delete c[k]);
    }
    await kvSet(CACHE_KEY, c);
  } catch {}
}

export async function clearCache(): Promise<void> {
  cacheMem = {};
  try { await kvSet(CACHE_KEY, {}); } catch {}
}

export function indexSignature(index: IndexData): string {
  return `${index.count}:${index.builtAt}`;
}
