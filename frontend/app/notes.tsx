import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
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
import { NotesGrid } from "@/src/components/NotesGrid";
import { EmptyState } from "@/src/components/EmptyState";
import { CreateFab, CreateType } from "@/src/components/CreateFab";
import { SortSheet, FolderPickerSheet } from "@/src/components/Pickers";
import { BottomSheet, ConfirmSheet } from "@/src/components/Sheet";
import {
  emptyTrash,
  getNote,
  listNotes,
  permanentlyDeleteNote,
  restoreNote,
  trashNote,
  updateNote,
} from "@/src/db/repo";
import { FilterKey, NoteListItem } from "@/src/db/types";
import { exportNotes, ExportFormat } from "@/src/lib/exporter";

const FILTERS: { key: FilterKey; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { key: "all", label: "All", icon: "note-multiple-outline" },
  { key: "favorites", label: "Favorites", icon: "heart-outline" },
  { key: "pinned", label: "Pinned", icon: "pin-outline" },
  { key: "archived", label: "Archive", icon: "archive-outline" },
  { key: "trash", label: "Trash", icon: "trash-can-outline" },
];

function ActionButton({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable testID={`action-${label.toLowerCase()}`} onPress={onPress} style={styles.actionBtn}>
      <MaterialCommunityIcons name={icon} size={22} color={color} />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

export default function Home() {
  const c = useTheme();
  const { settings, setSetting, dataVersion, refresh } = useApp();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();

  const [filter, setFilter] = useState<FilterKey>("all");
  const [rawSearch, setRawSearch] = useState("");
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [sortVisible, setSortVisible] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveVisible, setMoveVisible] = useState(false);
  const [exportVisible, setExportVisible] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(rawSearch), 250);
    return () => clearTimeout(t);
  }, [rawSearch]);

  const load = useCallback(async () => {
    try {
      const rows = await listNotes({ filter, search, sort: settings.sort });
      setNotes(rows);
    } catch (e) {
      console.warn("[Home] failed to load notes", e);
      setNotes([]);
      toast.show("Couldn't load notes. Pull down to retry.", "error");
    }
  }, [filter, search, settings.sort, toast]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load, dataVersion]),
  );

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) setSelectMode(false);
      return next;
    });
  };

  const onPressNote = (n: NoteListItem) => {
    if (selectMode) {
      toggleSelect(n.id);
      return;
    }
    if (filter === "trash") {
      setSelectMode(true);
      setSelected(new Set([n.id]));
      return;
    }
    router.push({ pathname: "/editor", params: { id: n.id } });
  };

  const onLongPressNote = (n: NoteListItem) => {
    setSelectMode(true);
    toggleSelect(n.id);
  };

  const onCreate = (t: CreateType) => {
    router.push({ pathname: "/editor", params: { type: t, action: t } });
  };

  const doBulk = async (fn: (id: string) => Promise<void>, msg: string) => {
    const ids = Array.from(selected);
    for (const id of ids) await fn(id);
    exitSelect();
    refresh();
    toast.show(msg, "success");
  };

  const bulkExport = async (format: ExportFormat) => {
    setExportVisible(false);
    try {
      const list = [];
      for (const id of Array.from(selected)) {
        const n = await getNote(id);
        if (n) list.push(n);
      }
      if (list.length === 0) return;
      await exportNotes(list, format);
      exitSelect();
    } catch {
      toast.show("Export failed", "error");
    }
  };

  const emptyContent = useMemo(() => {
    if (search.trim())
      return <EmptyState icon="magnify" title="No notes found" subtitle="Try a different search." testID="empty-search" />;
    switch (filter) {
      case "favorites":
        return <EmptyState icon="heart-outline" title="No favorite notes" subtitle="Tap the heart on a note to favorite it." testID="empty-fav" />;
      case "pinned":
        return <EmptyState icon="pin-outline" title="No pinned notes" subtitle="Pin important notes to keep them on top." testID="empty-pin" />;
      case "archived":
        return <EmptyState icon="archive-outline" title="No archived notes" subtitle="Archive notes to find them here." testID="empty-archive" />;
      case "trash":
        return <EmptyState icon="trash-can-outline" title="Trash is empty" subtitle="Deleted notes appear here for 30 days." testID="empty-trash" />;
      default:
        return <EmptyState icon="notebook-outline" title="No notes yet" subtitle="Tap + to create your first note." testID="empty-all" />;
    }
  }, [filter, search]);

  return (
    <View style={{ flex: 1, backgroundColor: c.surface, paddingTop: insets.top }}>
      <View style={styles.topBar}>
        {selectMode ? (
          <>
            <Pressable testID="select-close" onPress={exitSelect} style={styles.iconBtn}>
              <MaterialCommunityIcons name="close" size={24} color={c.onSurface} />
            </Pressable>
            <Text style={[styles.selectCount, { color: c.onSurface }]}>{selected.size} selected</Text>
            <View style={{ width: 40 }} />
          </>
        ) : (
          <>
            <View style={styles.brandRow}>
              <Pressable testID="notes-back" onPress={() => router.replace("/")} style={styles.iconBtn} hitSlop={8}>
                <MaterialCommunityIcons name="chevron-left" size={26} color={c.onSurface} />
              </Pressable>
              <View style={[styles.logo, { backgroundColor: c.brand }]}>
                <MaterialCommunityIcons name="notebook" size={20} color={c.onBrand} />
              </View>
              <Text style={[styles.brandText, { color: c.onSurface }]}>Notes</Text>
            </View>
            <View style={styles.topActions}>
              <Pressable
                testID="checklist-shortcut"
                onPress={() => router.push({ pathname: "/editor", params: { type: "checklist", action: "checklist" } })}
                style={styles.iconBtn}
              >
                <MaterialCommunityIcons name="checkbox-marked-outline" size={22} color={c.onSurface} />
              </Pressable>
              <Pressable testID="open-settings" onPress={() => router.push("/settings")} style={styles.iconBtn}>
                <MaterialCommunityIcons name="cog-outline" size={22} color={c.onSurface} />
              </Pressable>
            </View>
          </>
        )}
      </View>

      {!selectMode && (
        <View style={styles.searchWrap}>
          <View style={[styles.searchBar, { backgroundColor: c.surfaceTertiary, borderColor: c.border }]}>
            <MaterialCommunityIcons name="magnify" size={20} color={c.muted} />
            <TextInput
              testID="search-input"
              value={rawSearch}
              onChangeText={setRawSearch}
              placeholder="Search notes"
              placeholderTextColor={c.muted}
              style={[styles.searchInput, { color: c.onSurface }]}
              returnKeyType="search"
            />
            {rawSearch.length > 0 ? (
              <Pressable testID="clear-search" onPress={() => setRawSearch("")}>
                <MaterialCommunityIcons name="close-circle" size={18} color={c.muted} />
              </Pressable>
            ) : null}
          </View>
          <Pressable testID="open-sort" onPress={() => setSortVisible(true)} style={[styles.sortBtn, { backgroundColor: c.surfaceTertiary, borderColor: c.border }]}>
            <MaterialCommunityIcons name="sort" size={20} color={c.onSurface} />
          </Pressable>
        </View>
      )}

      {!selectMode && (
        <View style={styles.chipRowWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <Pressable
                  key={f.key}
                  testID={`filter-${f.key}`}
                  onPress={() => setFilter(f.key)}
                  style={[
                    styles.chip,
                    { backgroundColor: active ? c.brandTertiary : c.surfaceSecondary, borderColor: active ? c.brand : c.border },
                  ]}
                >
                  <MaterialCommunityIcons name={f.icon} size={15} color={active ? c.brand : c.onSurfaceTertiary} />
                  <Text style={[styles.chipText, { color: active ? c.brand : c.onSurfaceTertiary }]}>{f.label}</Text>
                </Pressable>
              );
            })}
            <View style={[styles.chipDivider, { backgroundColor: c.border }]} />
            <Pressable testID="filter-pages" onPress={() => router.replace("/")} style={[styles.chip, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
              <MaterialCommunityIcons name="file-tree" size={15} color={c.brand} />
              <Text style={[styles.chipText, { color: c.brand }]}>Pages</Text>
            </Pressable>
            <Pressable testID="filter-folders" onPress={() => router.push("/folders")} style={[styles.chip, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <MaterialCommunityIcons name="folder-outline" size={15} color={c.onSurfaceTertiary} />
              <Text style={[styles.chipText, { color: c.onSurfaceTertiary }]}>Folders</Text>
            </Pressable>
            <Pressable testID="filter-labels" onPress={() => router.push("/labels")} style={[styles.chip, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
              <MaterialCommunityIcons name="tag-outline" size={15} color={c.onSurfaceTertiary} />
              <Text style={[styles.chipText, { color: c.onSurfaceTertiary }]}>Labels</Text>
            </Pressable>
          </ScrollView>
        </View>
      )}

      {filter === "trash" && notes.length > 0 && !selectMode ? (
        <Pressable testID="empty-trash-button" onPress={() => setConfirmEmpty(true)} style={styles.emptyTrashBtn}>
          <MaterialCommunityIcons name="delete-sweep-outline" size={18} color={c.error} />
          <Text style={[styles.emptyTrashText, { color: c.error }]}>Empty Trash</Text>
        </Pressable>
      ) : null}

      {notes.length === 0 ? (
        emptyContent
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.brand} />}
        >
          <NotesGrid
            notes={notes}
            layout={settings.layout}
            showPreview={settings.showPreviews}
            onPressNote={onPressNote}
            onLongPressNote={onLongPressNote}
            selectedIds={selected}
          />
        </ScrollView>
      )}

      {!selectMode && <CreateFab onSelect={onCreate} />}

      {selectMode && (
        <View style={[styles.actionBar, { backgroundColor: c.surfaceSecondary, borderColor: c.border, paddingBottom: insets.bottom + 10 }]}>
          {filter === "trash" ? (
            <>
              <ActionButton icon="restore" label="Restore" color={c.onSurface} onPress={() => doBulk(restoreNote, "Notes restored")} />
              <ActionButton icon="delete-forever-outline" label="Delete" color={c.error} onPress={() => setConfirmDelete(true)} />
            </>
          ) : (
            <>
              <ActionButton icon="folder-move-outline" label="Move" color={c.onSurface} onPress={() => setMoveVisible(true)} />
              {filter === "archived" ? (
                <ActionButton icon="archive-arrow-up-outline" label="Unarchive" color={c.onSurface} onPress={() => doBulk((id) => updateNote(id, { isArchived: 0 }), "Notes unarchived")} />
              ) : (
                <ActionButton icon="archive-arrow-down-outline" label="Archive" color={c.onSurface} onPress={() => doBulk((id) => updateNote(id, { isArchived: 1 }), "Notes archived")} />
              )}
              <ActionButton icon="export-variant" label="Export" color={c.onSurface} onPress={() => setExportVisible(true)} />
              <ActionButton icon="trash-can-outline" label="Delete" color={c.error} onPress={() => doBulk(trashNote, "Moved to trash")} />
            </>
          )}
        </View>
      )}

      <SortSheet visible={sortVisible} current={settings.sort} onSelect={(s) => setSetting("sort", s)} onClose={() => setSortVisible(false)} />

      <FolderPickerSheet
        visible={moveVisible}
        currentFolderId={null}
        onSelect={(fid) => doBulk((id) => updateNote(id, { folderId: fid }), "Notes moved")}
        onClose={() => setMoveVisible(false)}
      />

      <BottomSheet visible={exportVisible} onClose={() => setExportVisible(false)} title="Export as" testID="export-sheet">
        {(["txt", "md", "pdf"] as ExportFormat[]).map((fmt) => (
          <Pressable key={fmt} testID={`export-${fmt}`} onPress={() => bulkExport(fmt)} style={styles.exportRow}>
            <MaterialCommunityIcons
              name={fmt === "pdf" ? "file-pdf-box" : fmt === "md" ? "language-markdown" : "file-document-outline"}
              size={22}
              color={c.brand}
            />
            <Text style={[styles.exportText, { color: c.onSurface }]}>{fmt.toUpperCase()}</Text>
          </Pressable>
        ))}
      </BottomSheet>

      <ConfirmSheet
        visible={confirmEmpty}
        title="Empty Trash?"
        message="All notes in Trash will be permanently deleted. This cannot be undone."
        confirmLabel="Empty Trash"
        destructive
        onCancel={() => setConfirmEmpty(false)}
        onConfirm={async () => {
          setConfirmEmpty(false);
          await emptyTrash();
          refresh();
          toast.show("Trash emptied", "success");
        }}
      />

      <ConfirmSheet
        visible={confirmDelete}
        title="Delete forever?"
        message={`${selected.size} note(s) will be permanently deleted.`}
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false);
          await doBulk(permanentlyDeleteNote, "Deleted permanently");
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    height: 56,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  brandText: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  topActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  selectCount: { fontSize: 17, fontWeight: "700" },
  searchWrap: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 48,
    borderRadius: 999,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15 },
  sortBtn: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  chipRowWrap: { height: 56, justifyContent: "center" },
  chipRow: { paddingHorizontal: 16, gap: 8, alignItems: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  chipText: { fontSize: 13, fontWeight: "600" },
  chipDivider: { width: StyleSheet.hairlineWidth, height: 24, marginHorizontal: 4 },
  emptyTrashBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-end", paddingHorizontal: 20, paddingVertical: 8 },
  emptyTrashText: { fontSize: 13, fontWeight: "700" },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8 },
  actionBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: { alignItems: "center", gap: 4, paddingHorizontal: 8 },
  actionLabel: { fontSize: 11, fontWeight: "600" },
  exportRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15 },
  exportText: { fontSize: 15, fontWeight: "600" },
});
