import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/context/AppContext";
import { Intelligence, SearchHit } from "@/src/intelligence/engine";
import type { SearchMode } from "@/src/intelligence/search";
import type { DocKind } from "@/src/intelligence/corpus";

const MODES: { key: SearchMode; label: string }[] = [
  { key: "smart", label: "Smart" },
  { key: "exact", label: "Exact" },
  { key: "fuzzy", label: "Fuzzy" },
  { key: "prefix", label: "Prefix" },
  { key: "phrase", label: "Phrase" },
  { key: "tag", label: "Tag" },
];
const KINDS: { key: DocKind; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { key: "page", label: "Pages", icon: "file-tree" },
  { key: "note", label: "Notes", icon: "notebook-outline" },
  { key: "task", label: "Tasks", icon: "checkbox-marked-outline" },
  { key: "record", label: "Records", icon: "table" },
];
const KIND_ICON: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  page: "file-tree", note: "notebook-outline", task: "checkbox-marked-outline", record: "table", comment: "comment-outline",
};

export default function SmartSearch() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [raw, setRaw] = useState("");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<SearchMode>("smart");
  const [kinds, setKinds] = useState<Set<DocKind>>(new Set());
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(raw), 220);
    return () => clearTimeout(t);
  }, [raw]);

  const run = useCallback(async () => {
    if (!q.trim()) { setHits([]); setSearched(false); return; }
    const kindArr = kinds.size ? Array.from(kinds) : undefined;
    const res = await Intelligence.search(q, { mode, kinds: kindArr, limit: 60 });
    setHits(res);
    setSearched(true);
  }, [q, mode, kinds]);

  useEffect(() => { run(); }, [run]);

  const toggleKind = (k: DocKind) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });

  return (
    <View style={{ flex: 1, backgroundColor: c.surface, paddingTop: insets.top }}>
      <View style={styles.top}>
        <Pressable testID="search-back" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={c.onSurface} />
        </Pressable>
        <Text style={[styles.title, { color: c.onSurface }]}>Smart Search</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchWrap}>
        <View style={[styles.searchBar, { backgroundColor: c.surfaceTertiary, borderColor: c.border }]}>
          <MaterialCommunityIcons name="magnify" size={20} color={c.muted} />
          <TextInput
            testID="smart-search-input"
            value={raw}
            onChangeText={setRaw}
            autoFocus
            placeholder="Search everything…"
            placeholderTextColor={c.muted}
            style={[styles.input, { color: c.onSurface }]}
            returnKeyType="search"
          />
          {raw.length > 0 && (
            <Pressable testID="clear" onPress={() => setRaw("")}>
              <MaterialCommunityIcons name="close-circle" size={18} color={c.muted} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
        {MODES.map((m) => {
          const active = mode === m.key;
          return (
            <Pressable key={m.key} testID={`mode-${m.key}`} onPress={() => setMode(m.key)}
              style={[styles.chip, { backgroundColor: active ? c.brand : c.surfaceSecondary, borderColor: active ? c.brand : c.border }]}>
              <Text style={[styles.chipText, { color: active ? c.onBrand : c.onSurfaceTertiary }]}>{m.label}</Text>
            </Pressable>
          );
        })}
        <View style={[styles.divider, { backgroundColor: c.border }]} />
        {KINDS.map((k) => {
          const active = kinds.has(k.key);
          return (
            <Pressable key={k.key} testID={`kind-${k.key}`} onPress={() => toggleKind(k.key)}
              style={[styles.chip, { backgroundColor: active ? c.brandTertiary : c.surfaceSecondary, borderColor: active ? c.brand : c.border }]}>
              <MaterialCommunityIcons name={k.icon} size={13} color={active ? c.brand : c.onSurfaceTertiary} />
              <Text style={[styles.chipText, { color: active ? c.brand : c.onSurfaceTertiary }]}>{k.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        {searched && (
          <Text style={[styles.count, { color: c.muted }]}>{hits.length} result{hits.length === 1 ? "" : "s"}</Text>
        )}
        {searched && hits.length === 0 && (
          <Text style={[styles.empty, { color: c.muted }]}>No reliable result found. Try another mode or keyword.</Text>
        )}
        {hits.map((h) => (
          <Pressable
            key={h.doc.id}
            testID={`hit-${h.doc.id}`}
            onPress={() => h.doc.route && router.push(h.doc.route as any)}
            style={[styles.hit, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
          >
            <MaterialCommunityIcons name={KIND_ICON[h.doc.kind] || "file-outline"} size={20} color={c.brand} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={[styles.hitTitle, { color: c.onSurface }]}>{h.doc.title || "Untitled"}</Text>
              {!!h.snippet && <Text numberOfLines={2} style={[styles.hitSnippet, { color: c.muted }]}>{h.snippet}</Text>}
              <View style={styles.hitMeta}>
                <Text numberOfLines={1} style={[styles.hitPath, { color: c.muted }]}>{h.doc.path}</Text>
                {h.reasons.length > 0 && (
                  <Text style={[styles.reason, { color: c.brand }]}>{h.reasons[0]}</Text>
                )}
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 8 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  searchWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 8, height: 48, borderRadius: 999, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, fontSize: 15 },
  chipScroll: { maxHeight: 48, flexGrow: 0 },
  chipRow: { paddingHorizontal: 16, gap: 8, alignItems: "center", paddingVertical: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, height: 32, paddingHorizontal: 12, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontSize: 12.5, fontWeight: "600" },
  divider: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 2 },
  count: { fontSize: 12, fontWeight: "600", marginBottom: 10 },
  empty: { fontSize: 14, textAlign: "center", marginTop: 30 },
  hit: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, marginBottom: 10 },
  hitTitle: { fontSize: 15, fontWeight: "700" },
  hitSnippet: { fontSize: 12.5, marginTop: 3, lineHeight: 17 },
  hitMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 5 },
  hitPath: { flex: 1, fontSize: 11 },
  reason: { fontSize: 10.5, fontWeight: "700", textTransform: "uppercase" },
});
