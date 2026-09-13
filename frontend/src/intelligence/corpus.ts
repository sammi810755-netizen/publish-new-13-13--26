// Unified corpus builder — reads existing user data (Notes, Pages+Blocks, DB
// records, Tasks, Comments) into a single deterministic document list that the
// intelligence engines index. Read-only; never mutates user data.
import { listNotes } from "@/src/db/repo";
import { listAllPages, getAllBlocks } from "@/src/db/pages-repo";
import { listAllDatabases, listRecords, listTasks } from "@/src/db/workspace-store";
import { blocksToPlainText, parseBlockContent } from "@/src/lib/blocks";
import type { Block } from "@/src/db/pages-types";

export type DocKind = "note" | "page" | "record" | "task" | "comment";

export interface IDoc {
  id: string; // unique across corpus: `${kind}:${refId}`
  kind: DocKind;
  refId: string;
  title: string;
  text: string;
  tags: string[];
  path: string; // human-readable location/breadcrumb
  route: { pathname: string; params?: Record<string, string> } | null;
  updatedAt: string;
  createdAt: string;
  extra?: Record<string, any>;
}

function safe<T>(p: Promise<T>, fb: T): Promise<T> {
  return p.then((v) => v ?? fb).catch(() => fb);
}

export async function buildCorpus(): Promise<IDoc[]> {
  const docs: IDoc[] = [];

  // ---- Notes ----
  try {
    const notes = await safe(listNotes({ filter: "all", sort: "updated" }), [] as any[]);
    for (const n of notes) {
      const tags = (n.labelNames ? String(n.labelNames).split(",") : []).map((t: string) => t.trim()).filter(Boolean);
      docs.push({
        id: `note:${n.id}`,
        kind: "note",
        refId: n.id,
        title: n.title || "Untitled note",
        text: n.content || "",
        tags,
        path: "Notes",
        route: { pathname: "/editor", params: { id: n.id } },
        updatedAt: n.updatedAt,
        createdAt: n.createdAt,
        extra: { type: n.type, isFavorite: n.isFavorite, checklistTotal: n.checklistTotal, checklistDone: n.checklistDone },
      });
    }
  } catch {}

  // ---- Pages + Blocks ----
  try {
    const pages = await safe(listAllPages(false), [] as any[]);
    const blocks = await safe(getAllBlocks(), [] as Block[]);
    const byPage = new Map<string, Block[]>();
    for (const b of blocks) {
      const arr = byPage.get(b.pageId) || [];
      arr.push(b);
      byPage.set(b.pageId, arr);
    }
    const pageMap = new Map(pages.map((p: any) => [p.id, p]));
    const pathOf = (p: any): string => {
      const parts: string[] = [];
      let cur: any = p;
      let guard = 0;
      while (cur && guard < 40) {
        parts.unshift(cur.title || "Untitled");
        cur = cur.parentPageId ? pageMap.get(cur.parentPageId) : null;
        guard++;
      }
      return parts.join(" / ");
    };
    for (const p of pages) {
      const pageBlocks = (byPage.get(p.id) || []).sort((a, b) => a.orderIndex - b.orderIndex);
      const text = blocksToPlainText(pageBlocks);
      const tags: string[] = [];
      docs.push({
        id: `page:${p.id}`,
        kind: "page",
        refId: p.id,
        title: p.title || "Untitled",
        text,
        tags,
        path: pathOf(p),
        route: { pathname: "/page/[id]", params: { id: p.id } },
        updatedAt: p.updatedAt,
        createdAt: p.createdAt,
        extra: { icon: p.icon, isFavorite: p.isFavorite, parentPageId: p.parentPageId, blockCount: pageBlocks.length,
          blocks: pageBlocks.map((b) => ({ type: b.type, text: parseBlockContent(b.content).text || "", checked: parseBlockContent(b.content).checked })) },
      });
    }
  } catch {}

  // ---- Database records ----
  try {
    const dbs = await safe(listAllDatabases(), [] as any[]);
    for (const d of dbs) {
      const recs = await safe(listRecords(d.id), [] as any[]);
      for (const r of recs) {
        const vals = Object.values(r.values || {})
          .map((v) => (Array.isArray(v) ? v.join(" ") : String(v ?? "")))
          .filter(Boolean)
          .join(" \u2022 ");
        docs.push({
          id: `record:${r.id}`,
          kind: "record",
          refId: r.id,
          title: vals.split(" \u2022 ")[0] || "Record",
          text: vals,
          tags: [d.title],
          path: `Database / ${d.title}`,
          route: r.pageId ? { pathname: "/page/[id]", params: { id: r.pageId } } : { pathname: "/database/[id]", params: { id: d.id } },
          updatedAt: r.updatedAt,
          createdAt: r.createdAt,
          extra: { databaseId: d.id },
        });
      }
    }
  } catch {}

  // ---- Tasks ----
  try {
    const tasks = await safe(listTasks({}), [] as any[]);
    for (const t of tasks) {
      docs.push({
        id: `task:${t.id}`,
        kind: "task",
        refId: t.id,
        title: t.title || "Task",
        text: t.title || "",
        tags: t.tags || [],
        path: "Tasks",
        route: { pathname: "/calendar" },
        updatedAt: t.updatedAt,
        createdAt: t.createdAt,
        extra: { status: t.status, priority: t.priority, dueDate: t.dueDate },
      });
    }
  } catch {}

  return docs;
}
