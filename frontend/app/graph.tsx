import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/context/AppContext";
import { Intelligence } from "@/src/intelligence/engine";
import type { KnowledgeGraph, GraphNode } from "@/src/intelligence/relations";

const TYPE_ICON: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  page: "file-tree", note: "notebook-outline", tag: "tag-outline", topic: "pound",
};

export default function GraphScreen() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [focus, setFocus] = useState<GraphNode | null>(null);
  const [neighbors, setNeighbors] = useState<{ node: GraphNode; via: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const g = await Intelligence.graph();
    setGraph(g);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNode = async (n: GraphNode) => {
    setFocus(n);
    setNeighbors(await Intelligence.neighbors(n.id));
  };

  const goto = (n: GraphNode) => {
    if (n.route) router.push(n.route as any);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface, paddingTop: insets.top }}>
      <View style={styles.top}>
        <Pressable testID="graph-back" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={c.onSurface} />
        </Pressable>
        <Text style={[styles.title, { color: c.onSurface }]}>Knowledge Graph</Text>
        <Pressable testID="graph-refresh" onPress={load} style={styles.iconBtn} hitSlop={8}>
          <MaterialCommunityIcons name="refresh" size={22} color={c.onSurface} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={c.brand} /></View>
      ) : !graph || graph.nodes.length === 0 ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="graph-outline" size={48} color={c.muted} />
          <Text style={[styles.emptyText, { color: c.muted }]}>Create pages and notes with tags or [[links]] to build your graph.</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
          <Text style={[styles.stat, { color: c.muted }]}>{graph.nodes.length} nodes • {graph.edges.length} connections</Text>

          {graph.clusters.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { color: c.muted }]}>TOPIC CLUSTERS</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 6 }}>
                {graph.clusters.map((cl) => (
                  <View key={cl.topic} style={[styles.cluster, { backgroundColor: c.brandTertiary, borderColor: c.brand }]}>
                    <Text style={[styles.clusterTopic, { color: c.brand }]}>#{cl.topic}</Text>
                    <Text style={[styles.clusterCount, { color: c.brand }]}>{cl.nodeIds.length} notes</Text>
                  </View>
                ))}
              </ScrollView>
            </>
          )}

          <Text style={[styles.sectionTitle, { color: c.muted, marginTop: 16 }]}>MOST CONNECTED</Text>
          {graph.nodes.slice(0, 40).map((n) => (
            <Pressable
              key={n.id}
              testID={`graph-node-${n.id}`}
              onPress={() => openNode(n)}
              style={[styles.node, { backgroundColor: focus?.id === n.id ? c.brandTertiary : c.surfaceSecondary, borderColor: focus?.id === n.id ? c.brand : c.border }]}
            >
              <MaterialCommunityIcons name={TYPE_ICON[n.type] || "circle-small"} size={18} color={c.brand} />
              <Text numberOfLines={1} style={[styles.nodeLabel, { color: c.onSurface }]}>{n.label}</Text>
              <View style={[styles.degree, { backgroundColor: c.surfaceTertiary }]}>
                <Text style={[styles.degreeText, { color: c.muted }]}>{n.degree}</Text>
              </View>
            </Pressable>
          ))}

          {focus && (
            <View style={[styles.connections, { borderColor: c.border, backgroundColor: c.surfaceSecondary }]}>
              <View style={styles.connHeader}>
                <MaterialCommunityIcons name={TYPE_ICON[focus.type] || "circle-small"} size={20} color={c.brand} />
                <Text style={[styles.connTitle, { color: c.onSurface }]} numberOfLines={1}>{focus.label}</Text>
                {focus.route && (
                  <Pressable testID="graph-open" onPress={() => goto(focus)} hitSlop={8}>
                    <MaterialCommunityIcons name="open-in-new" size={20} color={c.brand} />
                  </Pressable>
                )}
              </View>
              {neighbors.length === 0 ? (
                <Text style={[styles.noConn, { color: c.muted }]}>No connections yet.</Text>
              ) : (
                neighbors.map((nb, i) => (
                  <Pressable key={i} testID={`neighbor-${i}`} onPress={() => (nb.node.route ? goto(nb.node) : openNode(nb.node))} style={styles.connRow}>
                    <MaterialCommunityIcons name={TYPE_ICON[nb.node.type] || "circle-small"} size={16} color={c.muted} />
                    <Text numberOfLines={1} style={[styles.connLabel, { color: c.onSurface }]}>{nb.node.label}</Text>
                    <Text style={[styles.via, { color: c.brand }]}>{nb.via}</Text>
                  </Pressable>
                ))
              )}
            </View>
          )}
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
  stat: { fontSize: 12, fontWeight: "600", marginBottom: 14 },
  sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, marginBottom: 8 },
  cluster: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: "center" },
  clusterTopic: { fontSize: 14, fontWeight: "700" },
  clusterCount: { fontSize: 11, marginTop: 2 },
  node: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginBottom: 8 },
  nodeLabel: { flex: 1, fontSize: 14, fontWeight: "600" },
  degree: { minWidth: 26, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  degreeText: { fontSize: 12, fontWeight: "700" },
  connections: { marginTop: 16, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  connHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  connTitle: { flex: 1, fontSize: 15, fontWeight: "700" },
  noConn: { fontSize: 13 },
  connRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  connLabel: { flex: 1, fontSize: 13.5, fontWeight: "500" },
  via: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
});
