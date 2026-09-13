import React, { useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/context/AppContext";
import { Intelligence, AskAnswer } from "@/src/intelligence/engine";

interface Turn { q: string; a: AskAnswer | null }

const SUGGESTIONS = [
  "What did I write about machine learning?",
  "Show my unfinished tasks",
  "What is due this week?",
  "Summarize my data science notes",
  "Find notes related to python",
];

export default function AskScreen() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const ask = async (question: string) => {
    const query = question.trim();
    if (!query || busy) return;
    setQ("");
    setBusy(true);
    setTurns((t) => [...t, { q: query, a: null }]);
    const answer = await Intelligence.ask(query);
    setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: answer } : x)));
    setBusy(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface, paddingTop: insets.top }}>
      <View style={styles.top}>
        <Pressable testID="ask-back" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={c.onSurface} />
        </Pressable>
        <Text style={[styles.title, { color: c.onSurface }]}>Ask My Notes</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {turns.length === 0 && (
            <View>
              <View style={[styles.privacy, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                <MaterialCommunityIcons name="shield-lock-outline" size={18} color={c.brand} />
                <Text style={[styles.privacyText, { color: c.muted }]}>
                  Answers come only from your notes on this device. 100% offline — nothing is uploaded.
                </Text>
              </View>
              <Text style={[styles.suggestLabel, { color: c.muted }]}>TRY ASKING</Text>
              {SUGGESTIONS.map((s) => (
                <Pressable
                  key={s}
                  testID={`suggest-${s.slice(0, 6)}`}
                  onPress={() => ask(s)}
                  style={[styles.suggest, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}
                >
                  <MaterialCommunityIcons name="lightning-bolt-outline" size={16} color={c.brand} />
                  <Text style={[styles.suggestText, { color: c.onSurface }]}>{s}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {turns.map((t, i) => (
            <View key={i} style={{ marginBottom: 18 }}>
              <View style={[styles.bubbleQ, { backgroundColor: c.brand }]}>
                <Text style={[styles.bubbleQText, { color: c.onBrand }]}>{t.q}</Text>
              </View>
              {t.a === null ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={c.brand} />
                  <Text style={[styles.loadingText, { color: c.muted }]}>Searching your notes…</Text>
                </View>
              ) : (
                <View style={[styles.answer, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
                  <Text style={[styles.answerText, { color: c.onSurface }]}>{t.a.answer}</Text>
                  <View style={styles.metaRow}>
                    <View style={[styles.badge, { backgroundColor: c.brandTertiary }]}>
                      <Text style={[styles.badgeText, { color: c.brand }]}>{Math.round(t.a.confidence * 100)}% confidence</Text>
                    </View>
                    <Text style={[styles.provenance, { color: c.muted }]} numberOfLines={1}>{t.a.provenance}</Text>
                  </View>
                  {t.a.sources.length > 0 && (
                    <View style={{ marginTop: 10 }}>
                      <Text style={[styles.sourcesLabel, { color: c.muted }]}>SOURCES ({t.a.sources.length})</Text>
                      {t.a.sources.map((s, j) => (
                        <Pressable
                          key={j}
                          testID={`source-${i}-${j}`}
                          onPress={() => s.route && router.push(s.route as any)}
                          style={[styles.source, { borderColor: c.border }]}
                        >
                          <MaterialCommunityIcons name="file-document-outline" size={16} color={c.brand} />
                          <View style={{ flex: 1 }}>
                            <Text numberOfLines={1} style={[styles.sourceTitle, { color: c.onSurface }]}>{s.title}</Text>
                            {!!s.snippet && <Text numberOfLines={2} style={[styles.sourceSnippet, { color: c.muted }]}>{s.snippet}</Text>}
                            <Text numberOfLines={1} style={[styles.sourcePath, { color: c.muted }]}>{s.path}</Text>
                          </View>
                          <MaterialCommunityIcons name="chevron-right" size={18} color={c.muted} />
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>
          ))}
        </ScrollView>

        <View style={[styles.inputBar, { backgroundColor: c.surface, borderColor: c.border, paddingBottom: insets.bottom + 10 }]}>
          <TextInput
            testID="ask-input"
            value={q}
            onChangeText={setQ}
            placeholder="Ask about your notes…"
            placeholderTextColor={c.muted}
            style={[styles.input, { backgroundColor: c.surfaceTertiary, color: c.onSurface, borderColor: c.border }]}
            onSubmitEditing={() => ask(q)}
            returnKeyType="send"
          />
          <Pressable testID="ask-send" onPress={() => ask(q)} style={[styles.send, { backgroundColor: c.brand }]}>
            <MaterialCommunityIcons name="send" size={20} color={c.onBrand} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 8 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  privacy: { flexDirection: "row", gap: 10, alignItems: "center", padding: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, marginBottom: 20 },
  privacyText: { flex: 1, fontSize: 12.5, lineHeight: 18 },
  suggestLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, marginBottom: 10 },
  suggest: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginBottom: 10 },
  suggestText: { flex: 1, fontSize: 14, fontWeight: "500" },
  bubbleQ: { alignSelf: "flex-end", maxWidth: "85%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, borderBottomRightRadius: 4, marginBottom: 10 },
  bubbleQText: { fontSize: 15, fontWeight: "600" },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  loadingText: { fontSize: 14 },
  answer: { padding: 14, borderRadius: 16, borderBottomLeftRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  answerText: { fontSize: 15, lineHeight: 22, fontWeight: "500" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  provenance: { flex: 1, fontSize: 11.5 },
  sourcesLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 6 },
  source: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  sourceTitle: { fontSize: 14, fontWeight: "600" },
  sourceSnippet: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  sourcePath: { fontSize: 11, marginTop: 3 },
  inputBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, height: 46, borderRadius: 23, paddingHorizontal: 16, fontSize: 15, borderWidth: StyleSheet.hairlineWidth },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
});
