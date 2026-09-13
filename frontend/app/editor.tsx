import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  KeyboardAwareScrollView,
  KeyboardStickyView,
} from "react-native-keyboard-controller";
import {
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { SvgXml } from "react-native-svg";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import dayjs from "dayjs";

import { useApp, useTheme } from "@/src/context/AppContext";
import { useToast } from "@/src/components/Toast";
import { BottomSheet, ConfirmSheet } from "@/src/components/Sheet";
import { ColorPickerSheet, FolderPickerSheet } from "@/src/components/Pickers";
import { LabelPickerSheet } from "@/src/components/LabelPickerSheet";
import { VoiceRecorderSheet } from "@/src/components/VoiceRecorderSheet";
import { AudioPlayer } from "@/src/components/AudioPlayer";
import { noteColorHex } from "@/src/theme/colors";
import {
  addAttachment,
  addChecklistItem,
  createNote,
  deleteAttachment,
  deleteChecklistItem,
  discardIfEmpty,
  getAttachments,
  getChecklist,
  getNote,
  reorderChecklist,
  trashNote,
  updateChecklistItem,
  updateNote,
} from "@/src/db/repo";
import { Attachment, ChecklistItem, NoteType } from "@/src/db/types";
import { copyIntoStore, readTextFile } from "@/src/lib/files";
import { exportNotes, ExportFormat } from "@/src/lib/exporter";
import { captureRef } from "react-native-view-shot";
import { buildNoteText, shareImageFile, shareNoteAsText } from "@/src/lib/share";

function extFromUri(uri: string, fallback: string): string {
  const m = uri.split("?")[0].split(".").pop();
  return m && m.length <= 5 ? m.toLowerCase() : fallback;
}

function DrawingThumb({ path, onRemove, onPress }: { path: string; onRemove: () => void; onPress: () => void }) {
  const c = useTheme();
  const [xml, setXml] = useState<string | null>(null);
  useEffect(() => {
    readTextFile(path).then(setXml);
  }, [path]);
  return (
    <View style={[styles.thumb, { borderColor: c.border, backgroundColor: "#FFFFFF" }]}>
      <Pressable onPress={onPress} style={{ flex: 1 }} testID="drawing-thumb">
        {xml ? <SvgXml xml={xml} width="100%" height="100%" /> : null}
      </Pressable>
      <Pressable onPress={onRemove} style={[styles.thumbRemove, { backgroundColor: c.surfaceInverse }]} testID="remove-drawing">
        <MaterialCommunityIcons name="close" size={14} color={c.onSurfaceInverse} />
      </Pressable>
    </View>
  );
}

export default function Editor() {
  const c = useTheme();
  const { settings, refresh } = useApp();
  const router = useRouter();
  const navigation = useNavigation();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string; type?: string; action?: string }>();

  const [noteId, setNoteId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<NoteType>("text");
  const [color, setColor] = useState("default");
  const [isPinned, setIsPinned] = useState(0);
  const [isFavorite, setIsFavorite] = useState(0);
  const [isArchived, setIsArchived] = useState(0);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>(new Date().toISOString());
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [labelVersion, setLabelVersion] = useState(0);

  const selection = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const [colorVisible, setColorVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [folderVisible, setFolderVisible] = useState(false);
  const [labelVisible, setLabelVisible] = useState(false);
  const [voiceVisible, setVoiceVisible] = useState(false);
  const [exportVisible, setExportVisible] = useState(false);
  const [shareVisible, setShareVisible] = useState(false);
  const [imageMenuVisible, setImageMenuVisible] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sharing, setSharing] = useState(false);
  const shareCardRef = useRef<View>(null);

  const noteIdRef = useRef<string | null>(null);
  const titleRef = useRef("");
  const contentRef = useRef("");
  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { contentRef.current = content; }, [content]);

  // Initialize note (load existing or create new).
  useEffect(() => {
    (async () => {
      if (params.id) {
        const n = await getNote(params.id);
        if (n) {
          setNoteId(n.id);
          noteIdRef.current = n.id;
          setTitle(n.title);
          setContent(n.content);
          setType(n.type);
          setColor(n.color);
          setIsPinned(n.isPinned);
          setIsFavorite(n.isFavorite);
          setIsArchived(n.isArchived);
          setFolderId(n.folderId);
          setUpdatedAt(n.updatedAt);
          setItems(await getChecklist(n.id));
          setAttachments(await getAttachments(n.id));
        }
        setLoaded(true);
      } else {
        const nt = (params.type as NoteType) || "text";
        const n = await createNote({ type: nt, color: settings.defaultColor });
        setNoteId(n.id);
        noteIdRef.current = n.id;
        setType(nt);
        setColor(settings.defaultColor);
        setLoaded(true);
        // Trigger creation action.
        setTimeout(() => {
          if (params.action === "voice") setVoiceVisible(true);
          else if (params.action === "image") setImageMenuVisible(true);
          else if (params.action === "drawing")
            router.push({ pathname: "/drawing", params: { noteId: n.id } });
        }, 350);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload attachments/checklist when returning (e.g. from drawing screen).
  useFocusEffect(
    useCallback(() => {
      if (noteIdRef.current) {
        getAttachments(noteIdRef.current).then(setAttachments);
        getChecklist(noteIdRef.current).then((cl) => {
          if (type === "checklist" || cl.length) setItems(cl);
        });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // Autosave title/content.
  useEffect(() => {
    if (!noteId || !loaded) return;
    const t = setTimeout(() => {
      updateNote(noteId, { title, content }).catch((e) => {
        // Keep the text in state; the next successful write persists it.
        console.warn("[Editor] autosave failed", e);
      });
    }, 400);
    return () => clearTimeout(t);
  }, [title, content, noteId, loaded]);

  // Discard empty note on leave.
  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", () => {
      const id = noteIdRef.current;
      if (!id) return;
      (async () => {
        try {
          await updateNote(id, { title: titleRef.current, content: contentRef.current });
          await discardIfEmpty(id);
        } catch (e) {
          console.warn("[Editor] save-on-exit failed", e);
        }
        refresh();
      })();
    });
    return unsub;
  }, [navigation, refresh]);

  const patch = (fields: any) => {
    if (noteId) {
      updateNote(noteId, fields).catch((e) => {
        console.warn("[Editor] save failed", e);
        toast.show("Couldn't save change", "error");
      });
    }
  };

  const togglePin = () => {
    const v = isPinned ? 0 : 1;
    setIsPinned(v);
    patch({ isPinned: v });
    Haptics.selectionAsync();
  };
  const toggleFav = () => {
    const v = isFavorite ? 0 : 1;
    setIsFavorite(v);
    patch({ isFavorite: v });
    Haptics.selectionAsync();
  };
  const toggleArchive = () => {
    const v = isArchived ? 0 : 1;
    setIsArchived(v);
    patch({ isArchived: v });
    toast.show(v ? "Note archived" : "Note unarchived", "success");
  };

  const onChangeBody = (t: string) => {
    past.current.push(content);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    setCanUndo(true);
    setCanRedo(false);
    setContent(t);
  };
  const undo = () => {
    if (!past.current.length) return;
    future.current.push(content);
    const prev = past.current.pop()!;
    setContent(prev);
    setCanUndo(past.current.length > 0);
    setCanRedo(true);
  };
  const redo = () => {
    if (!future.current.length) return;
    past.current.push(content);
    const next = future.current.pop()!;
    setContent(next);
    setCanRedo(future.current.length > 0);
    setCanUndo(true);
  };

  const wrapSelection = (prefix: string, suffix: string) => {
    const { start, end } = selection.current;
    const s = Math.max(0, start);
    const e = Math.max(s, end);
    const sel = content.slice(s, e) || "text";
    const next = content.slice(0, s) + prefix + sel + suffix + content.slice(e);
    onChangeBody(next);
  };
  const prefixLine = (prefix: string) => {
    const { start } = selection.current;
    const before = content.slice(0, start);
    const lineStart = before.lastIndexOf("\n") + 1;
    const next = content.slice(0, lineStart) + prefix + content.slice(lineStart);
    onChangeBody(next);
  };

  // Checklist ops
  const addItem = async () => {
    if (!noteId) return;
    const it = await addChecklistItem(noteId, "", items.length);
    setItems((p) => [...p, it]);
  };
  const editItem = (id: string, text: string) => {
    setItems((p) => p.map((i) => (i.id === id ? { ...i, text } : i)));
    updateChecklistItem(id, { text });
  };
  const toggleItem = (id: string) => {
    setItems((p) => p.map((i) => (i.id === id ? { ...i, isCompleted: i.isCompleted ? 0 : 1 } : i)));
    const it = items.find((i) => i.id === id);
    if (it) updateChecklistItem(id, { isCompleted: it.isCompleted ? 0 : 1 });
  };
  const removeItem = async (id: string) => {
    await deleteChecklistItem(id);
    setItems((p) => p.filter((i) => i.id !== id));
  };
  const moveItem = async (index: number, dir: -1 | 1) => {
    const next = [...items];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    await reorderChecklist(next);
  };

  const convertToChecklist = async () => {
    if (!noteId) return;
    setMenuVisible(false);
    const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
    const existing = await getChecklist(noteId);
    for (const e of existing) await deleteChecklistItem(e.id);
    const created: ChecklistItem[] = [];
    let pos = 0;
    for (const line of lines.length ? lines : [""]) {
      const cleaned = line.replace(/^[-*]\s*\[[ xX]\]\s*/, "").replace(/^[-*]\s*/, "");
      created.push(await addChecklistItem(noteId, cleaned, pos++));
    }
    setItems(created);
    setContent("");
    setType("checklist");
    patch({ type: "checklist", content: "" });
  };
  const convertToText = async () => {
    if (!noteId) return;
    setMenuVisible(false);
    const text = items.map((i) => `${i.isCompleted ? "☑" : "☐"} ${i.text}`).join("\n");
    for (const i of items) await deleteChecklistItem(i.id);
    setItems([]);
    setContent((prev) => (prev ? prev + "\n" + text : text));
    setType("text");
    patch({ type: "text", content: content ? content + "\n" + text : text });
  };

  // Image handling
  const addImageFrom = async (source: "camera" | "library") => {
    setImageMenuVisible(false);
    try {
      let perm;
      if (source === "camera") perm = await ImagePicker.requestCameraPermissionsAsync();
      else perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          toast.show("Permission denied. Enable it in Settings.", "error");
          Linking.openSettings();
        } else {
          toast.show("Permission needed to add photos", "error");
        }
        return;
      }
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        quality: 0.8,
      };
      const res =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(opts)
          : await ImagePicker.launchImageLibraryAsync({ ...opts, allowsMultipleSelection: true, selectionLimit: 10 });
      if (res.canceled || !noteId) return;
      const newAtts: Attachment[] = [];
      for (const asset of res.assets) {
        const ext = extFromUri(asset.uri, "jpg");
        const saved = await copyIntoStore(asset.uri, ext);
        const att = await addAttachment(noteId, "image", saved.path, asset.fileName ?? null, saved.size, null);
        newAtts.push(att);
      }
      setAttachments((p) => [...p, ...newAtts]);
    } catch {
      toast.show("Could not add image", "error");
    }
  };

  const onVoiceSaved = async (uri: string, dur: number) => {
    if (!noteId) return;
    try {
      const ext = extFromUri(uri, "m4a");
      const saved = await copyIntoStore(uri, ext);
      const att = await addAttachment(noteId, "audio", saved.path, null, saved.size, dur);
      setAttachments((p) => [...p, att]);
      if (type === "text" && !content && !title) {
        setType("voice");
        patch({ type: "voice" });
      }
    } catch {
      toast.show("Could not save recording", "error");
    }
  };

  const removeAttachment = async (id: string) => {
    await deleteAttachment(id);
    setAttachments((p) => p.filter((a) => a.id !== id));
  };

  const doExport = async (fmt: ExportFormat) => {
    setExportVisible(false);
    if (!noteId) return;
    try {
      const n = await getNote(noteId);
      if (n) await exportNotes([n], fmt);
    } catch {
      toast.show("Export failed", "error");
    }
  };

  const noteIsEmpty = () => !buildNoteText({ title, content, type }, items);

  const doShareText = async () => {
    setShareVisible(false);
    if (noteIsEmpty()) {
      toast.show("Nothing to share yet", "info");
      return;
    }
    try {
      await shareNoteAsText({ title, content, type }, items);
    } catch (e) {
      console.warn("[Editor] share text failed", e);
      toast.show("Couldn't share note", "error");
    }
  };

  const doSharePicture = async () => {
    setShareVisible(false);
    if (noteIsEmpty()) {
      toast.show("Nothing to share yet", "info");
      return;
    }
    setSharing(true);
    try {
      // Give the offscreen share card a moment to lay out before capturing.
      await new Promise((r) => setTimeout(r, 80));
      const uri = await captureRef(shareCardRef, {
        format: "png",
        quality: 1,
        result: "tmpfile",
      });
      const ok = await shareImageFile(uri);
      if (!ok) toast.show("Sharing isn't available here", "error");
    } catch (e) {
      console.warn("[Editor] share picture failed", e);
      toast.show("Couldn't create image to share", "error");
    } finally {
      setSharing(false);
    }
  };

  const deleteNote = async () => {
    setConfirmDelete(false);
    setMenuVisible(false);
    if (noteId) {
      noteIdRef.current = null; // prevent discard/beforeRemove double-handling
      await trashNote(noteId);
      refresh();
    }
    router.back();
  };

  const images = attachments.filter((a) => a.type === "image");
  const audios = attachments.filter((a) => a.type === "audio");
  const drawings = attachments.filter((a) => a.type === "drawing");

  const displayItems = settings.completedToBottom
    ? [...items].sort((a, b) => a.isCompleted - b.isCompleted)
    : items;
  const doneCount = items.filter((i) => i.isCompleted).length;

  const bg = noteColorHex(color, c);

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: c.surface }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: bg, paddingTop: insets.top }}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable testID="editor-back" onPress={() => router.back()} style={styles.hBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={c.onSurface} />
        </Pressable>
        <View style={styles.hActions}>
          {type !== "checklist" && (
            <>
              <Pressable testID="editor-undo" onPress={undo} disabled={!canUndo} style={styles.hBtn}>
                <MaterialCommunityIcons name="undo" size={22} color={canUndo ? c.onSurface : c.muted} />
              </Pressable>
              <Pressable testID="editor-redo" onPress={redo} disabled={!canRedo} style={styles.hBtn}>
                <MaterialCommunityIcons name="redo" size={22} color={canRedo ? c.onSurface : c.muted} />
              </Pressable>
            </>
          )}
          <Pressable testID="editor-color" onPress={() => setColorVisible(true)} style={styles.hBtn}>
            <MaterialCommunityIcons name="palette-outline" size={22} color={c.onSurface} />
          </Pressable>
          <Pressable testID="editor-favorite" onPress={toggleFav} style={styles.hBtn}>
            <MaterialCommunityIcons name={isFavorite ? "heart" : "heart-outline"} size={22} color={isFavorite ? c.error : c.onSurface} />
          </Pressable>
          <Pressable testID="editor-pin" onPress={togglePin} style={styles.hBtn}>
            <MaterialCommunityIcons name={isPinned ? "pin" : "pin-outline"} size={22} color={isPinned ? c.brand : c.onSurface} />
          </Pressable>
          <Pressable testID="editor-menu" onPress={() => setMenuVisible(true)} style={styles.hBtn}>
            <MaterialCommunityIcons name="dots-vertical" size={22} color={c.onSurface} />
          </Pressable>
        </View>
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: 140 }]}
        bottomOffset={70}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TextInput
          testID="editor-title"
          value={title}
          onChangeText={setTitle}
          placeholder="Title"
          placeholderTextColor={c.muted}
          style={[styles.title, { color: c.onSurface }]}
          multiline
        />
        <Text style={[styles.meta, { color: c.muted }]}>
          {dayjs(updatedAt).format("MMM D, YYYY · h:mm A")}
          {doneCount || items.length ? `  ·  ${doneCount}/${items.length} completed` : ""}
        </Text>

        {type === "checklist" ? (
          <View style={styles.checklist}>
            {items.length > 0 && (
              <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
                <View style={[styles.progressFill, { backgroundColor: c.brand, width: `${items.length ? (doneCount / items.length) * 100 : 0}%` }]} />
              </View>
            )}
            {displayItems.map((it) => {
              const index = items.findIndex((i) => i.id === it.id);
              return (
                <View key={it.id} style={styles.itemRow}>
                  <Pressable testID={`check-toggle-${it.id}`} onPress={() => toggleItem(it.id)} style={styles.checkBox}>
                    <MaterialCommunityIcons
                      name={it.isCompleted ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"}
                      size={24}
                      color={it.isCompleted ? c.brand : c.muted}
                    />
                  </Pressable>
                  <TextInput
                    testID={`check-input-${it.id}`}
                    value={it.text}
                    onChangeText={(t) => editItem(it.id, t)}
                    placeholder="List item"
                    placeholderTextColor={c.muted}
                    style={[
                      styles.itemInput,
                      {
                        color: it.isCompleted ? c.muted : c.onSurface,
                        textDecorationLine: it.isCompleted ? "line-through" : "none",
                      },
                    ]}
                    multiline
                  />
                  <View style={styles.itemControls}>
                    <Pressable onPress={() => moveItem(index, -1)} testID={`check-up-${it.id}`}>
                      <MaterialCommunityIcons name="chevron-up" size={20} color={c.muted} />
                    </Pressable>
                    <Pressable onPress={() => moveItem(index, 1)} testID={`check-down-${it.id}`}>
                      <MaterialCommunityIcons name="chevron-down" size={20} color={c.muted} />
                    </Pressable>
                    <Pressable onPress={() => removeItem(it.id)} testID={`check-del-${it.id}`}>
                      <MaterialCommunityIcons name="close" size={18} color={c.muted} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
            <Pressable testID="add-check-item" onPress={addItem} style={styles.addItemRow}>
              <MaterialCommunityIcons name="plus" size={22} color={c.brand} />
              <Text style={[styles.addItemText, { color: c.brand }]}>Add item</Text>
            </Pressable>
          </View>
        ) : (
          <TextInput
            testID="editor-body"
            value={content}
            onChangeText={onChangeBody}
            onSelectionChange={(e) => (selection.current = e.nativeEvent.selection)}
            placeholder="Start writing..."
            placeholderTextColor={c.muted}
            style={[styles.body, { color: c.onSurface }]}
            multiline
            textAlignVertical="top"
          />
        )}

        {/* Attachments */}
        {images.length > 0 && (
          <View style={styles.imageGrid}>
            {images.map((a) => (
              <View key={a.id} style={[styles.thumb, { borderColor: c.border }]}>
                <Pressable
                  testID={`image-thumb-${a.id}`}
                  onPress={() => router.push({ pathname: "/image-viewer", params: { uri: a.localPath } })}
                  style={{ flex: 1 }}
                >
                  <Image source={{ uri: a.localPath }} style={{ flex: 1 }} contentFit="cover" />
                </Pressable>
                <Pressable testID={`remove-image-${a.id}`} onPress={() => removeAttachment(a.id)} style={[styles.thumbRemove, { backgroundColor: c.surfaceInverse }]}>
                  <MaterialCommunityIcons name="close" size={14} color={c.onSurfaceInverse} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {drawings.length > 0 && (
          <View style={styles.imageGrid}>
            {drawings.map((a) => (
              <DrawingThumb
                key={a.id}
                path={a.localPath}
                onRemove={() => removeAttachment(a.id)}
                onPress={() => router.push({ pathname: "/drawing", params: { noteId: noteId!, attachmentId: a.id } })}
              />
            ))}
          </View>
        )}

        {audios.length > 0 && (
          <View style={{ marginTop: 12 }}>
            {audios.map((a) => (
              <AudioPlayer key={a.id} uri={a.localPath} duration={a.duration} onDelete={() => removeAttachment(a.id)} />
            ))}
          </View>
        )}
      </KeyboardAwareScrollView>

      {/* Bottom toolbar */}
      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={[styles.toolbar, { backgroundColor: c.surfaceSecondary, borderColor: c.border, paddingBottom: insets.bottom > 0 ? insets.bottom : 8 }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbarRow} keyboardShouldPersistTaps="handled">
            {type !== "checklist" && (
              <>
                <ToolBtn icon="format-bold" onPress={() => wrapSelection("**", "**")} c={c} tid="fmt-bold" />
                <ToolBtn icon="format-italic" onPress={() => wrapSelection("*", "*")} c={c} tid="fmt-italic" />
                <ToolBtn icon="format-underline" onPress={() => wrapSelection("<u>", "</u>")} c={c} tid="fmt-underline" />
                <ToolBtn icon="format-strikethrough" onPress={() => wrapSelection("~~", "~~")} c={c} tid="fmt-strike" />
                <ToolBtn icon="format-header-pound" onPress={() => prefixLine("# ")} c={c} tid="fmt-heading" />
                <ToolBtn icon="format-list-bulleted" onPress={() => prefixLine("- ")} c={c} tid="fmt-bullet" />
                <ToolBtn icon="format-list-numbered" onPress={() => prefixLine("1. ")} c={c} tid="fmt-number" />
                <ToolBtn icon="marker" onPress={() => wrapSelection("==", "==")} c={c} tid="fmt-highlight" />
                <View style={[styles.toolDivider, { backgroundColor: c.border }]} />
              </>
            )}
            <ToolBtn icon="image-plus" onPress={() => setImageMenuVisible(true)} c={c} tid="attach-image" />
            <ToolBtn icon="microphone-plus" onPress={() => setVoiceVisible(true)} c={c} tid="attach-voice" />
            <ToolBtn icon="draw" onPress={() => router.push({ pathname: "/drawing", params: { noteId: noteId! } })} c={c} tid="attach-drawing" />
          </ScrollView>
        </View>
      </KeyboardStickyView>

      {/* Sheets */}
      <ColorPickerSheet
        visible={colorVisible}
        current={color}
        onSelect={(k) => { setColor(k); patch({ color: k }); }}
        onClose={() => setColorVisible(false)}
      />

      <FolderPickerSheet
        visible={folderVisible}
        currentFolderId={folderId}
        onSelect={(fid) => { setFolderId(fid); patch({ folderId: fid }); toast.show("Note moved", "success"); }}
        onClose={() => setFolderVisible(false)}
      />

      {noteId && (
        <LabelPickerSheet
          visible={labelVisible}
          noteId={noteId}
          onClose={() => setLabelVisible(false)}
          onChanged={() => { setLabelVersion((v) => v + 1); refresh(); }}
        />
      )}

      <VoiceRecorderSheet visible={voiceVisible} onClose={() => setVoiceVisible(false)} onSaved={onVoiceSaved} />

      <BottomSheet visible={imageMenuVisible} onClose={() => setImageMenuVisible(false)} title="Add image" testID="image-menu">
        <Pressable testID="image-camera" onPress={() => addImageFrom("camera")} style={styles.menuRow}>
          <MaterialCommunityIcons name="camera-outline" size={22} color={c.brand} />
          <Text style={[styles.menuText, { color: c.onSurface }]}>Take a photo</Text>
        </Pressable>
        <Pressable testID="image-library" onPress={() => addImageFrom("library")} style={styles.menuRow}>
          <MaterialCommunityIcons name="image-multiple-outline" size={22} color={c.brand} />
          <Text style={[styles.menuText, { color: c.onSurface }]}>Choose from gallery</Text>
        </Pressable>
      </BottomSheet>

      <BottomSheet visible={menuVisible} onClose={() => setMenuVisible(false)} title="Options" testID="editor-options">
        <Pressable testID="opt-folder" onPress={() => { setMenuVisible(false); setFolderVisible(true); }} style={styles.menuRow}>
          <MaterialCommunityIcons name="folder-move-outline" size={22} color={c.onSurfaceTertiary} />
          <Text style={[styles.menuText, { color: c.onSurface }]}>Move to folder</Text>
        </Pressable>
        <Pressable testID="opt-labels" onPress={() => { setMenuVisible(false); setLabelVisible(true); }} style={styles.menuRow}>
          <MaterialCommunityIcons name="tag-outline" size={22} color={c.onSurfaceTertiary} />
          <Text style={[styles.menuText, { color: c.onSurface }]}>Labels</Text>
        </Pressable>
        <Pressable testID="opt-archive" onPress={() => { setMenuVisible(false); toggleArchive(); }} style={styles.menuRow}>
          <MaterialCommunityIcons name={isArchived ? "archive-arrow-up-outline" : "archive-arrow-down-outline"} size={22} color={c.onSurfaceTertiary} />
          <Text style={[styles.menuText, { color: c.onSurface }]}>{isArchived ? "Unarchive" : "Archive"}</Text>
        </Pressable>
        {type === "checklist" ? (
          <Pressable testID="opt-to-text" onPress={convertToText} style={styles.menuRow}>
            <MaterialCommunityIcons name="text" size={22} color={c.onSurfaceTertiary} />
            <Text style={[styles.menuText, { color: c.onSurface }]}>Convert to text note</Text>
          </Pressable>
        ) : (
          <Pressable testID="opt-to-checklist" onPress={convertToChecklist} style={styles.menuRow}>
            <MaterialCommunityIcons name="checkbox-marked-outline" size={22} color={c.onSurfaceTertiary} />
            <Text style={[styles.menuText, { color: c.onSurface }]}>Convert to checklist</Text>
          </Pressable>
        )}
        <Pressable testID="opt-share" onPress={() => { setMenuVisible(false); router.push({ pathname: "/share", params: { title: title || "Untitled", body: buildNoteText({ title, content, type }, items), kind: "note" } }); }} style={styles.menuRow}>
          <MaterialCommunityIcons name="share-variant-outline" size={22} color={c.onSurfaceTertiary} />
          <Text style={[styles.menuText, { color: c.onSurface }]}>Share note</Text>
        </Pressable>
        <Pressable testID="opt-export" onPress={() => { setMenuVisible(false); setExportVisible(true); }} style={styles.menuRow}>
          <MaterialCommunityIcons name="export-variant" size={22} color={c.onSurfaceTertiary} />
          <Text style={[styles.menuText, { color: c.onSurface }]}>Export</Text>
        </Pressable>
        <Pressable testID="opt-delete" onPress={() => { setMenuVisible(false); setConfirmDelete(true); }} style={styles.menuRow}>
          <MaterialCommunityIcons name="trash-can-outline" size={22} color={c.error} />
          <Text style={[styles.menuText, { color: c.error }]}>Move to trash</Text>
        </Pressable>
      </BottomSheet>

      <BottomSheet visible={exportVisible} onClose={() => setExportVisible(false)} title="Export as" testID="editor-export-sheet">
        {(["txt", "md", "pdf"] as ExportFormat[]).map((fmt) => (
          <Pressable key={fmt} testID={`editor-export-${fmt}`} onPress={() => doExport(fmt)} style={styles.menuRow}>
            <MaterialCommunityIcons name={fmt === "pdf" ? "file-pdf-box" : fmt === "md" ? "language-markdown" : "file-document-outline"} size={22} color={c.brand} />
            <Text style={[styles.menuText, { color: c.onSurface }]}>{fmt.toUpperCase()}</Text>
          </Pressable>
        ))}
      </BottomSheet>

      <BottomSheet visible={shareVisible} onClose={() => setShareVisible(false)} title="Share note" testID="editor-share-sheet">
        <Pressable testID="share-as-text" onPress={doShareText} style={styles.menuRow}>
          <MaterialCommunityIcons name="text-box-outline" size={22} color={c.brand} />
          <Text style={[styles.menuText, { color: c.onSurface }]}>Share as text</Text>
        </Pressable>
        <Pressable testID="share-as-picture" onPress={doSharePicture} style={styles.menuRow}>
          <MaterialCommunityIcons name="image-outline" size={22} color={c.brand} />
          <Text style={[styles.menuText, { color: c.onSurface }]}>Share as picture</Text>
        </Pressable>
        <Pressable testID="share-as-markdown" onPress={() => { setShareVisible(false); doExport("md"); }} style={styles.menuRow}>
          <MaterialCommunityIcons name="language-markdown" size={22} color={c.brand} />
          <Text style={[styles.menuText, { color: c.onSurface }]}>Export as Markdown</Text>
        </Pressable>
      </BottomSheet>

      <ConfirmSheet
        visible={confirmDelete}
        title="Move to trash?"
        message="You can restore it from Trash later."
        confirmLabel="Move to trash"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={deleteNote}
      />

      {sharing && (
        <View style={styles.sharingOverlay} pointerEvents="auto">
          <View style={[styles.sharingBox, { backgroundColor: c.surfaceSecondary }]}>
            <ActivityIndicator color={c.brand} />
            <Text style={[styles.sharingText, { color: c.onSurface }]}>Preparing image…</Text>
          </View>
        </View>
      )}


      {/* Offscreen card rendered only to capture the note as a shareable image. */}
      <View style={styles.shareCardWrap} pointerEvents="none">
        <View ref={shareCardRef} collapsable={false} style={[styles.shareCard, { backgroundColor: bg }]}>          <View style={styles.shareCardHeader}>
            <View style={[styles.shareLogo, { backgroundColor: c.brand }]}>
              <MaterialCommunityIcons name="notebook" size={16} color={c.onBrand} />
            </View>
            <Text style={[styles.shareBrand, { color: c.muted }]}>Notes</Text>
          </View>
          {title.trim() ? (
            <Text style={[styles.shareTitle, { color: c.onSurface }]}>{title.trim()}</Text>
          ) : null}
          {type === "checklist"
            ? items
                .filter((i) => i.text.trim())
                .map((i) => (
                  <View key={i.id} style={styles.shareCheckRow}>
                    <MaterialCommunityIcons
                      name={i.isCompleted ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"}
                      size={18}
                      color={i.isCompleted ? c.brand : c.muted}
                    />
                    <Text
                      style={[
                        styles.shareCheckText,
                        {
                          color: i.isCompleted ? c.muted : c.onSurface,
                          textDecorationLine: i.isCompleted ? "line-through" : "none",
                        },
                      ]}
                    >
                      {i.text.trim()}
                    </Text>
                  </View>
                ))
            : content.trim()
              ? <Text style={[styles.shareBody, { color: c.onSurface }]}>{content.trim()}</Text>
              : null}
          <Text style={[styles.shareFooter, { color: c.muted }]}>{dayjs(updatedAt).format("MMM D, YYYY")}</Text>
        </View>
      </View>
    </View>
  );
}

function ToolBtn({ icon, onPress, c, tid }: { icon: any; onPress: () => void; c: any; tid: string }) {
  return (
    <Pressable testID={tid} onPress={onPress} style={styles.toolBtn}>
      <MaterialCommunityIcons name={icon} size={22} color={c.onSurface} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    height: 52,
  },
  hBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  hActions: { flexDirection: "row", alignItems: "center" },
  content: { paddingHorizontal: 20, paddingTop: 8 },
  title: { fontSize: 24, fontWeight: "800", padding: 0, marginBottom: 4 },
  meta: { fontSize: 12, marginBottom: 16 },
  body: { fontSize: 16, lineHeight: 24, padding: 0, minHeight: 200 },
  checklist: { marginTop: 4 },
  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden", marginBottom: 16 },
  progressFill: { height: 4, borderRadius: 2 },
  itemRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 6 },
  checkBox: { paddingTop: 4 },
  itemInput: { flex: 1, fontSize: 16, paddingVertical: 4, minHeight: 32 },
  itemControls: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 6 },
  addItemRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, marginTop: 4 },
  addItemText: { fontSize: 15, fontWeight: "600" },
  imageGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
  thumb: { width: 100, height: 100, borderRadius: 12, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  thumbRemove: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  toolbar: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  toolbarRow: { paddingHorizontal: 12, gap: 4, alignItems: "center" },
  toolBtn: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  toolDivider: { width: StyleSheet.hairlineWidth, height: 26, marginHorizontal: 6 },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14 },
  menuText: { fontSize: 15, fontWeight: "500" },
  shareCardWrap: { position: "absolute", left: -10000, top: 0, width: 360 },
  shareCard: { width: 360, padding: 24 },
  shareCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  shareLogo: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  shareBrand: { fontSize: 14, fontWeight: "700" },
  shareTitle: { fontSize: 22, fontWeight: "800", marginBottom: 12 },
  shareBody: { fontSize: 16, lineHeight: 24 },
  shareCheckRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 },
  shareCheckText: { flex: 1, fontSize: 16, lineHeight: 22 },
  shareFooter: { fontSize: 12, marginTop: 20 },
  sharingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.25)",
    zIndex: 2000,
  },
  sharingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderRadius: 16,
  },
  sharingText: { fontSize: 15, fontWeight: "600" },
});