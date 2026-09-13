import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp, useTheme } from "@/src/context/AppContext";
import { useToast } from "@/src/components/Toast";
import { Intelligence } from "@/src/intelligence/engine";
import type { IDoc } from "@/src/intelligence/corpus";
import type { DetectedTask, DuplicateGroup } from "@/src/intelligence/relations";
import type { RewriteStyle } from "@/src/intelligence/text-ops";
import { applyTagToNote, createTasksFromDetected } from "@/src/intelligence/apply";

type Tab = "tasks" | "duplicates" | "tags" | "tools";
const TABS: { key: Tab; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { key: "tasks", label: "Tasks", icon: "checkbox-marked-circle-outline" },
  { key: "duplicates", label: "Duplicates", icon: "content-copy" },
  { key: "tags", label: "Smart Tags", icon: "tag-multiple-outline" },
  { key: "tools", label: "Writing", icon: "pencil-outline" },
];
const STYLES: { key: RewriteStyle; label: string }[] = [
  { key: "fix", label: "Fix grammar" },
  { key: "shorten", label: "Shorten" },
  { key: "expand", label: "Expand" },
  { key: "formal", label: "Formal" },
  { key: "simple", label: "Simple" },
  { key: "bullets", label: "To bullets" },
  { key: "headings", label: "Add heading" },
];

export default function InsightsScreen() {
  const c = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { refresh } = useApp();

  const [tab, setTab] = useState<Tab>("tasks");
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<DetectedTask[]>([]);
  const [dups, setDups] = useState<DuplicateGroup[]>([]);
  const [noteDocs, setNoteDocs] = useState<IDoc[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [t, d, index] = await Promise.all([Intelligence.allTasks(), Intelligence.duplicates(0.82), Intelligence.ensureIndex()]);
    setTasks(t);
    setDups(d);
    setNoteDocs(index ? Object.values(index.docs).filter((x) => x.kind === "note" && (x.text || "").length > 15).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 20) : []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: c.surface, paddingTop: insets.top }}>
      <View style={styles.top}>
        <Pressable testID="insights-back" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={c.onSurface} />
        </Pressable>
        <Text style={[styles.title, { color: c.onSurface }]}>Insights</Text>
        <Pressable testID="insights-refresh" onPress={load} style={styles.iconBtn} hitSlop={8}>
          <MaterialCommunityIcons name="refresh" size={22} color={c.onSurface} />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 50, flexGrow: 0 }} contentContainerStyle={styles.tabRow}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable key={t.key} testID={`tab-${t.key}`} onPress={() => setTab(t.key)}
              style={[styles.tab, { backgroundColor: active ? c.brand : c.surfaceSecondary, borderColor: active ? c.brand : c.border }]}>
              <MaterialCommunityIcons name={t.icon} size={15} color={active ? c.onBrand : c.onSurfaceTertiary} />
              <Text style={[styles.tabText, { color: active ? c.onBrand : c.onSurfaceTertiary }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={c.brand} /></View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          {tab === "tasks" && <TasksTab tasks={tasks} c={c} toast={toast} refresh={refresh} reload={load} />}
          {tab === "duplicates" && <DuplicatesTab dups={dups} c={c} router={router} />}
          {tab === "tags" && <TagsTab docs={noteDocs} c={c} toast={toast} refresh={refresh} />}
          {tab === "tools" && <ToolsTab c={c} toast={toast} />}
        </ScrollView>
      )}
    </View>
  );
}

function TasksTab({ tasks, c, toast, refresh, reload }: any) {
  const [creating, setCreating] = useState(false);
  if (!tasks.length) return <Empty icon="checkbox-marked-circle-outline" text="No tasks detected in your notes." c={c} />;
  const createAll = async () => {
    setCreating(true);
    const n = await createTasksFromDetected(tasks);
    toast.show(`${n} task(s) added to Calendar`, "success");
    refresh();
    setCreating(false);
    reload();
  };
  return (
    <>
      <View style={styles.headerRow}>
        <Text style={[styles.info, { color: c.muted }]}>{tasks.length} task(s) detected from your notes. Nothing is created until you confirm.</Text>
      </View>
      <Pressable testID="create-all-tasks" onPress={createAll} disabled={creating} style={[styles.primaryBtn, { backgroundColor: c.brand }]}>
        <MaterialCommunityIcons name="plus" size={18} color={c.onBrand} />
        <Text style={[styles.primaryText, { color: c.onBrand }]}>{creating ? "Adding…" : "Add all as tasks"}</Text>
      </Pressable>
      {tasks.map((t: DetectedTask, i: number) => (
        <View key={i} style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Text style={[styles.cardTitle, { color: c.onSurface }]}>{t.task}</Text>
          <View style={styles.chipsRow}>
            <Pill text={t.priority} c={c} />
            {t.date && <Pill text={t.date.label} c={c} icon="calendar" />}
            {t.time && <Pill text={t.time} c={c} icon="clock-outline" />}
          </View>
          <Text numberOfLines={1} style={[styles.src, { color: c.muted }]}>{t.source}</Text>
        </View>
      ))}
    </>
  );
}

