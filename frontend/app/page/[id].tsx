import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";

import { useApp, useTheme } from "@/src/context/AppContext";
import { useToast } from "@/src/components/Toast";
import { BottomSheet, ConfirmSheet } from "@/src/components/Sheet";
import { BlockRow } from "@/src/components/BlockRow";
import { BlockTypeSheet } from "@/src/components/BlockTypeSheet";
import { useBlockHistory } from "@/src/hooks/use-block-history";
import { Block, BlockType, Page } from "@/src/db/pages-types";
import {
  defaultContent,
  parseBlockContent,
  serializeBlockContent,
  visibleBlocks,
  blocksToPlainText,
} from "@/src/lib/blocks";
import {
  childCount,
  createPage,
  deletePageCascade,
  deletePageReparent,
  duplicatePage,
  ensurePageByTitle,
  findPageByTitle,
  getAllBlocks,
  getBlocks,
  getBreadcrumb,
  getPage,
  listChildPages,
  makeBlock,
  replacePageBlocks,
  searchPages,
  updatePage,
} from "@/src/db/pages-repo";
import { extractLinks, detectTrigger, applyTrigger } from "@/src/lib/links";
import {
  addComment,
  createDatabase,
  deleteComment,
  listDatabasesForPage,
  listPageComments,
  saveVersion,
  updateComment,
} from "@/src/db/workspace-store";
import { Comment, Database } from "@/src/db/workspace-types";

// ---------- pure block-array helpers ----------

function branchEnd(blocks: Block[], index: number): number {
  const depth = blocks[index].depth;
  let end = index + 1;
  while (end < blocks.length && blocks[end].depth > depth) end += 1;
  return end;
}

function insertAfter(blocks: Block[], afterId: string | null, nb: Block): Block[] {
  if (!afterId) return [...blocks, nb];
  const i = blocks.findIndex((b) => b.id === afterId);
  if (i < 0) return [...blocks, nb];
  const end = branchEnd(blocks, i);
  const copy = blocks.slice();
  copy.splice(end, 0, { ...nb, depth: blocks[i].depth });
  return copy;
}

function patchContent(blocks: Block[], id: string, patch: Record<string, any>): Block[] {
  return blocks.map((b) => {
    if (b.id !== id) return b;
    const c = { ...parseBlockContent(b.content), ...patch };
    return { ...b, content: serializeBlockContent(c) };
  });
}

function convertType(blocks: Block[], id: string, type: BlockType): Block[] {
  return blocks.map((b) => {
    if (b.id !== id) return b;
    const old = parseBlockContent(b.content);
    const next = { ...defaultContent(type) };
    if ("text" in next) next.text = old.text ?? "";
    return { ...b, type, content: serializeBlockContent(next) };
  });
}

function removeBranch(blocks: Block[], id: string): Block[] {
  const i = blocks.findIndex((b) => b.id === id);
  if (i < 0) return blocks;
  const end = branchEnd(blocks, i);
  return [...blocks.slice(0, i), ...blocks.slice(end)];
}

function duplicateBranch(blocks: Block[], id: string): Block[] {
  const i = blocks.findIndex((b) => b.id === id);
  if (i < 0) return blocks;
  const end = branchEnd(blocks, i);
  const branch = blocks.slice(i, end);
  const idMap = new Map<string, string>();
  branch.forEach((b) => idMap.set(b.id, `${b.id}_c${Math.random().toString(36).slice(2, 7)}`));
  const clones = branch.map((b) => ({
    ...b,
    id: idMap.get(b.id)!,
    parentBlockId: b.parentBlockId ? idMap.get(b.parentBlockId) ?? null : null,
  }));
  return [...blocks.slice(0, end), ...clones, ...blocks.slice(end)];
}

function moveBranch(blocks: Block[], id: string, dir: -1 | 1): Block[] {
  const i = blocks.findIndex((b) => b.id === id);
  if (i < 0) return blocks;
  const depth = blocks[i].depth;
  const end = branchEnd(blocks, i);
  if (dir === -1) {
    let j = i - 1;
    while (j >= 0 && blocks[j].depth > depth) j -= 1;
    if (j < 0 || blocks[j].depth < depth) return blocks; // no previous sibling
    const before = blocks.slice(0, j);
    const prev = blocks.slice(j, i);
    const cur = blocks.slice(i, end);
    const after = blocks.slice(end);
    return [...before, ...cur, ...prev, ...after];
  } else {
    if (end >= blocks.length || blocks[end].depth < depth) return blocks; // no next sibling
    const nextEnd = branchEnd(blocks, end);
    const before = blocks.slice(0, i);
    const cur = blocks.slice(i, end);
    const next = blocks.slice(end, nextEnd);
    const after = blocks.slice(nextEnd);
    return [...before, ...next, ...cur, ...after];
  }
}

