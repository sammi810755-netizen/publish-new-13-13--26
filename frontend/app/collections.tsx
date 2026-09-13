import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/context/AppContext";
import { Intelligence } from "@/src/intelligence/engine";
import type { Collection } from "@/src/intelligence/relations";

const KIND_ICON: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  page: "file-tree", note: "notebook-outline", task: "checkbox-marked-outline", record: "table",
};

export default function CollectionsScreen() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [cols, setCols] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const cs = await Intelligence.collections();
    setCols(cs);
    setOpen((prev) => prev ?? (cs[0]?.key ?? null));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: c.surface, paddingTop: insets.top }}>
      <View style={styles.top}>
        <Pressable testID="collections-back" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={c.onSurface} />
        </Pressable>
        <Text style={[styles.title, { color: c.onSurface }]}>Smart Collections</Text>
        <Pressable testID="collections-refresh" onPress={load} style={styles.iconBtn} hitSlop={8}>
          <MaterialCommunityIcons name="refresh" size={22} color={c.onSurface} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={c.brand} /></View>
      ) : cols.length === 0 ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="shape-outline" size={48} color={c.muted} />
          <Text style={[styles.emptyText, { color: c.muted }]}>Collections build automatically as you add notes, tasks and pages.</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
          {cols.map((col) => {
            const isOpen = open === col.key;
            return (
              <View key={col.key} style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                <Pressable testID={`col-${col.key}`} onPress={() => setOpen(isOpen ? null : col.key)} style={styles.cardHead}>
                  <MaterialCommunityIcons name={col.icon as any} size={20} color={c.brand} />
                  <Text style={[styles.cardTitle, { color: c.onSurface }]}>{col.title}</Text>
                  <View style={[styles.badge, { backgroundColor: c.brandTertiary }]}>
                    <Text style={[styles.badgeText, { color: c.brand }]}>{col.docs.length}</Text>
                  </View>
                  <MaterialCommunityIcons name={isOpen ? "chevron-up" : "chevron-down"} size={20} color={c.muted} />
                </Pressable>
                {isOpen && col.docs.slice(0, 40).map((d) => (
                  <Pressable
                    key={d.id}
                    testID={`col-item-${d.id}`}
                    onPress={() => d.route && router.push(d.route as any)}
                    style={[styles.item, { borderColor: c.border }]}
                  >
                    <MaterialCommunityIcons name={KIND_ICON[d.kind] || "file-outline"} size={16} color={c.muted} />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={[styles.itemTitle, { color: c.onSurface }]}>{d.title || "Untitled"}</Text>
                      <Text numberOfLines={1} style={[styles.itemPath, { color: c.muted }]}>{d.path}{d.extra?.dueDate ? ` • due ${d.extra.dueDate}` : ""}</Text>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={16} color={c.muted} />
                  </Pressable>
                ))}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 8 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  emptyText: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12, overflow: "hidden" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: "700" },
  badge: { minWidth: 24, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  badgeText: { fontSize: 12, fontWeight: "700" },
  item: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth },
  itemTitle: { fontSize: 14, fontWeight: "600" },
  itemPath: { fontSize: 11, marginTop: 2 },
});