function DuplicatesTab({ dups, c, router }: any) {
  if (!dups.length) return <Empty icon="content-copy" text="No duplicate or near-duplicate items found." c={c} />;
  return (
    <>
      <Text style={[styles.info, { color: c.muted }]}>Review suggestions below. Nothing is deleted automatically.</Text>
      {dups.map((g: DuplicateGroup, i: number) => (
        <View key={i} style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={styles.chipsRow}>
            <Pill text={g.kind === "exact" ? "Exact" : "Near"} c={c} />
            <Pill text={`${Math.round(g.similarity * 100)}% similar`} c={c} />
          </View>
          {g.docs.map((d: IDoc) => (
            <Pressable key={d.id} testID={`dup-${d.id}`} onPress={() => d.route && router.push(d.route)} style={styles.dupRow}>
              <MaterialCommunityIcons name="file-outline" size={16} color={c.muted} />
              <Text numberOfLines={1} style={[styles.dupTitle, { color: c.onSurface }]}>{d.title || "Untitled"}</Text>
              <MaterialCommunityIcons name="chevron-right" size={16} color={c.muted} />
            </Pressable>
          ))}
        </View>
      ))}
    </>
  );
}

function TagsTab({ docs, c, toast, refresh }: any) {
  const [applied, setApplied] = useState<Set<string>>(new Set());
  if (!docs.length) return <Empty icon="tag-multiple-outline" text="Add some text notes to get tag suggestions." c={c} />;
  const apply = async (noteId: string, tag: string) => {
    const key = `${noteId}:${tag}`;
    try {
      await applyTagToNote(noteId, tag);
      setApplied((p) => new Set(p).add(key));
      toast.show(`Tagged “${tag}”`, "success");
      refresh();
    } catch {
      toast.show("Couldn't apply tag", "error");
    }
  };
  return (
    <>
      <Text style={[styles.info, { color: c.muted }]}>Suggested tags &amp; categories. Tap a tag to add it (your existing tags are kept).</Text>
      {docs.map((d: IDoc) => {
        const tags = Intelligence.tags(d.text, d.title, d.tags);
        const cats = Intelligence.categories(d.text, d.title);
        if (!tags.length && !cats.length) return null;
        return (
          <View key={d.id} style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <Text numberOfLines={1} style={[styles.cardTitle, { color: c.onSurface }]}>{d.title || "Untitled"}</Text>
            {cats.length > 0 && (
              <Text style={[styles.catLine, { color: c.muted }]}>Category: {cats.map((x: any) => x.category).join(", ")}</Text>
            )}
            <View style={styles.chipsRow}>
              {tags.map((t: any) => {
                const key = `${d.refId}:${t.tag}`;
                const done = applied.has(key);
                return (
                  <Pressable key={t.tag} testID={`tag-${d.refId}-${t.tag}`} onPress={() => !done && apply(d.refId, t.tag)}
                    style={[styles.tagChip, { backgroundColor: done ? c.brand : c.brandTertiary, borderColor: c.brand }]}>
                    <MaterialCommunityIcons name={done ? "check" : "plus"} size={12} color={done ? c.onBrand : c.brand} />
                    <Text style={[styles.tagText, { color: done ? c.onBrand : c.brand }]}>{t.tag}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
    </>
  );
}

function ToolsTab({ c, toast }: any) {
  const [text, setText] = useState("");
  const [out, setOut] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const doRewrite = (style: RewriteStyle) => {
    if (!text.trim()) { toast.show("Type some text first", "error"); return; }
    const r = Intelligence.rewrite(text, style);
    setOut(r.text);
    setNote(r.changed ? r.note : "No safe rewrite was found.");
  };
  const doSummary = () => {
    if (!text.trim()) { toast.show("Type some text first", "error"); return; }
    const s = Intelligence.summarize(text, 3);
    setOut(s.summary || "(nothing to summarize)");
    setNote(`Extractive summary • ${Math.round(s.confidence * 100)}% confidence`);
  };
  const lang = text.trim() ? Intelligence.language(text) : null;
  const kws = text.trim() ? Intelligence.keywords(text, 6) : [];
  return (
    <>
      <Text style={[styles.info, { color: c.muted }]}>Deterministic, offline writing tools. Paste any text.</Text>
      <TextInput
        testID="tools-input"
        value={text}
        onChangeText={setText}
        multiline
        placeholder="Type or paste text here…"
        placeholderTextColor={c.muted}
        style={[styles.textArea, { backgroundColor: c.surfaceSecondary, color: c.onSurface, borderColor: c.border }]}
      />
      {lang && (
        <View style={styles.chipsRow}>
          <Pill text={`${lang.name} (${Math.round(lang.confidence * 100)}%)`} c={c} icon="translate" />
          {kws.slice(0, 4).map((k: any) => <Pill key={k.term} text={k.term} c={c} />)}
        </View>
      )}
      <View style={styles.chipsRow}>
        {STYLES.map((s) => (
          <Pressable key={s.key} testID={`rewrite-${s.key}`} onPress={() => doRewrite(s.key)}
            style={[styles.toolChip, { backgroundColor: c.surfaceTertiary, borderColor: c.border }]}>
            <Text style={[styles.toolChipText, { color: c.onSurface }]}>{s.label}</Text>
          </Pressable>
        ))}
        <Pressable testID="rewrite-summary" onPress={doSummary} style={[styles.toolChip, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
          <Text style={[styles.toolChipText, { color: c.brand }]}>Summarize</Text>
        </Pressable>
      </View>
      {!!out && (
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Text style={[styles.resultText, { color: c.onSurface }]} selectable>{out}</Text>
          {!!note && <Text style={[styles.resultNote, { color: c.muted }]}>{note}</Text>}
        </View>
      )}
    </>
  );
}

function Pill({ text, c, icon }: { text: string; c: any; icon?: keyof typeof MaterialCommunityIcons.glyphMap }) {
  return (
    <View style={[styles.pill, { backgroundColor: c.surfaceTertiary }]}>
      {icon && <MaterialCommunityIcons name={icon} size={12} color={c.muted} />}
      <Text style={[styles.pillText, { color: c.muted }]}>{text}</Text>
    </View>
  );
}
function Empty({ icon, text, c }: any) {
  return (
    <View style={styles.emptyBox}>
      <MaterialCommunityIcons name={icon} size={44} color={c.muted} />
      <Text style={[styles.emptyText, { color: c.muted }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 8 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  tabRow: { paddingHorizontal: 16, gap: 8, alignItems: "center", paddingVertical: 8 },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  tabText: { fontSize: 13, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerRow: { marginBottom: 12 },
  info: { fontSize: 12.5, lineHeight: 18, marginBottom: 12 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 14, marginBottom: 14 },
  primaryText: { fontSize: 15, fontWeight: "700" },
  card: { padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, marginBottom: 10 },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  src: { fontSize: 11, marginTop: 8 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: "600" },
  dupRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "transparent" },
  dupTitle: { flex: 1, fontSize: 14, fontWeight: "500" },
  catLine: { fontSize: 12, marginTop: 6 },
  tagChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  tagText: { fontSize: 12.5, fontWeight: "700" },
  textArea: { minHeight: 120, borderRadius: 14, padding: 14, fontSize: 15, lineHeight: 22, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12, textAlignVertical: "top" },
  toolChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  toolChipText: { fontSize: 12.5, fontWeight: "600" },
  resultText: { fontSize: 15, lineHeight: 22 },
  resultNote: { fontSize: 11.5, marginTop: 10 },
  emptyBox: { alignItems: "center", justifyContent: "center", padding: 40, gap: 12 },
  emptyText: { fontSize: 14, textAlign: "center", lineHeight: 20 },
});
