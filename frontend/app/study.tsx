import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp, useTheme } from "@/src/context/AppContext";
import { useToast } from "@/src/components/Toast";
import { BottomSheet } from "@/src/components/Sheet";
import { Intelligence } from "@/src/intelligence/engine";
import type { IDoc } from "@/src/intelligence/corpus";
import type { StudyPack, ConversionKind } from "@/src/intelligence/text-ops";
import { createChecklistNote, createFlashcardNote, createTasksFromDetected, createTextNote } from "@/src/intelligence/apply";
import { detectTasksIn } from "@/src/intelligence/relations";

const CONVERSIONS: { key: ConversionKind; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { key: "checklist", label: "Checklist", icon: "format-list-checks" },
  { key: "tasks", label: "Tasks", icon: "checkbox-marked-circle-outline" },
  { key: "outline", label: "Outline", icon: "format-list-bulleted" },
  { key: "summary", label: "Summary", icon: "text-short" },
  { key: "flashcards", label: "Flashcards", icon: "cards-outline" },
  { key: "questions", label: "Questions", icon: "help-circle-outline" },
  { key: "table", label: "Table", icon: "table" },
];

export default function StudyScreen() {
  const c = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { refresh } = useApp();

  const [docs, setDocs] = useState<IDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<IDoc | null>(null);
  const [pack, setPack] = useState<StudyPack | null>(null);
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<{ kind: ConversionKind; lines: string[]; data: any } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const index = await Intelligence.ensureIndex();
    const all = index ? Object.values(index.docs).filter((d) => (d.text || "").length > 20 && (d.kind === "page" || d.kind === "note")) : [];
    all.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    setDocs(all);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => docs.filter((d) => (d.title + d.path).toLowerCase().includes(filter.toLowerCase())),
    [docs, filter],
  );

  const choose = (d: IDoc) => {
    setSelected(d);
    setPickerOpen(false);
    setFlipped(new Set());
    setPack(Intelligence.study(d.text, d.title));
  };

  const runConvert = (kind: ConversionKind) => {
    if (!selected) return;
    const res = Intelligence.convert(selected.text, selected.title, kind);
    setPreview(res);
  };

  const applyConversion = async () => {
    if (!preview || !selected) return;
    try {
      const base = selected.title || "Note";
      if (preview.kind === "checklist") await createChecklistNote(`${base} (checklist)`, preview.data.items || []);
      else if (preview.kind === "tasks") {
        const detected = (preview.data.tasks || []).flatMap((t: string) => detectTasksIn(t));
        const items = detected.length ? detected : (preview.data.tasks || []).map((t: string) => ({ task: t, date: null, time: null, priority: "medium" as const, text: t, source: base }));
        const n = await createTasksFromDetected(items);
        toast.show(`${n} task(s) created`, "success");
        setPreview(null); refresh(); return;
      }
      else if (preview.kind === "flashcards") await createFlashcardNote(base, preview.data.flashcards || []);
      else await createTextNote(`${base} (${preview.kind})`, preview.lines.join("\n"));
      toast.show("Created as new note", "success");
      setPreview(null);
      refresh();
    } catch {
      toast.show("Couldn't create", "error");
    }
  };

  const toggleFlip = (i: number) => setFlipped((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  return (
    <View style={{ flex: 1, backgroundColor: c.surface, paddingTop: insets.top }}>
      <View style={styles.top}>
        <Pressable testID="study-back" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={c.onSurface} />
        </Pressable>
        <Text style={[styles.title, { color: c.onSurface }]}>Study</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={c.brand} /></View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
          <Pressable testID="study-pick" onPress={() => setPickerOpen(true)} style={[styles.picker, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <MaterialCommunityIcons name="file-document-outline" size={20} color={c.brand} />
            <Text numberOfLines={1} style={[styles.pickerText, { color: selected ? c.onSurface : c.muted }]}>
              {selected ? selected.title || "Untitled" : "Choose a note or page to study"}
            </Text>
            <MaterialCommunityIcons name="chevron-down" size={20} color={c.muted} />
          </Pressable>

          {selected && pack && (
            <>
              <View style={styles.diffRow}>
                <View style={[styles.diffBadge, { backgroundColor: c.brandTertiary }]}>
                  <MaterialCommunityIcons name="speedometer" size={14} color={c.brand} />
                  <Text style={[styles.diffText, { color: c.brand }]}>Difficulty: {pack.difficulty}</Text>
                </View>
              </View>

              <Text style={[styles.sectionTitle, { color: c.muted }]}>CONVERT THIS NOTE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 6 }}>
                {CONVERSIONS.map((cv) => (
                  <Pressable key={cv.key} testID={`convert-${cv.key}`} onPress={() => runConvert(cv.key)}
                    style={[styles.convChip, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                    <MaterialCommunityIcons name={cv.icon} size={16} color={c.brand} />
                    <Text style={[styles.convLabel, { color: c.onSurface }]}>{cv.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Section title="KEY POINTS" c={c} />
              {pack.keyPoints.length ? pack.keyPoints.map((k, i) => (
                <View key={i} style={styles.pointRow}>
                  <MaterialCommunityIcons name="circle-medium" size={18} color={c.brand} />
                  <Text style={[styles.pointText, { color: c.onSurface }]}>{k}</Text>
                </View>
              )) : <Text style={[styles.none, { color: c.muted }]}>Not enough content.</Text>}

              {pack.terms.length > 0 && (
                <>
                  <Section title="IMPORTANT TERMS" c={c} />
                  {pack.terms.map((t, i) => (
                    <View key={i} style={[styles.term, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                      <Text style={[styles.termName, { color: c.brand }]}>{t.term}</Text>
                      <Text style={[styles.termDef, { color: c.onSurface }]}>{t.definition}</Text>
                    </View>
                  ))}
                </>
              )}

              {pack.flashcards.length > 0 && (
                <>
                  <View style={styles.flashHead}>
                    <Section title="FLASHCARDS" c={c} noMargin />
                    <Pressable testID="save-flashcards" onPress={async () => { await createFlashcardNote(selected.title || "Note", pack.flashcards); toast.show("Saved as note", "success"); refresh(); }}>
                      <Text style={[styles.saveLink, { color: c.brand }]}>Save as note</Text>
                    </Pressable>
                  </View>
                  {pack.flashcards.map((f, i) => (
                    <Pressable key={i} testID={`flash-${i}`} onPress={() => toggleFlip(i)}
                      style={[styles.flash, { backgroundColor: flipped.has(i) ? c.brandTertiary : c.surfaceSecondary, borderColor: c.border }]}>
                      <Text style={[styles.flashSide, { color: c.muted }]}>{flipped.has(i) ? "ANSWER" : "QUESTION (tap to flip)"}</Text>
                      <Text style={[styles.flashText, { color: c.onSurface }]}>{flipped.has(i) ? f.back : f.front}</Text>
                    </Pressable>
                  ))}
                </>
              )}

              {pack.questions.length > 0 && (
                <>
                  <Section title="REVISION QUESTIONS" c={c} />
                  {pack.questions.map((qq, i) => (
                    <View key={i} style={styles.pointRow}>
                      <MaterialCommunityIcons name="help-circle-outline" size={16} color={c.brand} />
                      <Text style={[styles.pointText, { color: c.onSurface }]}>{qq}</Text>
                    </View>
                  ))}
                </>
              )}
            </>
          )}
        </ScrollView>
      )}

      <BottomSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="Choose source" testID="study-picker">
        <TextInput
          testID="study-filter"
          value={filter}
          onChangeText={setFilter}
          placeholder="Filter…"
          placeholderTextColor={c.muted}
          style={[styles.filterInput, { backgroundColor: c.surfaceTertiary, color: c.onSurface, borderColor: c.border }]}
        />
        <ScrollView style={{ maxHeight: 360 }}>
          {filtered.length === 0 && <Text style={[styles.none, { color: c.muted }]}>No notes/pages with enough content.</Text>}
          {filtered.slice(0, 60).map((d) => (
            <Pressable key={d.id} testID={`pick-${d.id}`} onPress={() => choose(d)} style={styles.pickRow}>
              <MaterialCommunityIcons name={d.kind === "page" ? "file-tree" : "notebook-outline"} size={18} color={c.brand} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={[styles.pickTitle, { color: c.onSurface }]}>{d.title || "Untitled"}</Text>
                <Text numberOfLines={1} style={[styles.pickPath, { color: c.muted }]}>{d.path}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>

      <BottomSheet visible={!!preview} onClose={() => setPreview(null)} title={`Preview: ${preview?.kind ?? ""}`} testID="conversion-preview">
        <ScrollView style={{ maxHeight: 340 }}>
          {(preview?.lines ?? []).map((l, i) => (
            <Text key={i} style={[styles.previewLine, { color: c.onSurface }]}>{l}</Text>
          ))}
          {(preview?.lines ?? []).length === 0 && <Text style={[styles.none, { color: c.muted }]}>Nothing to preview.</Text>}
        </ScrollView>
        <Pressable testID="apply-conversion" onPress={applyConversion} style={[styles.applyBtn, { backgroundColor: c.brand }]}>
          <MaterialCommunityIcons name="plus" size={18} color={c.onBrand} />
          <Text style={[styles.applyText, { color: c.onBrand }]}>Create as new (keeps original)</Text>
        </Pressable>
      </BottomSheet>
    </View>
  );
}

function Section({ title, c, noMargin }: { title: string; c: any; noMargin?: boolean }) {
  return <Text style={[styles.sectionTitle, { color: c.muted, marginTop: noMargin ? 0 : 18 }]}>{title}</Text>;
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 8 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  picker: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  pickerText: { flex: 1, fontSize: 15, fontWeight: "600" },
  diffRow: { flexDirection: "row", marginTop: 14 },
  diffBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  diffText: { fontSize: 12.5, fontWeight: "700" },
  sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, marginBottom: 8, marginTop: 18 },
  convChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 38, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  convLabel: { fontSize: 13, fontWeight: "600" },
  pointRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginBottom: 8 },
  pointText: { flex: 1, fontSize: 14.5, lineHeight: 21 },
  none: { fontSize: 13, paddingVertical: 8 },
  term: { padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginBottom: 8 },
  termName: { fontSize: 14, fontWeight: "700", marginBottom: 3 },
  termDef: { fontSize: 13.5, lineHeight: 19 },
  flashHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18, marginBottom: 8 },
  saveLink: { fontSize: 13, fontWeight: "700" },
  flash: { padding: 16, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, marginBottom: 10, minHeight: 90, justifyContent: "center" },
  flashSide: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.5, marginBottom: 8 },
  flashText: { fontSize: 15, fontWeight: "600", lineHeight: 22 },
  filterInput: { height: 44, borderRadius: 12, paddingHorizontal: 14, fontSize: 14, borderWidth: StyleSheet.hairlineWidth, marginBottom: 10 },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11 },
  pickTitle: { fontSize: 14.5, fontWeight: "600" },
  pickPath: { fontSize: 11, marginTop: 2 },
  previewLine: { fontSize: 14, lineHeight: 22, marginBottom: 4 },
  applyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14, marginTop: 12 },
  applyText: { fontSize: 15, fontWeight: "700" },
});
