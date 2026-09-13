import React, { useCallback, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import * as LocalAuthentication from "expo-local-authentication";
import * as FileSystem from "expo-file-system/legacy";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp, useTheme } from "@/src/context/AppContext";
import { useToast } from "@/src/components/Toast";
import { BottomSheet, ConfirmSheet } from "@/src/components/Sheet";
import { ColorPickerSheet, SortSheet } from "@/src/components/Pickers";
import { getStats, listNotes } from "@/src/db/repo";
import {
  createBackupFile,
  restoreMerge,
  restoreReplace,
  validateBackup,
  ParsedBackup,
} from "@/src/lib/backup";
import { totalAttachmentBytes, readAnyFile } from "@/src/lib/files";
import { exportNotes, ExportFormat } from "@/src/lib/exporter";
import { NoteColorKey, noteSwatchHex } from "@/src/theme/colors";
import { Intelligence } from "@/src/intelligence/engine";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const THEME_OPTIONS = [
  { key: "light", label: "Light", icon: "white-balance-sunny" },
  { key: "dark", label: "Dark", icon: "weather-night" },
  { key: "system", label: "System", icon: "cellphone" },
] as const;

const SORT_LABELS: Record<string, string> = {
  updated: "Recently updated",
  newest: "Newest first",
  oldest: "Oldest first",
  az: "Title A – Z",
  za: "Title Z – A",
};

