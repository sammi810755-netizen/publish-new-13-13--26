import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp, useTheme } from "@/src/context/AppContext";
import { useToast } from "@/src/components/Toast";
import { BottomSheet } from "@/src/components/Sheet";
import { EmptyState } from "@/src/components/EmptyState";
import { Page } from "@/src/db/pages-types";
import {
  createPage,
  deletePageCascade,
  duplicatePage,
  listAllPages,
  listFavoritePages,
  listTrashedPages,
  permanentlyDeletePage,
  restorePage,
  searchPages,
  updatePage,
} from "@/src/db/pages-repo";
import { Intelligence } from "@/src/intelligence/engine";

interface TreeNode extends Page {
  children: TreeNode[];
}

function buildTree(pages: Page[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  pages.forEach((p) => byId.set(p.id, { ...p, children: [] }));
  const roots: TreeNode[] = [];
  byId.forEach((node) => {
    if (node.parentPageId && byId.has(node.parentPageId)) {
      byId.get(node.parentPageId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.orderIndex - b.orderIndex);
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

const AI_TOOLS: {
  key: string;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  route: string;
}[] = [
  { key: "ask", label: "Ask My Notes", icon: "message-question-outline", route: "/ask" },
  { key: "search", label: "Smart Search", icon: "text-search", route: "/smart-search" },
  { key: "graph", label: "Knowledge Graph", icon: "graph-outline", route: "/graph" },
  { key: "collections", label: "Collections", icon: "shape-outline", route: "/collections" },
  { key: "study", label: "Study", icon: "school-outline", route: "/study" },
  { key: "insights", label: "Insights", icon: "lightbulb-on-outline", route: "/insights" },
];

export default function WorkspaceHome() {
  const c = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { dataVersion, refresh } = useApp();

  const [pages, setPages] = useState<Page[]>([]);
  const [favorites, setFavorites] = useState<Page[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rawSearch, setRawSearch] = useState("");
  const [results, setResults] = useState<Page[] | null>(null);
  const [mode, setMode] = useState<"tree" | "trash">("tree");
  const [trashed, setTrashed] = useState<Page[]>([]);
  const [menuFor, setMenuFor] = useState<Page | null>(null);

  const load = useCallback(async () => {
    try {
      const [all, favs] = await Promise.all([listAllPages(false), listFavoritePages()]);
      setPages(all);
      setFavorites(favs);
    } catch (e) {
      console.warn("[workspace] load failed", e);
      toast.show("Couldn't load workspace", "error");
    }
  }, [toast]);

  const loadTrash = useCallback(async () => {
    try {
      setTrashed(await listTrashedPages());
    } catch {
      setTrashed([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      loadTrash();
      // keep the local intelligence index fresh (incremental, non-blocking)
      Intelligence.ensureIndex();
    }, [load, loadTrash, dataVersion]),
  );

  // ensure index once on first mount
  useEffect(() => {
    Intelligence.ensureIndex();
  }, []);

  const runSearch = useCallback(async (q: string) => {
    setRawSearch(q);
    if (!q.trim()) {
      setResults(null);
      return;
    }
    try {
      setResults(await searchPages(q));
    } catch {
      setResults([]);
    }
  }, []);

  const tree = useMemo(() => buildTree(pages), [pages]);
  const pathOf = useCallback(
    (p: Page): string => {
      const map = new Map(pages.map((x) => [x.id, x]));
      const parts: string[] = [];
      let cur: Page | undefined = p;
      let guard = 0;
      while (cur && guard < 50) {
        parts.unshift(cur.title || "Untitled");
        cur = cur.parentPageId ? map.get(cur.parentPageId) : undefined;
        guard += 1;
      }
      return parts.join("  /  ");
    },
    [pages],
  );

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const newRootPage = async () => {
    try {
      const p = await createPage(null, {});
      refresh();
      router.push({ pathname: "/page/[id]", params: { id: p.id } });
    } catch {
      toast.show("Couldn't create page", "error");
    }
  };

  const addChild = async (parentId: string) => {
    setMenuFor(null);
    try {
      const p = await createPage(parentId, {});
      refresh();
      router.push({ pathname: "/page/[id]", params: { id: p.id } });
    } catch {
      toast.show("Couldn't create sub-page", "error");
    }
  };

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const hasKids = node.children.length > 0;
    const isOpen = expanded.has(node.id);
    return (
      <View key={node.id}>
        <View style={[styles.nodeRow, { paddingLeft: 8 + depth * 18 }]}>
          <Pressable
            testID={`expand-${node.id}`}
            onPress={() => hasKids && toggleExpand(node.id)}
            hitSlop={8}
            style={styles.chevron}
          >
            {hasKids ? (
              <MaterialCommunityIcons name={isOpen ? "chevron-down" : "chevron-right"} size={20} color={c.muted} />
            ) : (
              <View style={{ width: 20 }} />
            )}
          </Pressable>
          <Pressable
            testID={`page-row-${node.id}`}
            onPress={() => router.push({ pathname: "/page/[id]", params: { id: node.id } })}
            style={styles.nodeMain}
          >
            <Text style={styles.nodeIcon}>{node.icon}</Text>
            <Text numberOfLines={1} style={[styles.nodeTitle, { color: c.onSurface }]}>
              {node.title || "Untitled"}
            </Text>
            {node.isFavorite ? (
              <MaterialCommunityIcons name="heart" size={13} color={c.brand} />
            ) : null}
          </Pressable>
          <Pressable testID={`node-menu-${node.id}`} onPress={() => setMenuFor(node)} hitSlop={8} style={styles.nodeMenu}>
            <MaterialCommunityIcons name="dots-horizontal" size={18} color={c.muted} />
          </Pressable>
        </View>
        {hasKids && isOpen && node.children.map((ch) => renderNode(ch, depth + 1))}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface, paddingTop: insets.top }}>
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <View style={[styles.logo, { backgroundColor: c.brand }]}>
            <MaterialCommunityIcons name="file-tree" size={18} color={c.onBrand} />
          </View>
          <Text style={[styles.heading, { color: c.onSurface }]}>Workspace</Text>
        </View>
        <View style={styles.topActions}>
          <Pressable testID="open-notes" onPress={() => router.push("/notes")} style={styles.iconBtn} hitSlop={6}>
            <MaterialCommunityIcons name="notebook-outline" size={22} color={c.onSurface} />
          </Pressable>
          <Pressable testID="workspace-templates" onPress={() => router.push("/templates")} style={styles.iconBtn} hitSlop={6}>
            <MaterialCommunityIcons name="shape-outline" size={22} color={c.onSurface} />
          </Pressable>
          <Pressable testID="workspace-calendar" onPress={() => router.push("/calendar")} style={styles.iconBtn} hitSlop={6}>
            <MaterialCommunityIcons name="calendar-month-outline" size={22} color={c.onSurface} />
          </Pressable>
          <Pressable
            testID="workspace-trash"
            onPress={() => setMode((m) => (m === "trash" ? "tree" : "trash"))}
            style={styles.iconBtn}
            hitSlop={6}
          >
            <MaterialCommunityIcons name="trash-can-outline" size={22} color={mode === "trash" ? c.brand : c.onSurface} />
          </Pressable>
          <Pressable testID="open-settings" onPress={() => router.push("/settings")} style={styles.iconBtn} hitSlop={6}>
            <MaterialCommunityIcons name="cog-outline" size={22} color={c.onSurface} />
          </Pressable>
        </View>
      </View>

      {mode === "tree" && (
        <View style={styles.searchWrap}>
          <View style={[styles.searchBar, { backgroundColor: c.surfaceTertiary, borderColor: c.border }]}>
            <MaterialCommunityIcons name="magnify" size={20} color={c.muted} />
            <TextInput
              testID="workspace-search"
              value={rawSearch}
              onChangeText={runSearch}
              placeholder="Search pages"
              placeholderTextColor={c.muted}
              style={[styles.searchInput, { color: c.onSurface }]}
            />
            {rawSearch.length > 0 && (
              <Pressable testID="clear-search" onPress={() => runSearch("")}>
                <MaterialCommunityIcons name="close-circle" size={18} color={c.muted} />
              </Pressable>
            )}
          </View>
        </View>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {mode === "tree" && results === null && (
          <View style={styles.aiWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.aiRow}>
              {AI_TOOLS.map((t) => (
                <Pressable
                  key={t.key}
                  testID={`ai-${t.key}`}
                  onPress={() => router.push(t.route as any)}
                  style={[styles.aiCard, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}
                >
                  <MaterialCommunityIcons name={t.icon} size={20} color={c.brand} />
                  <Text style={[styles.aiLabel, { color: c.brand }]}>{t.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {mode === "trash" ? (
          trashed.length === 0 ? (
            <EmptyState icon="trash-can-outline" title="Trash is empty" subtitle="Deleted pages appear here." testID="empty-page-trash" />
          ) : (
            trashed.map((p) => (
              <View key={p.id} style={[styles.trashRow, { borderColor: c.border, backgroundColor: c.surfaceSecondary }]}>
                <Text style={styles.nodeIcon}>{p.icon}</Text>
                <Text numberOfLines={1} style={[styles.nodeTitle, { color: c.onSurface }]}>{p.title || "Untitled"}</Text>
                <Pressable
                  testID={`restore-${p.id}`}
                  onPress={async () => { await restorePage(p.id); refresh(); loadTrash(); toast.show("Page restored", "success"); }}
                  style={styles.trashAction}
                >
                  <MaterialCommunityIcons name="restore" size={20} color={c.onSurface} />
                </Pressable>
                <Pressable
                  testID={`purge-${p.id}`}
                  onPress={async () => { await permanentlyDeletePage(p.id); refresh(); loadTrash(); toast.show("Deleted forever", "success"); }}
                  style={styles.trashAction}
                >
                  <MaterialCommunityIcons name="delete-forever-outline" size={20} color={c.error} />
                </Pressable>
              </View>
            ))
          )
        ) : results !== null ? (
          results.length === 0 ? (
            <EmptyState icon="magnify" title="No pages found" subtitle="Try a different search." testID="empty-page-search" />
          ) : (
            results.map((p) => (
              <Pressable
                key={p.id}
                testID={`result-${p.id}`}
                onPress={() => router.push({ pathname: "/page/[id]", params: { id: p.id } })}
                style={[styles.resultRow, { borderColor: c.border, backgroundColor: c.surfaceSecondary }]}
              >
                <Text style={styles.nodeIcon}>{p.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={[styles.nodeTitle, { color: c.onSurface }]}>{p.title || "Untitled"}</Text>
                  <Text numberOfLines={1} style={[styles.resultPath, { color: c.muted }]}>{pathOf(p)}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={c.muted} />
              </Pressable>
            ))
          )
        ) : pages.length === 0 ? (
          <EmptyState icon="file-tree" title="No pages yet" subtitle="Tap + to create your first page." testID="empty-workspace" />
        ) : (
          <>
            <Pressable testID="workspace-attachments" onPress={() => router.push("/attachments")} style={[styles.favRow, { marginBottom: 4 }]}>
              <MaterialCommunityIcons name="paperclip" size={16} color={c.brand} />
              <Text style={[styles.nodeTitle, { color: c.onSurface }]}>Attachment Manager</Text>
              <MaterialCommunityIcons name="chevron-right" size={18} color={c.muted} />
            </Pressable>
            {favorites.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: c.muted }]}>FAVORITES</Text>
                {favorites.map((p) => (
                  <Pressable
                    key={p.id}
                    testID={`fav-${p.id}`}
                    onPress={() => router.push({ pathname: "/page/[id]", params: { id: p.id } })}
                    style={styles.favRow}
                  >
                    <MaterialCommunityIcons name="heart" size={14} color={c.brand} />
                    <Text style={styles.nodeIcon}>{p.icon}</Text>
                    <Text numberOfLines={1} style={[styles.nodeTitle, { color: c.onSurface }]}>{p.title || "Untitled"}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Text style={[styles.sectionTitle, { color: c.muted, marginLeft: 8 }]}>ALL PAGES</Text>
            {tree.map((node) => renderNode(node, 0))}
          </>
        )}
      </ScrollView>

      {mode === "tree" && (
        <Pressable testID="workspace-new" onPress={newRootPage} style={[styles.fab, { backgroundColor: c.brand, bottom: insets.bottom + 24 }]}>
          <MaterialCommunityIcons name="plus" size={28} color={c.onBrand} />
        </Pressable>
      )}

      {/* per-node menu */}
      <BottomSheet visible={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor?.title || "Page"} testID="node-menu-sheet">
        {menuFor && (
          <View>
            <MItem icon="file-plus-outline" label="Add sub-page" onPress={() => addChild(menuFor.id)} />
            <MItem
              icon={menuFor.isFavorite ? "heart" : "heart-outline"}
              label={menuFor.isFavorite ? "Remove favorite" : "Add to favorites"}
              onPress={async () => { await updatePage(menuFor.id, { isFavorite: menuFor.isFavorite ? 0 : 1 }); setMenuFor(null); refresh(); }}
            />
            <MItem
              icon="content-duplicate"
              label="Duplicate"
              onPress={async () => { await duplicatePage(menuFor.id); setMenuFor(null); refresh(); toast.show("Page duplicated", "success"); }}
            />
            <MItem
              icon="trash-can-outline"
              label="Delete"
              destructive
              onPress={async () => { await deletePageCascade(menuFor.id); setMenuFor(null); refresh(); loadTrash(); toast.show("Moved to trash", "success"); }}
            />
          </View>
        )}
      </BottomSheet>
    </View>
  );
}

function MItem({
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
    <Pressable testID={`nodemenu-${label}`} onPress={onPress} style={styles.menuItem}>
      <MaterialCommunityIcons name={icon} size={22} color={color} />
      <Text style={[styles.menuLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 56, paddingHorizontal: 12 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  iconBtn: { width: 38, height: 40, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 21, fontWeight: "800", letterSpacing: -0.5 },
  topActions: { flexDirection: "row", alignItems: "center" },
  searchWrap: { paddingHorizontal: 16, paddingBottom: 10 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 46,
    borderRadius: 999,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15 },
  scroll: { paddingHorizontal: 12, paddingTop: 4 },
  aiWrap: { marginBottom: 12 },
  aiRow: { gap: 10, paddingHorizontal: 4, paddingVertical: 2 },
  aiCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  aiLabel: { fontSize: 13.5, fontWeight: "700" },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, marginBottom: 6 },
  favRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, paddingHorizontal: 8 },
  nodeRow: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  chevron: { width: 26, height: 40, alignItems: "center", justifyContent: "center" },
  nodeMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  nodeIcon: { fontSize: 18 },
  nodeTitle: { flex: 1, fontSize: 15, fontWeight: "600" },
  nodeMenu: { width: 36, height: 40, alignItems: "center", justifyContent: "center" },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  resultPath: { fontSize: 12, marginTop: 2 },
  trashRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  trashAction: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14 },
  menuLabel: { fontSize: 15, fontWeight: "600" },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
