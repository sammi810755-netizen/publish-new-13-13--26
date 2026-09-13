import React, { useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { captureRef } from "react-native-view-shot";

import { useTheme } from "@/src/context/AppContext";
import { useToast } from "@/src/components/Toast";
import { ConfirmSheet } from "@/src/components/Sheet";
import {
  BRANDING, ShareContent, shareAsText, shareAsFile, shareAsMarkdown, shareAsPdf,
  shareCapturedImage, createShareLink, revokeShareLink, shareLinkUrl, ShareLink,
} from "@/src/lib/sharing";

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (Platform.OS === "web" && typeof navigator !== "undefined" && (navigator as any).clipboard) {
      await (navigator as any).clipboard.writeText(text);
      return true;
    }
  } catch {}
  return false;
}

export default function ShareScreen() {
  const c = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ title?: string; body?: string; kind?: string }>();

  const content: ShareContent = {
    title: (params.title as string) || "Untitled",
    body: (params.body as string) || "",
    kind: (params.kind as any) === "page" ? "page" : "note",
  };

  const shareCardRef = useRef<View>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<ShareLink | null>(null);
  const [confirmUpload, setConfirmUpload] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const run = async (key: string, fn: () => Promise<any>, emptyMsg = "Nothing to share") => {
    if (!content.body.trim() && !content.title.trim()) { toast.show(emptyMsg, "error"); return; }
    setBusy(key);
    try { await fn(); } catch { toast.show("Share failed", "error"); }
    setBusy(null);
  };

  const doImage = async () => {
    setBusy("image");
    try {
      const uri = await captureRef(shareCardRef, { format: "png", quality: 1, result: "tmpfile" });
      const ok = await shareCapturedImage(uri);
      if (!ok) toast.show("Sharing not available here", "error");
    } catch {
      toast.show("Couldn't create image", "error");
    }
    setBusy(null);
  };

  const doLink = async () => {
    setConfirmUpload(false);
    setBusy("link");
    try {
      const l = await createShareLink(content);
      setLink(l);
      toast.show("Public link created", "success");
    } catch {
      toast.show("Couldn't create link. Check your connection.", "error");
    }
    setBusy(null);
  };

  const doRevoke = async () => {
    setConfirmRevoke(false);
    if (!link) return;
    setBusy("revoke");
    const ok = await revokeShareLink(link.token, link.manageToken);
    if (ok) { setLink(null); toast.show("Link revoked", "success"); }
    else toast.show("Couldn't revoke link", "error");
    setBusy(null);
  };

  const options: { key: string; label: string; sub: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; onPress: () => void }[] = [
    { key: "text", label: "Share as Text", sub: "Send plain text anywhere", icon: "text", onPress: () => run("text", () => shareAsText(content)) },
    { key: "file", label: "Share as File", sub: "Export a .txt file", icon: "file-document-outline", onPress: () => run("file", () => shareAsFile(content)) },
    { key: "md", label: "Share as Markdown", sub: "Export a .md file", icon: "language-markdown", onPress: () => run("md", () => shareAsMarkdown(content)) },
    { key: "pdf", label: "Share as PDF", sub: "Formatted document", icon: "file-pdf-box", onPress: () => run("pdf", () => shareAsPdf(content)) },
    { key: "image", label: "Share as Image", sub: "A shareable picture card", icon: "image-outline", onPress: doImage },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: c.surface, paddingTop: insets.top }}>
      <View style={styles.top}>
        <Pressable testID="share-back" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={c.onSurface} />
        </Pressable>
        <Text style={[styles.title, { color: c.onSurface }]}>Share</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
        <Text numberOfLines={1} style={[styles.subject, { color: c.muted }]}>{content.title}</Text>

        <Text style={[styles.sectionTitle, { color: c.muted }]}>OFFLINE \u2014 STAYS ON YOUR DEVICE</Text>
        {options.map((o) => (
          <Pressable key={o.key} testID={`share-${o.key}`} onPress={o.onPress} style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <View style={[styles.rowIcon, { backgroundColor: c.brandTertiary }]}>
              <MaterialCommunityIcons name={o.icon} size={20} color={c.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: c.onSurface }]}>{o.label}</Text>
              <Text style={[styles.rowSub, { color: c.muted }]}>{o.sub}</Text>
            </View>
            {busy === o.key ? <ActivityIndicator color={c.brand} /> : <MaterialCommunityIcons name="chevron-right" size={20} color={c.muted} />}
          </Pressable>
        ))}

        <Text style={[styles.sectionTitle, { color: c.muted, marginTop: 20 }]}>ONLINE \u2014 PUBLIC READ-ONLY LINK</Text>
        {!link ? (
          <Pressable testID="share-link" onPress={() => setConfirmUpload(true)} style={[styles.row, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            <View style={[styles.rowIcon, { backgroundColor: c.brandTertiary }]}>
              <MaterialCommunityIcons name="link-variant" size={20} color={c.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: c.onSurface }]}>Share as Link</Text>
              <Text style={[styles.rowSub, { color: c.muted }]}>Uploads a read-only copy online</Text>
            </View>
            {busy === "link" ? <ActivityIndicator color={c.brand} /> : <MaterialCommunityIcons name="chevron-right" size={20} color={c.muted} />}
          </Pressable>
        ) : (
          <View style={[styles.linkCard, { backgroundColor: c.surfaceSecondary, borderColor: c.brand }]}>
            <Text numberOfLines={1} style={[styles.linkUrl, { color: c.onSurface }]}>{link.url}</Text>
            <View style={styles.linkActions}>
              <Pressable testID="copy-link" onPress={async () => { const ok = await copyToClipboard(link.url); if (ok) toast.show("Link copied", "success"); else { await shareLinkUrl(link.url); } }} style={[styles.linkBtn, { backgroundColor: c.brandTertiary }]}>
                <MaterialCommunityIcons name="content-copy" size={16} color={c.brand} />
                <Text style={[styles.linkBtnText, { color: c.brand }]}>Copy</Text>
              </Pressable>
              <Pressable testID="share-link-url" onPress={() => shareLinkUrl(link.url)} style={[styles.linkBtn, { backgroundColor: c.brandTertiary }]}>
                <MaterialCommunityIcons name="share-variant" size={16} color={c.brand} />
                <Text style={[styles.linkBtnText, { color: c.brand }]}>Share</Text>
              </Pressable>
              <Pressable testID="revoke-link" onPress={() => setConfirmRevoke(true)} style={[styles.linkBtn, { backgroundColor: c.surfaceTertiary }]}>
                {busy === "revoke" ? <ActivityIndicator size="small" color={c.error} /> : <MaterialCommunityIcons name="link-off" size={16} color={c.error} />}
                <Text style={[styles.linkBtnText, { color: c.error }]}>Revoke</Text>
              </Pressable>
            </View>
          </View>
        )}

        <Pressable testID="share-legal" onPress={() => router.push("/legal")} style={styles.legalLink}>
          <MaterialCommunityIcons name="shield-check-outline" size={15} color={c.muted} />
          <Text style={[styles.legalText, { color: c.muted }]}>Privacy Policy & Terms</Text>
        </Pressable>
      </ScrollView>

      {/* Off-screen branded card for image capture */}
      <View style={styles.captureHost} pointerEvents="none">
        <View ref={shareCardRef} collapsable={false} style={styles.card}>
          <View style={styles.cardBadge}><Text style={styles.cardBadgeText}>{"\u2728 " + BRANDING}</Text></View>
          <Text style={styles.cardTitle}>{content.title}</Text>
          <Text style={styles.cardBody}>{content.body.slice(0, 1200)}</Text>
        </View>
      </View>

      <ConfirmSheet
        visible={confirmUpload}
        title="Share online?"
        message="A read-only copy of this note will be uploaded to create a public link. Anyone with the link can view it until you revoke it. Do not share sensitive information."
        confirmLabel="Create link"
        onCancel={() => setConfirmUpload(false)}
        onConfirm={doLink}
      />
      <ConfirmSheet
        visible={confirmRevoke}
        title="Revoke link?"
        message="The public link will stop working immediately."
        confirmLabel="Revoke"
        destructive
        onCancel={() => setConfirmRevoke(false)}
        onConfirm={doRevoke}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 8 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  subject: { fontSize: 14, fontWeight: "600", marginBottom: 16 },
  sectionTitle: { fontSize: 11.5, fontWeight: "700", letterSpacing: 0.6, marginBottom: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, marginBottom: 10 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontSize: 15, fontWeight: "700" },
  rowSub: { fontSize: 12, marginTop: 2 },
  linkCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  linkUrl: { fontSize: 13, fontWeight: "600", marginBottom: 12 },
  linkActions: { flexDirection: "row", gap: 8 },
  linkBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 40, borderRadius: 10 },
  linkBtnText: { fontSize: 13, fontWeight: "700" },
  legalLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 24, paddingVertical: 10 },
  legalText: { fontSize: 12.5, fontWeight: "600" },
  captureHost: { position: "absolute", left: -9999, top: 0, width: 600 },
  card: { width: 600, padding: 44, backgroundColor: "#faf9f7" },
  cardBadge: { alignSelf: "flex-start", backgroundColor: "#fff1e7", borderColor: "#fed7aa", borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  cardBadgeText: { color: "#c2410c", fontSize: 14, fontWeight: "800" },
  cardTitle: { color: "#181715", fontSize: 34, fontWeight: "800", marginTop: 18, letterSpacing: -0.5 },
  cardBody: { color: "#333", fontSize: 19, lineHeight: 30, marginTop: 16 },
});