export default function Settings() {
  const c = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { settings, setSetting, refresh } = useApp();

  const [stats, setStats] = useState({ noteCount: 0, attachmentCount: 0, bytes: 0 });
  const [colorVisible, setColorVisible] = useState(false);
  const [sortVisible, setSortVisible] = useState(false);
  const [restoreMode, setRestoreMode] = useState<ParsedBackup | null>(null);
  const [exportVisible, setExportVisible] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const rebuildIndex = async () => {
    setRebuilding(true);
    const res = await Intelligence.rebuild();
    setRebuilding(false);
    toast.show(res ? `Search index rebuilt (${res.count} items)` : "Rebuilt search index", "success");
  };

  const loadStats = useCallback(() => {
    (async () => {
      const s = await getStats();
      const bytes = await totalAttachmentBytes();
      setStats({ ...s, bytes });
    })();
  }, []);
  useFocusEffect(loadStats);

  const toggleBiometric = async (val: boolean) => {
    if (val) {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        toast.show("No biometrics enrolled on this device", "error");
        return;
      }
    }
    setSetting("biometricEnabled", val);
    toast.show(val ? "App lock enabled" : "App lock disabled", "success");
  };

  const doBackup = async () => {
    setBusy(true);
    try {
      const uri = await createBackupFile();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/json", dialogTitle: "Save backup" });
      }
      toast.show("Backup created", "success");
    } catch {
      toast.show("Backup failed", "error");
    }
    setBusy(false);
  };

  const pickRestore = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["application/json", "*/*"], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const raw = await readAnyFile(res.assets[0].uri);
      const parsed = validateBackup(raw);
      if (!parsed) {
        toast.show("Unable to restore this backup. The file may be invalid or corrupted.", "error");
        return;
      }
      setRestoreMode(parsed);
    } catch {
      toast.show("Unable to restore this backup. The file may be invalid or corrupted.", "error");
    }
  };

  const runRestore = async (mode: "replace" | "merge") => {
    const parsed = restoreMode;
    setRestoreMode(null);
    if (!parsed) return;
    setBusy(true);
    try {
      if (mode === "replace") await restoreReplace(parsed);
      else await restoreMerge(parsed);
      refresh();
      loadStats();
      toast.show("Backup restored successfully", "success");
    } catch {
      toast.show("Restore failed. Your existing notes are unchanged.", "error");
    }
    setBusy(false);
  };

  const exportAll = async (fmt: ExportFormat) => {
    setExportVisible(false);
    setBusy(true);
    try {
      const rows = await listNotes({ filter: "all", sort: settings.sort });
      if (rows.length === 0) {
        toast.show("No notes to export", "info");
      } else {
        await exportNotes(rows as any, fmt);
      }
    } catch {
      toast.show("Export failed", "error");
    }
    setBusy(false);
  };

  const clearCache = async () => {
    setConfirmClear(false);
    try {
      const dir = FileSystem.cacheDirectory;
      if (dir) {
        const names = await FileSystem.readDirectoryAsync(dir);
        for (const n of names) {
          await FileSystem.deleteAsync(dir + n, { idempotent: true });
        }
      }
      toast.show("Cache cleared", "success");
    } catch {
      toast.show("Nothing to clear", "info");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Pressable testID="settings-back" onPress={() => router.back()} style={styles.hBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={c.onSurface} />
        </Pressable>
        <Text style={[styles.hTitle, { color: c.onSurface }]}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {/* Appearance */}
        <Section title="Appearance" c={c} />
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <View style={styles.themeRow}>
            {THEME_OPTIONS.map((o) => {
              const active = settings.themePref === o.key;
              return (
                <Pressable
                  key={o.key}
                  testID={`theme-${o.key}`}
                  onPress={() => setSetting("themePref", o.key)}
                  style={[styles.themeBtn, { backgroundColor: active ? c.brandTertiary : c.surfaceTertiary, borderColor: active ? c.brand : "transparent" }]}
                >
                  <MaterialCommunityIcons name={o.icon as any} size={22} color={active ? c.brand : c.onSurfaceTertiary} />
                  <Text style={[styles.themeLabel, { color: active ? c.brand : c.onSurfaceTertiary }]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Notes */}
        <Section title="Notes" c={c} />
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Row icon="palette-outline" label="Default note color" c={c} testID="row-default-color" onPress={() => setColorVisible(true)}
            right={<View style={[styles.swatch, { backgroundColor: noteSwatchHex(settings.defaultColor) }]} />} />
          <Divider c={c} />
          <Row icon="sort" label="Default sorting" c={c} testID="row-default-sort" onPress={() => setSortVisible(true)}
            right={<Text style={[styles.valueText, { color: c.muted }]}>{SORT_LABELS[settings.sort]}</Text>} />
          <Divider c={c} />
          <Row icon="view-grid-outline" label="Grid layout" c={c} testID="row-layout"
            right={<Switch testID="switch-layout" value={settings.layout === "grid"} onValueChange={(v) => setSetting("layout", v ? "grid" : "list")} trackColor={{ true: c.brand }} thumbColor="#fff" />} />
          <Divider c={c} />
          <Row icon="text-box-outline" label="Show note previews" c={c} testID="row-previews"
            right={<Switch testID="switch-previews" value={settings.showPreviews} onValueChange={(v) => setSetting("showPreviews", v)} trackColor={{ true: c.brand }} thumbColor="#fff" />} />
          <Divider c={c} />
          <Row icon="format-list-checks" label="Completed items to bottom" c={c} testID="row-completed-bottom"
            right={<Switch testID="switch-completed" value={settings.completedToBottom} onValueChange={(v) => setSetting("completedToBottom", v)} trackColor={{ true: c.brand }} thumbColor="#fff" />} />
          <Divider c={c} />
          <Row icon="content-save-check-outline" label="Autosave" c={c} testID="row-autosave"
            right={<Text style={[styles.valueText, { color: c.success }]}>Always on</Text>} />
        </View>

        {/* Security */}
        <Section title="Security" c={c} />
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Row icon="fingerprint" label="Biometric app lock" c={c} testID="row-biometric"
            right={<Switch testID="switch-biometric" value={settings.biometricEnabled} onValueChange={toggleBiometric} trackColor={{ true: c.brand }} thumbColor="#fff" />} />
        </View>
        <Text style={[styles.hint, { color: c.muted }]}>Uses your device fingerprint or face unlock. No PIN or password is stored.</Text>

        {/* Backup & Restore */}
        <Section title="Backup & Restore" c={c} />
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Row icon="cloud-upload-outline" label="Create backup" c={c} testID="row-backup" onPress={busy ? undefined : doBackup} right={<Chevron c={c} />} />
          <Divider c={c} />
          <Row icon="cloud-download-outline" label="Restore backup" c={c} testID="row-restore" onPress={busy ? undefined : pickRestore} right={<Chevron c={c} />} />
          <Divider c={c} />
          <Row icon="export-variant" label="Export all notes" c={c} testID="row-export" onPress={() => setExportVisible(true)} right={<Chevron c={c} />} />
        </View>

        {/* Storage */}
        <Section title="Storage" c={c} />
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Row icon="note-multiple-outline" label="Notes" c={c} testID="row-note-count" right={<Text style={[styles.valueText, { color: c.muted }]}>{stats.noteCount}</Text>} />
          <Divider c={c} />
          <Row icon="paperclip" label="Attachments" c={c} testID="row-att-count" right={<Text style={[styles.valueText, { color: c.muted }]}>{stats.attachmentCount}</Text>} />
          <Divider c={c} />
          <Row icon="harddisk" label="Storage used" c={c} testID="row-storage" right={<Text style={[styles.valueText, { color: c.muted }]}>{humanSize(stats.bytes)}</Text>} />
          <Divider c={c} />
          <Row icon="broom" label="Clear cache" c={c} testID="row-clear-cache" onPress={() => setConfirmClear(true)} right={<Chevron c={c} />} />
          <Divider c={c} />
          <Row icon="refresh" label={rebuilding ? "Rebuilding\u2026" : "Rebuild search index"} c={c} testID="row-rebuild-index" onPress={rebuilding ? undefined : rebuildIndex} right={<Chevron c={c} />} />
        </View>

        {/* About */}
        <Section title="About" c={c} />
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Row icon="information-outline" label="Version" c={c} testID="row-version" right={<Text style={[styles.valueText, { color: c.muted }]}>{Constants.expoConfig?.version ?? "1.0.0"}</Text>} />
          <Divider c={c} />
          <Row icon="brain" label="Intelligence" c={c} testID="row-intel" right={<Text style={[styles.valueText, { color: c.success }]}>On-device</Text>} />
        </View>

        {/* Legal & Privacy */}
        <Section title="Legal & Privacy" c={c} />
        <View style={[styles.card, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
          <Row icon="shield-lock-outline" label="Privacy Policy" c={c} testID="row-privacy" onPress={() => router.push({ pathname: "/legal", params: { tab: "privacy" } })} right={<Chevron c={c} />} />
          <Divider c={c} />
          <Row icon="file-document-outline" label="Terms & Conditions" c={c} testID="row-terms" onPress={() => router.push({ pathname: "/legal", params: { tab: "terms" } })} right={<Chevron c={c} />} />
          <Divider c={c} />
          <Row icon="database-lock-outline" label="Data Safety" c={c} testID="row-data-safety" onPress={() => router.push({ pathname: "/legal", params: { tab: "data" } })} right={<Chevron c={c} />} />
        </View>
        <Text style={[styles.hint, { color: c.muted }]}>Your notes, images, audio, drawings and all intelligence run locally on this device. Content is only ever uploaded when you explicitly use "Share as Link", which you can revoke anytime.</Text>
      </ScrollView>

      <ColorPickerSheet visible={colorVisible} current={settings.defaultColor} onSelect={(k) => setSetting("defaultColor", k as NoteColorKey)} onClose={() => setColorVisible(false)} />
      <SortSheet visible={sortVisible} current={settings.sort} onSelect={(s) => setSetting("sort", s)} onClose={() => setSortVisible(false)} />

      <BottomSheet visible={!!restoreMode} onClose={() => setRestoreMode(null)} title="Restore backup" testID="restore-mode-sheet">
        <Text style={[styles.restoreMsg, { color: c.onSurfaceTertiary }]}>
          Choose how to restore. Merge keeps your current notes and adds the backup. Replace removes current notes first.
        </Text>
        <Pressable testID="restore-merge" onPress={() => runRestore("merge")} style={[styles.restoreBtn, { backgroundColor: c.brand }]}>
          <MaterialCommunityIcons name="merge" size={20} color="#fff" />
          <Text style={styles.restoreBtnText}>Merge with existing</Text>
        </Pressable>
        <Pressable testID="restore-replace" onPress={() => runRestore("replace")} style={[styles.restoreBtn, { backgroundColor: c.error }]}>
          <MaterialCommunityIcons name="swap-horizontal" size={20} color="#fff" />
          <Text style={styles.restoreBtnText}>Replace all data</Text>
        </Pressable>
      </BottomSheet>

      <BottomSheet visible={exportVisible} onClose={() => setExportVisible(false)} title="Export all as" testID="export-all-sheet">
        {(["txt", "md", "pdf"] as ExportFormat[]).map((fmt) => (
          <Pressable key={fmt} testID={`export-all-${fmt}`} onPress={() => exportAll(fmt)} style={styles.exportRow}>
            <MaterialCommunityIcons name={fmt === "pdf" ? "file-pdf-box" : fmt === "md" ? "language-markdown" : "file-document-outline"} size={22} color={c.brand} />
            <Text style={[styles.exportText, { color: c.onSurface }]}>{fmt.toUpperCase()}</Text>
          </Pressable>
        ))}
      </BottomSheet>

      <ConfirmSheet
        visible={confirmClear}
        title="Clear cache?"
        message="This clears temporary files only. Your notes and attachments are never touched."
        confirmLabel="Clear"
        onCancel={() => setConfirmClear(false)}
        onConfirm={clearCache}
      />
    </View>
  );
}

function Section({ title, c }: { title: string; c: any }) {
  return <Text style={[styles.section, { color: c.brand }]}>{title}</Text>;
}
function Divider({ c }: { c: any }) {
  return <View style={[styles.divider, { backgroundColor: c.divider }]} />;
}
function Chevron({ c }: { c: any }) {
  return <MaterialCommunityIcons name="chevron-right" size={22} color={c.muted} />;
}
function Row({
  icon,
  label,
  c,
  right,
  onPress,
  testID,
}: {
  icon: any;
  label: string;
  c: any;
  right?: React.ReactNode;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} disabled={!onPress} style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: c.brandTertiary }]}>
        <MaterialCommunityIcons name={icon} size={18} color={c.brand} />
      </View>
      <Text style={[styles.rowLabel, { color: c.onSurface }]}>{label}</Text>
      <View style={styles.rowRight}>{right}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, height: 52 },
  hBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  hTitle: { fontSize: 18, fontWeight: "700" },
  section: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 22, marginBottom: 10, marginLeft: 4 },
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: "500" },
  rowRight: { flexDirection: "row", alignItems: "center" },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 60 },
  valueText: { fontSize: 14, fontWeight: "500" },
  swatch: { width: 26, height: 26, borderRadius: 13 },
  themeRow: { flexDirection: "row", gap: 10, padding: 12 },
  themeBtn: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5 },
  themeLabel: { fontSize: 13, fontWeight: "600" },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 8, marginHorizontal: 4 },
  restoreMsg: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  restoreBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14, marginBottom: 10 },
  restoreBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  exportRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15 },
  exportText: { fontSize: 15, fontWeight: "600" },
});