function indentBranch(blocks: Block[], id: string, delta: 1 | -1): Block[] {
  const i = blocks.findIndex((b) => b.id === id);
  if (i < 0) return blocks;
  const depth = blocks[i].depth;
  if (delta === -1 && depth === 0) return blocks;
  if (delta === 1) {
    // needs a previous sibling at same depth to nest under
    let j = i - 1;
    while (j >= 0 && blocks[j].depth > depth) j -= 1;
    if (j < 0 || blocks[j].depth !== depth) return blocks;
  }
  const end = branchEnd(blocks, i);
  return blocks.map((b, idx) => {
    if (idx >= i && idx < end) return { ...b, depth: Math.max(0, b.depth + delta) };
    return b;
  });
}

// ---------- screen ----------

export default function PageEditor() {
  const c = useTheme();
  const { refresh } = useApp();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const pageId = String(params.id);

  const [page, setPage] = useState<Page | null>(null);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("\uD83D\uDCC4");
  const [breadcrumb, setBreadcrumb] = useState<Page[]>([]);
  const [subpages, setSubpages] = useState<(Page & { kids: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const [addVisible, setAddVisible] = useState(false);
  const [convertFor, setConvertFor] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [pageMenu, setPageMenu] = useState(false);
  const [deleteChoice, setDeleteChoice] = useState(false);
  const [iconPicker, setIconPicker] = useState(false);
  const [databases, setDatabases] = useState<Database[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [outLinks, setOutLinks] = useState<string[]>([]);
  const [backlinks, setBacklinks] = useState<{ id: string; title: string }[]>([]);
  const [trigger, setTrigger] = useState<{ blockId: string; type: "link" | "mention"; query: string } | null>(null);
  const [suggestions, setSuggestions] = useState<{ id: string; title: string }[]>([]);

  const history = useBlockHistory([]);
  const loadedRef = useRef(false);
  const latestRef = useRef<Block[]>([]);

  latestRef.current = history.blocks;

  useEffect(() => {
    const titles = new Set<string>();
    for (const b of history.blocks) {
      for (const t of extractLinks(parseBlockContent(b.content).text)) titles.add(t.title);
    }
    setOutLinks(Array.from(titles));
  }, [history.blocks]);

  const loadMeta = useCallback(async () => {
    try {
      const [bc, subs] = await Promise.all([getBreadcrumb(pageId), listChildPages(pageId)]);
      setBreadcrumb(bc);
      const withKids = await Promise.all(
        subs.map(async (s) => ({ ...s, kids: await childCount(s.id) })),
      );
      setSubpages(withKids);
      setDatabases(await listDatabasesForPage(pageId));
      setComments(await listPageComments(pageId));
      // backlinks: scan all blocks for [[thisTitle]] / @thisTitle
      const me = await getPage(pageId);
      const myTitle = (me?.title || "").trim().toLowerCase();
      if (myTitle) {
        const all = await getAllBlocks();
        const hits = new Map<string, string>();
        for (const b of all) {
          if (b.pageId === pageId) continue;
          const toks = extractLinks(parseBlockContent(b.content).text);
          if (toks.some((t) => t.title.trim().toLowerCase() === myTitle)) {
            if (!hits.has(b.pageId)) {
              const pg = await getPage(b.pageId);
              if (pg && !pg.isDeleted) hits.set(b.pageId, pg.title || "Untitled");
            }
          }
        }
        setBacklinks(Array.from(hits, ([id, title]) => ({ id, title })));
      } else {
        setBacklinks([]);
      }
    } catch (e) {
      console.warn("[page] meta load failed", e);
    }
  }, [pageId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await getPage(pageId);
      if (!p) {
        toast.show("Page not found", "error");
        router.back();
        return;
      }
      setPage(p);
      setTitle(p.title);
      setIcon(p.icon || "\uD83D\uDCC4");
      const blocks = await getBlocks(pageId);
      history.reset(blocks);
      loadedRef.current = true;
    } catch (e) {
      console.warn("[page] load failed", e);
      toast.show("Couldn't open page", "error");
    } finally {
      setLoading(false);
    }
  }, [pageId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadedRef.current = false;
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      loadMeta();
    }, [loadMeta]),
  );

  // Debounced autosave of blocks (also persists undo/redo results).
  useEffect(() => {
    if (!loadedRef.current) return;
    const t = setTimeout(() => {
      replacePageBlocks(pageId, history.blocks).catch((e) =>
        console.warn("[page] block save failed", e),
      );
    }, 500);
    return () => clearTimeout(t);
  }, [history.blocks, pageId]);

  // Flush on unmount.
  useEffect(() => {
    return () => {
      if (loadedRef.current) {
        replacePageBlocks(pageId, latestRef.current).catch(() => {});
      }
    };
  }, [pageId]);

  // Debounced title/icon save.
  useEffect(() => {
    if (!loadedRef.current) return;
    const t = setTimeout(() => {
      updatePage(pageId, { title, icon })
        .then(() => refresh())
        .catch((e) => console.warn("[page] meta save failed", e));
    }, 400);
    return () => clearTimeout(t);
  }, [title, icon, pageId, refresh]);

  // block mutation helpers -----------------------------------------------
  const setBlocks = (next: Block[], coalesceKey?: string) => history.set(next, coalesceKey);

  const onChangeText = (id: string, text: string) => {
    setBlocks(patchContent(history.blocks, id, { text }), `text:${id}`);
    const trig = detectTrigger(text);
    if (trig && trig.query.length >= 0) {
      setTrigger({ blockId: id, type: trig.type, query: trig.query });
      searchPages(trig.query).then((pgs) =>
        setSuggestions(pgs.slice(0, 6).map((p) => ({ id: p.id, title: p.title || "Untitled" }))),
      );
    } else {
      setTrigger(null);
      setSuggestions([]);
    }
  };

  const pickSuggestion = (title: string) => {
    if (!trigger) return;
    const blk = history.blocks.find((b) => b.id === trigger.blockId);
    if (!blk) return;
    const curText = parseBlockContent(blk.content).text || "";
    const nextText = applyTrigger(curText, trigger.type, title);
    setBlocks(patchContent(history.blocks, trigger.blockId, { text: nextText }));
    setTrigger(null);
    setSuggestions([]);
    // recompute link chips shortly after
    setTimeout(() => recomputeOutLinks(), 100);
  };

  const recomputeOutLinks = () => {
    const titles = new Set<string>();
    for (const b of latestRef.current) {
      for (const t of extractLinks(parseBlockContent(b.content).text)) titles.add(t.title);
    }
    setOutLinks(Array.from(titles));
  };

  const openLink = async (title: string) => {
    try {
      const pg = await ensurePageByTitle(title);
      refresh();
      router.push({ pathname: "/page/[id]", params: { id: pg.id } });
    } catch {
      toast.show("Couldn't open link", "error");
    }
  };
  const onToggleCheck = (id: string) => {
    const cur = parseBlockContent(history.blocks.find((b) => b.id === id)?.content);
    setBlocks(patchContent(history.blocks, id, { checked: !cur.checked }));
  };
  const onToggleCollapse = (id: string) => {
    const cur = parseBlockContent(history.blocks.find((b) => b.id === id)?.content);
    setBlocks(patchContent(history.blocks, id, { collapsed: !cur.collapsed }));
  };

  const pickImageFor = async (id: string) => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toast.show("Photo permission needed", "error");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.6,
        base64: true,
      });
      if (res.canceled || !res.assets?.[0]?.base64) return;
      const asset = res.assets[0];
      const uri = `data:${asset.mimeType ?? "image/jpeg"};base64,${asset.base64}`;
      setBlocks(patchContent(latestRef.current, id, { image: uri }));
    } catch (e) {
      console.warn("[page] image pick failed", e);
      toast.show("Couldn't add image", "error");
    }
  };

  const addBlock = (type: BlockType) => {
    const afterId = focusedId ?? (history.blocks.length ? history.blocks[history.blocks.length - 1].id : null);
    const nb = makeBlock(pageId, type, 0);
    const next = insertAfter(history.blocks, afterId, nb);
    setBlocks(next);
    setFocusedId(nb.id);
    if (type === "image") setTimeout(() => pickImageFor(nb.id), 150);
  };

  const doConvert = (type: BlockType) => {
    if (!convertFor) return;
    setBlocks(convertType(history.blocks, convertFor, type));
    setConvertFor(null);
  };

  const menuBlock = history.blocks.find((b) => b.id === menuFor) ?? null;

  const vis = visibleBlocks(history.blocks);

  const goCreateChild = async () => {
    try {
      const child = await createPage(pageId, {});
      refresh();
      router.push({ pathname: "/page/[id]", params: { id: child.id } });
    } catch {
      toast.show("Couldn't create sub-page", "error");
    }
  };

  const onDuplicatePage = async () => {
    setPageMenu(false);
    try {
      const newId = await duplicatePage(pageId);
      refresh();
      if (newId) {
        toast.show("Page duplicated", "success");
        router.replace({ pathname: "/page/[id]", params: { id: newId } });
      }
    } catch {
      toast.show("Couldn't duplicate", "error");
    }
  };

  const toggleFavorite = async () => {
    if (!page) return;
    const nextVal = page.isFavorite ? 0 : 1;
    setPage({ ...page, isFavorite: nextVal });
    await updatePage(pageId, { isFavorite: nextVal });
    refresh();
    toast.show(nextVal ? "Added to favorites" : "Removed from favorites", "success");
  };

  const EMOJIS = ["\uD83D\uDCC4", "\uD83D\uDCD8", "\uD83D\uDCDD", "\uD83D\uDCA1", "\uD83D\uDE80", "\uD83C\uDFAF", "\u2705", "\uD83D\uDCCA", "\uD83D\uDCC5", "\uD83D\uDD25", "\u2B50", "\uD83E\uDDE0", "\uD83D\uDCDA", "\uD83D\uDCBC", "\uD83C\uDFA8", "\uD83C\uDFC3", "\uD83C\uDF31", "\uD83D\uDCB0"];

  return (
    <View style={{ flex: 1, backgroundColor: c.surface, paddingTop: insets.top }}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable testID="page-back" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={c.onSurface} />
        </Pressable>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.crumbScroll}
          contentContainerStyle={styles.crumbRow}
        >
          {breadcrumb.map((p, idx) => (
            <View key={p.id} style={styles.crumbItem}>
              {idx > 0 && <MaterialCommunityIcons name="chevron-right" size={14} color={c.muted} />}
              <Pressable
                onPress={() => idx < breadcrumb.length - 1 && router.replace({ pathname: "/page/[id]", params: { id: p.id } })}
                testID={`crumb-${idx}`}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.crumbText,
                    { color: idx === breadcrumb.length - 1 ? c.onSurface : c.muted },
                  ]}
                >
                  {p.icon} {p.title || "Untitled"}
                </Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
        <Pressable testID="page-undo" onPress={history.undo} disabled={!history.canUndo} style={styles.iconBtn} hitSlop={6}>
          <MaterialCommunityIcons name="undo-variant" size={22} color={history.canUndo ? c.onSurface : c.border} />
        </Pressable>
        <Pressable testID="page-redo" onPress={history.redo} disabled={!history.canRedo} style={styles.iconBtn} hitSlop={6}>
          <MaterialCommunityIcons name="redo-variant" size={22} color={history.canRedo ? c.onSurface : c.border} />
        </Pressable>
        <Pressable testID="page-menu" onPress={() => setPageMenu(true)} style={styles.iconBtn} hitSlop={6}>
          <MaterialCommunityIcons name="dots-horizontal" size={22} color={c.onSurface} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + 52}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Title + icon */}
          <View style={styles.titleRow}>
            <Pressable testID="page-icon" onPress={() => setIconPicker(true)} style={styles.iconPick}>
              <Text style={styles.iconEmoji}>{icon}</Text>
            </Pressable>
          </View>
          <TextInput
            testID="page-title"
            value={title}
            onChangeText={setTitle}
            placeholder="Untitled"
            placeholderTextColor={c.muted}
            style={[styles.title, { color: c.onSurface }]}
            multiline
          />

          {/* Blocks */}
          <View style={styles.blocks}>
            {vis.length === 0 ? (
              <Pressable testID="empty-add-block" onPress={() => addBlock("text")} style={styles.emptyHint}>
                <Text style={[styles.emptyHintText, { color: c.muted }]}>
                  Tap here or the + button below to add your first block
                </Text>
              </Pressable>
            ) : (
              vis.map((b) => (
                <BlockRow
                  key={b.id}
                  block={b}
                  allBlocks={history.blocks}
                  onChangeText={onChangeText}
                  onToggleCheck={onToggleCheck}
                  onToggleCollapse={onToggleCollapse}
                  onMenu={setMenuFor}
                  onFocus={setFocusedId}
                  onImagePress={pickImageFor}
                />
              ))
            )}
          </View>

          {/* Sub-pages */}
          <View style={styles.subHeaderRow}>
            <Text style={[styles.subHeader, { color: c.muted }]}>SUB-PAGES</Text>
            <Pressable testID="add-subpage" onPress={goCreateChild} hitSlop={8} style={styles.addSubBtn}>
              <MaterialCommunityIcons name="plus" size={16} color={c.brand} />
              <Text style={[styles.addSubText, { color: c.brand }]}>New</Text>
            </Pressable>
          </View>
          {subpages.length === 0 ? (
            <Text style={[styles.noSub, { color: c.muted }]}>No sub-pages yet.</Text>
          ) : (
            subpages.map((s) => (
              <Pressable
                key={s.id}
                testID={`subpage-${s.id}`}
                onPress={() => router.push({ pathname: "/page/[id]", params: { id: s.id } })}
                style={[styles.subRow, { borderColor: c.border, backgroundColor: c.surfaceSecondary }]}
              >
                <Text style={styles.subIcon}>{s.icon}</Text>
                <Text numberOfLines={1} style={[styles.subTitle, { color: c.onSurface }]}>
                  {s.title || "Untitled"}
                </Text>
                {s.kids > 0 && (
                  <View style={[styles.kidsBadge, { backgroundColor: c.surfaceTertiary }]}>
                    <MaterialCommunityIcons name="file-tree" size={12} color={c.muted} />
                    <Text style={[styles.kidsText, { color: c.muted }]}>{s.kids}</Text>
                  </View>
                )}
                <MaterialCommunityIcons name="chevron-right" size={20} color={c.muted} />
              </Pressable>
            ))
          )}

          {/* Links & Backlinks */}
          {(outLinks.length > 0 || backlinks.length > 0) && (
            <>
              <Text style={[styles.subHeader, { color: c.muted, marginTop: 24 }]}>LINKS & BACKLINKS</Text>
              <View style={styles.chipsWrap}>
                {outLinks.map((t) => (
                  <Pressable key={`out-${t}`} testID={`link-${t}`} onPress={() => openLink(t)} style={[styles.linkChip, { backgroundColor: c.brandTertiary }]}>
                    <MaterialCommunityIcons name="link-variant" size={13} color={c.onBrandTertiary} />
                    <Text style={[styles.linkChipText, { color: c.onBrandTertiary }]}>{t}</Text>
                  </Pressable>
                ))}
              </View>
              {backlinks.map((bl) => (
                <Pressable key={`bl-${bl.id}`} testID={`backlink-${bl.id}`} onPress={() => router.push({ pathname: "/page/[id]", params: { id: bl.id } })} style={styles.backlinkRow}>
                  <MaterialCommunityIcons name="arrow-left-top" size={16} color={c.muted} />
                  <Text style={[styles.backlinkText, { color: c.onSurfaceTertiary }]}>{bl.title}</Text>
                </Pressable>
              ))}
            </>
          )}

          {/* Databases */}
          <View style={styles.subHeaderRow}>
            <Text style={[styles.subHeader, { color: c.muted }]}>DATABASES</Text>
            <Pressable testID="add-database" onPress={async () => { const db = await createDatabase(pageId, "Untitled Database"); refresh(); router.push({ pathname: "/database/[id]", params: { id: db.id } }); }} hitSlop={8} style={styles.addSubBtn}>
              <MaterialCommunityIcons name="plus" size={16} color={c.brand} />
              <Text style={[styles.addSubText, { color: c.brand }]}>New</Text>
            </Pressable>
          </View>
          {databases.length === 0 ? (
            <Text style={[styles.noSub, { color: c.muted }]}>No databases yet.</Text>
          ) : databases.map((db) => (
            <Pressable key={db.id} testID={`db-${db.id}`} onPress={() => router.push({ pathname: "/database/[id]", params: { id: db.id } })} style={[styles.subRow, { borderColor: c.border, backgroundColor: c.surfaceSecondary }]}>
              <Text style={styles.subIcon}>{db.icon}</Text>
              <Text numberOfLines={1} style={[styles.subTitle, { color: c.onSurface }]}>{db.title}</Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color={c.muted} />
            </Pressable>
          ))}

          {/* Comments */}
          <Text style={[styles.subHeader, { color: c.muted, marginTop: 24 }]}>COMMENTS</Text>
          {comments.map((cm) => (
            <View key={cm.id} style={[styles.commentRow, { borderColor: c.border, backgroundColor: c.surfaceSecondary, opacity: cm.resolved ? 0.55 : 1 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.commentText, { color: c.onSurface }, cm.resolved && { textDecorationLine: "line-through" }]}>{cm.text}</Text>
                <Text style={[styles.commentMeta, { color: c.muted }]}>{new Date(cm.createdAt).toLocaleDateString()}</Text>
              </View>
              <Pressable testID={`cmt-resolve-${cm.id}`} onPress={async () => { await updateComment(cm.id, { resolved: cm.resolved ? 0 : 1 }); setComments(await listPageComments(pageId)); }} hitSlop={6}>
                <MaterialCommunityIcons name={cm.resolved ? "restore" : "check-circle-outline"} size={18} color={cm.resolved ? c.muted : c.success} />
              </Pressable>
              <Pressable testID={`cmt-del-${cm.id}`} onPress={async () => { await deleteComment(cm.id); setComments(await listPageComments(pageId)); }} hitSlop={6}>
                <MaterialCommunityIcons name="trash-can-outline" size={16} color={c.muted} />
              </Pressable>
            </View>
          ))}
          <View style={styles.commentInputRow}>
            <TextInput testID="comment-input" value={commentText} onChangeText={setCommentText} placeholder="Add a comment" placeholderTextColor={c.muted} style={[styles.commentInput, { color: c.onSurface, borderColor: c.border }]} />
            <Pressable testID="comment-add" onPress={async () => { if (!commentText.trim()) return; await addComment("page", pageId, pageId, commentText.trim()); setCommentText(""); setComments(await listPageComments(pageId)); }} style={[styles.commentSend, { backgroundColor: c.brand }]}>
              <MaterialCommunityIcons name="send" size={18} color={c.onBrand} />
            </Pressable>
          </View>
        </ScrollView>

        {/* Link / mention autocomplete bar */}
        {trigger && suggestions.length + 1 > 0 && (
          <View style={[styles.suggestBar, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: "center", paddingHorizontal: 8 }} keyboardShouldPersistTaps="handled">
              <Text style={[styles.suggestHint, { color: c.muted }]}>{trigger.type === "link" ? "[[link]]" : "@mention"}</Text>
              {suggestions.map((s) => (
                <Pressable key={s.id} testID={`suggest-${s.id}`} onPress={() => pickSuggestion(s.title)} style={[styles.suggestChip, { backgroundColor: c.brandTertiary }]}>
                  <Text style={[styles.suggestChipText, { color: c.onBrandTertiary }]}>{s.title}</Text>
                </Pressable>
              ))}
              {trigger.query.trim().length > 0 && !suggestions.some((s) => s.title.toLowerCase() === trigger.query.trim().toLowerCase()) && (
                <Pressable testID="suggest-create" onPress={() => pickSuggestion(trigger.query.trim())} style={[styles.suggestChip, { backgroundColor: c.surfaceTertiary }]}>
                  <MaterialCommunityIcons name="plus" size={13} color={c.onSurface} />
                  <Text style={[styles.suggestChipText, { color: c.onSurface }]}>Create &quot;{trigger.query.trim()}&quot;</Text>
                </Pressable>
              )}
            </ScrollView>
          </View>
        )}

        {/* Bottom toolbar */}
        <View style={[styles.toolbar, { backgroundColor: c.surfaceSecondary, borderColor: c.border, paddingBottom: insets.bottom + 8 }]}>
          <Pressable testID="toolbar-add-text" onPress={() => addBlock("text")} style={[styles.toolBtn, { backgroundColor: c.brand }]}>
            <MaterialCommunityIcons name="plus" size={20} color={c.onBrand} />
            <Text style={[styles.toolBtnText, { color: c.onBrand }]}>Text</Text>
          </Pressable>
          <Pressable testID="toolbar-add-block" onPress={() => setAddVisible(true)} style={[styles.toolIcon, { backgroundColor: c.surfaceTertiary }]}>
            <MaterialCommunityIcons name="shape-plus" size={22} color={c.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable testID="toolbar-undo" onPress={history.undo} disabled={!history.canUndo} style={[styles.toolIcon, { backgroundColor: c.surfaceTertiary }]}>
            <MaterialCommunityIcons name="undo-variant" size={22} color={history.canUndo ? c.onSurface : c.border} />
          </Pressable>
          <Pressable testID="toolbar-redo" onPress={history.redo} disabled={!history.canRedo} style={[styles.toolIcon, { backgroundColor: c.surfaceTertiary }]}>
            <MaterialCommunityIcons name="redo-variant" size={22} color={history.canRedo ? c.onSurface : c.border} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Add block sheet */}
      <BlockTypeSheet visible={addVisible} onSelect={addBlock} onClose={() => setAddVisible(false)} />

      {/* Convert sheet */}
      <BlockTypeSheet
        visible={!!convertFor}
        title="Turn into"
        onSelect={doConvert}
        onClose={() => setConvertFor(null)}
      />

      {/* Block action menu */}
      <BottomSheet visible={!!menuFor} onClose={() => setMenuFor(null)} title="Block" testID="block-action-sheet">
        {menuBlock && (
          <View>
            <MenuItem icon="swap-horizontal" label="Turn into\u2026" onPress={() => { setMenuFor(null); setConvertFor(menuBlock.id); }} />
            <MenuItem icon="content-duplicate" label="Duplicate" onPress={() => { setBlocks(duplicateBranch(history.blocks, menuBlock.id)); setMenuFor(null); }} />
            <MenuItem icon="arrow-up" label="Move up" onPress={() => { setBlocks(moveBranch(history.blocks, menuBlock.id, -1)); setMenuFor(null); }} />
            <MenuItem icon="arrow-down" label="Move down" onPress={() => { setBlocks(moveBranch(history.blocks, menuBlock.id, 1)); setMenuFor(null); }} />
            <MenuItem icon="format-indent-increase" label="Indent" onPress={() => { setBlocks(indentBranch(history.blocks, menuBlock.id, 1)); setMenuFor(null); }} />
            <MenuItem icon="format-indent-decrease" label="Outdent" onPress={() => { setBlocks(indentBranch(history.blocks, menuBlock.id, -1)); setMenuFor(null); }} />
            <MenuItem icon="trash-can-outline" label="Delete" destructive onPress={() => { setBlocks(removeBranch(history.blocks, menuBlock.id)); setMenuFor(null); }} />
          </View>
        )}
      </BottomSheet>

      {/* Page menu */}
      <BottomSheet visible={pageMenu} onClose={() => setPageMenu(false)} title="Page options" testID="page-options-sheet">
        <MenuItem
          icon={page?.isFavorite ? "heart" : "heart-outline"}
          label={page?.isFavorite ? "Remove from favorites" : "Add to favorites"}
          onPress={() => { setPageMenu(false); toggleFavorite(); }}
        />
        <MenuItem icon="file-plus-outline" label="Add sub-page" onPress={() => { setPageMenu(false); goCreateChild(); }} />
        <MenuItem icon="content-duplicate" label="Duplicate page" onPress={onDuplicatePage} />
        <MenuItem icon="history" label="Save version" onPress={async () => { setPageMenu(false); await saveVersion({ pageId, title, icon, blocks: latestRef.current, label: "Manual save" }); toast.show("Version saved", "success"); }} />
        <MenuItem icon="clock-outline" label="Version history" onPress={() => { setPageMenu(false); router.push({ pathname: "/versions/[pageId]", params: { pageId } }); }} />
        <MenuItem icon="share-variant-outline" label="Share\u2026" onPress={() => { setPageMenu(false); router.push({ pathname: "/share", params: { title: title || "Untitled", body: `${title}\n\n${blocksToPlainText(latestRef.current)}`, kind: "page" } }); }} />
        <MenuItem icon="school-outline" label="Study & convert" onPress={() => { setPageMenu(false); router.push("/study"); }} />
        <MenuItem icon="trash-can-outline" label="Delete page" destructive onPress={() => { setPageMenu(false); setDeleteChoice(true); }} />
      </BottomSheet>

      {/* Delete choice (cascade vs reparent) */}
      <BottomSheet visible={deleteChoice} onClose={() => setDeleteChoice(false)} title="Delete page" testID="delete-choice-sheet">
        <Text style={[styles.deleteHint, { color: c.onSurfaceTertiary }]}>
          This page has sub-pages. What should happen to them?
        </Text>
        <MenuItem
          icon="trash-can-outline"
          label="Delete page and all sub-pages"
          destructive
          onPress={async () => {
            setDeleteChoice(false);
            await deletePageCascade(pageId);
            refresh();
            toast.show("Page moved to trash", "success");
            router.back();
          }}
        />
        <MenuItem
          icon="arrow-up-bold-box-outline"
          label="Delete page, keep sub-pages"
          onPress={async () => {
            setDeleteChoice(false);
            await deletePageReparent(pageId);
            refresh();
            toast.show("Page deleted, sub-pages kept", "success");
            router.back();
          }}
        />
      </BottomSheet>

      {/* Icon picker */}
      <BottomSheet visible={iconPicker} onClose={() => setIconPicker(false)} title="Choose an icon" testID="icon-picker-sheet">
        <View style={styles.emojiGrid}>
          {EMOJIS.map((e) => (
            <Pressable
              key={e}
              testID={`emoji-${e}`}
              onPress={() => { setIcon(e); setIconPicker(false); }}
              style={[styles.emojiBtn, { backgroundColor: c.surfaceTertiary }]}
            >
              <Text style={styles.emojiBig}>{e}</Text>
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  destructive,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const c = useTheme();
  const color = destructive ? c.error : c.onSurface;
  return (
    <Pressable testID={`menu-${label}`} onPress={onPress} style={styles.menuItem}>
      <MaterialCommunityIcons name={icon} size={22} color={color} />
      <Text style={[styles.menuLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", height: 52, paddingHorizontal: 4 },
  iconBtn: { width: 38, height: 40, alignItems: "center", justifyContent: "center" },
  crumbScroll: { flex: 1 },
  crumbRow: { alignItems: "center", gap: 2, paddingRight: 8 },
  crumbItem: { flexDirection: "row", alignItems: "center", maxWidth: 180 },
  crumbText: { fontSize: 13, fontWeight: "600", maxWidth: 160 },
  scroll: { paddingHorizontal: 16, paddingTop: 4 },
  titleRow: { flexDirection: "row", marginTop: 4 },
  iconPick: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  iconEmoji: { fontSize: 40 },
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -0.5, paddingVertical: 4, marginBottom: 6 },
  blocks: { marginTop: 4, minHeight: 40 },
  emptyHint: { paddingVertical: 12 },
  emptyHintText: { fontSize: 15 },
  subHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 8 },
  subHeader: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  addSubBtn: { flexDirection: "row", alignItems: "center", gap: 2 },
  addSubText: { fontSize: 13, fontWeight: "700" },
  noSub: { fontSize: 14, paddingVertical: 6 },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
  },
  subIcon: { fontSize: 20 },
  subTitle: { flex: 1, fontSize: 15, fontWeight: "600" },
  kidsBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  kidsText: { fontSize: 12, fontWeight: "700" },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toolBtn: { flexDirection: "row", alignItems: "center", gap: 6, height: 44, paddingHorizontal: 16, borderRadius: 14 },
  toolBtnText: { fontSize: 15, fontWeight: "700" },
  toolIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14 },
  menuLabel: { fontSize: 15, fontWeight: "600" },
  deleteHint: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
  emojiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingVertical: 4 },
  emojiBtn: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  emojiBig: { fontSize: 26 },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  linkChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  linkChipText: { fontSize: 13, fontWeight: "600" },
  backlinkRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 },
  backlinkText: { fontSize: 14, fontWeight: "500" },
  commentRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, marginBottom: 8 },
  commentText: { fontSize: 14 },
  commentMeta: { fontSize: 11, marginTop: 3 },
  commentInputRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  commentInput: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
  commentSend: { width: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  suggestBar: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  suggestHint: { fontSize: 12, fontWeight: "700", paddingHorizontal: 4 },
  suggestChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  suggestChipText: { fontSize: 13, fontWeight: "600" },
});
