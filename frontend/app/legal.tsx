import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/context/AppContext";

const APP_NAME = "Notes AI";
const CONTACT = "support@notesai.app";
const UPDATED = "August 2025";

type Tab = "privacy" | "terms" | "data";

export default function LegalScreen() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string }>();
  const initial = (params.tab as Tab) || "privacy";
  const [tab, setTab] = useState<Tab>(["privacy", "terms", "data"].includes(initial) ? initial : "privacy");

  const H = ({ t }: { t: string }) => <Text style={[styles.h, { color: c.onSurface }]}>{t}</Text>;
  const P = ({ children }: { children: React.ReactNode }) => <Text style={[styles.p, { color: c.onSurfaceTertiary }]}>{children}</Text>;
  const B = ({ children }: { children: React.ReactNode }) => (
    <View style={styles.bullet}>
      <Text style={[styles.dot, { color: c.brand }]}>{"\u2022"}</Text>
      <Text style={[styles.p, { color: c.onSurfaceTertiary, flex: 1, marginBottom: 0 }]}>{children}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.surface, paddingTop: insets.top }}>
      <View style={styles.top}>
        <Pressable testID="legal-back" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={c.onSurface} />
        </Pressable>
        <Text style={[styles.title, { color: c.onSurface }]}>Legal & Privacy</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.tabs}>
        {([["privacy", "Privacy"], ["terms", "Terms"], ["data", "Data Safety"]] as [Tab, string][]).map(([k, l]) => {
          const active = tab === k;
          return (
            <Pressable key={k} testID={`legal-tab-${k}`} onPress={() => setTab(k)} style={[styles.tab, { borderBottomColor: active ? c.brand : "transparent" }]}>
              <Text style={[styles.tabText, { color: active ? c.brand : c.muted }]}>{l}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
        <Text style={[styles.updated, { color: c.muted }]}>Last updated: {UPDATED}</Text>

        {tab === "privacy" && (
          <>
            <H t="Privacy Policy" />
            <P>{APP_NAME} ("the app", "we") is an offline-first note-taking and workspace app. This policy explains exactly what happens to your information.</P>

            <H t="1. Offline, local-first storage" />
            <P>Your notes, pages, databases, tasks, calendar entries, comments, attachments and version history are stored locally on your device (SQLite on mobile, browser storage on web). By default, none of this content leaves your device.</P>

            <H t="2. On-device intelligence (no cloud AI)" />
            <P>Smart Search, Ask My Notes, summaries, tags, the knowledge graph and study tools run entirely on your device using deterministic algorithms. We do NOT use any cloud AI, large language models, or external inference services. Your content is never sent to any AI provider.</P>

            <H t="3. What we collect" />
            <B>Account data: none. {APP_NAME} does not require an account or login to work.</B>
            <B>Analytics of your note content: none. We do not transmit your notes for analytics.</B>
            <B>Optional online sharing (see below) is the only feature that uploads content, and only when you explicitly choose it.</B>

            <H t="4. Share as Link (optional online feature)" />
            <P>If, and only if, you tap "Share as Link" and confirm, a read-only copy of that single note or page is uploaded to our server so it can be viewed via a public URL. Anyone with the link can view it until you revoke it. We show a clear warning before any upload. You can revoke a link at any time, which disables public access. Do not use this feature for sensitive information.</P>

            <H t="5. Device permissions" />
            <B>Microphone: only if you record a voice note.</B>
            <B>Photos / Camera: only if you attach or capture an image.</B>
            <B>Notifications: only if you set a task reminder.</B>
            <P>All permissions are optional; the core app works without them.</P>

            <H t="6. Third-party services" />
            <P>The app is built with the Expo/React Native framework. Public shared links are hosted on our backend infrastructure. We do not sell or share your data with advertisers, and there is no third-party ad or tracking SDK bundled for content telemetry.</P>

            <H t="7. Data retention & deletion" />
            <P>Because data is local, deleting a note (and emptying Trash) removes it from your device. Uninstalling the app removes all local data. For online shared links, use "Revoke" to disable them; revoked links are marked inactive on our server.</P>

            <H t="8. Children's privacy" />
            <P>{APP_NAME} is not directed to children under 13 and does not knowingly collect personal information from them.</P>

            <H t="9. Contact" />
            <P>Questions about privacy? Email {CONTACT}.</P>
          </>
        )}

        {tab === "terms" && (
          <>
            <H t="Terms & Conditions" />
            <P>By using {APP_NAME} you agree to these terms.</P>

            <H t="1. Your content & ownership" />
            <P>You retain all rights to the notes and content you create. We claim no ownership over your content. You are solely responsible for what you create, store and share using the app.</P>

            <H t="2. Acceptable use" />
            <B>Do not use the app, and in particular the online "Share as Link" feature, to store or distribute unlawful, infringing, or harmful content.</B>
            <B>Do not attempt to disrupt, reverse-engineer or abuse the sharing backend.</B>

            <H t="3. Online sharing" />
            <P>Publicly shared links are provided as a convenience. You are responsible for the content you choose to make public and for revoking links when no longer needed. We may remove content that violates these terms or applicable law.</P>

            <H t="4. Intellectual property" />
            <P>The app's software, design, name and branding (including "{"Made with " + APP_NAME}") are owned by us and protected by applicable laws. These terms grant you a personal, non-exclusive, non-transferable licence to use the app.</P>

            <H t="5. Disclaimers" />
            <P>The app is provided "as is" without warranties of any kind. While we design for reliability and offline resilience, we do not guarantee that the app will be error-free or that data will never be lost. Keep your own backups of important content.</P>

            <H t="6. Limitation of liability" />
            <P>To the maximum extent permitted by law, we are not liable for any indirect, incidental, or consequential damages, or for loss of data, arising from your use of the app.</P>

            <H t="7. Security limitations" />
            <P>Local data security depends on your device's own security (screen lock, encryption). Optional biometric app lock adds a convenience layer but is not a guarantee against a compromised device. Public shared links are, by design, accessible to anyone who has the URL.</P>

            <H t="8. Changes" />
            <P>We may update these terms; continued use after changes constitutes acceptance. Material changes will be reflected by the "Last updated" date.</P>

            <H t="9. Contact" />
            <P>Questions about these terms? Email {CONTACT}.</P>
          </>
        )}

        {tab === "data" && (
          <>
            <H t="Data Safety" />
            <P>A plain-language summary of how {APP_NAME} handles data.</P>

            <H t="Data stored on your device" />
            <B>Notes, pages, blocks, databases & records</B>
            <B>Tasks, calendar entries and reminders</B>
            <B>Comments, version history and attachments (images/audio as local files)</B>
            <B>App settings and the local intelligence index/cache (rebuildable from your data)</B>

            <H t="Data sent off your device" />
            <B>Only when you use "Share as Link": a read-only copy of the chosen note/page is uploaded to create a public URL.</B>
            <B>No notes, search queries, comments, attachments or intelligence results are otherwise transmitted.</B>

            <H t="Data NOT collected" />
            <B>No account, email or password is required.</B>
            <B>No advertising identifiers or content-tracking telemetry.</B>
            <B>No cloud AI processing of your content.</B>

            <H t="Your controls" />
            <B>Delete notes locally and empty Trash to remove content.</B>
            <B>Revoke any public link to disable online access.</B>
            <B>Create local backups and restore them (Settings → Backup & Restore).</B>
            <B>Uninstalling removes all local data from the device.</B>

            <H t="Index & backup safety" />
            <P>The intelligence index and cache are never the source of truth. If they are missing or corrupted, the app rebuilds them from your local data, and your notes remain fully usable during recovery.</P>

            <H t="Contact" />
            <P>Data questions? Email {CONTACT}.</P>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 8 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  tabs: { flexDirection: "row", paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(128,128,128,0.2)" },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 2 },
  tabText: { fontSize: 14, fontWeight: "700" },
  updated: { fontSize: 12, marginBottom: 12, fontStyle: "italic" },
  h: { fontSize: 17, fontWeight: "800", marginTop: 18, marginBottom: 8 },
  p: { fontSize: 14.5, lineHeight: 22, marginBottom: 10 },
  bullet: { flexDirection: "row", gap: 8, marginBottom: 8, paddingRight: 4 },
  dot: { fontSize: 15, lineHeight: 22, fontWeight: "900" },
});
