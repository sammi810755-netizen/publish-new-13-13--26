import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";

import { useTheme } from "@/src/context/AppContext";
import { useToast } from "@/src/components/Toast";
import { BottomSheet } from "@/src/components/Sheet";
import {
  createTask,
  deleteTask,
  listTasks,
  updateTask,
} from "@/src/db/workspace-store";
import { Task, TaskPriority, TaskStatus } from "@/src/db/workspace-types";
import { scheduleReminder, reminderSupported } from "@/src/lib/reminders";

type Mode = "month" | "week" | "day" | "agenda";
const PRIORITY_COLORS: Record<TaskPriority, string> = { low: "#3B82F6", medium: "#F59E0B", high: "#F97316", urgent: "#EF4444" };

export default function Calendar() {
  const c = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>("month");
  const [cursor, setCursor] = useState(new Date());
  const [selected, setSelected] = useState(new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editor, setEditor] = useState<Task | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const load = useCallback(async () => {
    setTasks(await listTasks());
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const tasksByDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const key = t.dueDate.slice(0, 10);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(t);
    }
    return m;
  }, [tasks]);

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const openNew = () => {
    setDraftTitle("");
    setEditor({
      id: "", title: "", status: "todo", priority: "medium",
      dueDate: format(selected, "yyyy-MM-dd"), time: null, tags: [],
      projectId: null, relatedPageId: null, relatedNoteId: null,
      reminderAt: null, notificationId: null, createdAt: "", updatedAt: "", isDeleted: 0,
    });
  };

  const saveTask = async () => {
    if (!editor) return;
    const title = draftTitle.trim() || "Untitled task";
    try {
      if (editor.id) {
        await updateTask(editor.id, { title, status: editor.status, priority: editor.priority, dueDate: editor.dueDate, time: editor.time });
        toast.show("Task saved", "success");
      } else {
        const t = await createTask({ title, status: editor.status, priority: editor.priority, dueDate: editor.dueDate, time: editor.time });
        let reminderMsg = "";
        if (t.dueDate && reminderSupported()) {
          const when = new Date(`${t.dueDate}T${t.time ?? "09:00"}:00`);
          if (when.getTime() > Date.now()) {
            const nid = await scheduleReminder("Task due", title, when);
            if (nid) {
              await updateTask(t.id, { reminderAt: when.toISOString(), notificationId: nid });
              reminderMsg = " \u2022 reminder set";
            } else {
              reminderMsg = " \u2022 enable notifications for reminders";
            }
          }
        }
        toast.show(`Task saved${reminderMsg}`, "success");
      }
      setEditor(null);
      load();
    } catch (e) {
      console.warn("[calendar] saveTask failed", e);
      toast.show("Couldn't save task. Please try again.", "error");
    }
  };

  const cycleStatus = async (t: Task) => {
    const next: TaskStatus = t.status === "todo" ? "inprogress" : t.status === "inprogress" ? "done" : "todo";
    await updateTask(t.id, { status: next });
    load();
  };

  const dayTasks = (d: Date) => tasksByDay.get(format(d, "yyyy-MM-dd")) ?? [];

  const agendaTasks = useMemo(() => {
    if (mode === "day") return dayTasks(selected);
    if (mode === "week") {
      const s = startOfWeek(selected, { weekStartsOn: 0 });
      const days = eachDayOfInterval({ start: s, end: addDays(s, 6) });
      return days.flatMap((d) => dayTasks(d));
    }
    return tasks.filter((t) => t.dueDate).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  }, [mode, selected, tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ flex: 1, backgroundColor: c.surface, paddingTop: insets.top }}>
      <View style={styles.top}>
        <Pressable testID="cal-back" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={c.onSurface} />
        </Pressable>
        <Text style={[styles.heading, { color: c.onSurface }]}>Calendar</Text>
        <Pressable testID="cal-new" onPress={openNew} style={styles.iconBtn} hitSlop={8}>
          <MaterialCommunityIcons name="plus" size={24} color={c.onSurface} />
        </Pressable>
      </View>

      <View style={styles.modeRow}>
        {(["month", "week", "day", "agenda"] as Mode[]).map((m) => (
          <Pressable key={m} testID={`mode-${m}`} onPress={() => setMode(m)} style={[styles.modeBtn, { backgroundColor: mode === m ? c.brandTertiary : "transparent", borderColor: mode === m ? c.brand : c.border }]}>
            <Text style={[styles.modeText, { color: mode === m ? c.brand : c.onSurfaceTertiary }]}>{m[0].toUpperCase() + m.slice(1)}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {mode === "month" && (
          <View style={styles.calWrap}>
            <View style={styles.monthNav}>
              <Pressable testID="prev-month" onPress={() => setCursor(addDays(startOfMonth(cursor), -1))} hitSlop={8}><MaterialCommunityIcons name="chevron-left" size={24} color={c.onSurface} /></Pressable>
              <Text style={[styles.monthLabel, { color: c.onSurface }]}>{format(cursor, "MMMM yyyy")}</Text>
              <Pressable testID="next-month" onPress={() => setCursor(addDays(endOfMonth(cursor), 1))} hitSlop={8}><MaterialCommunityIcons name="chevron-right" size={24} color={c.onSurface} /></Pressable>
            </View>
            <View style={styles.weekHeader}>
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <Text key={i} style={[styles.weekHeaderText, { color: c.muted }]}>{d}</Text>)}
            </View>
            <View style={styles.grid}>
              {monthDays.map((d) => {
                const isSel = isSameDay(d, selected);
                const dim = !isSameMonth(d, cursor);
                const dts = dayTasks(d);
                return (
                  <Pressable key={d.toISOString()} testID={`day-${format(d, "yyyy-MM-dd")}`} onPress={() => { setSelected(d); }} style={[styles.dayCell, isSel && { backgroundColor: c.brandTertiary, borderRadius: 10 }]}>
                    <Text style={[styles.dayNum, { color: dim ? c.muted : c.onSurface }, isSel && { color: c.brand, fontWeight: "800" }]}>{format(d, "d")}</Text>
                    <View style={styles.dots}>
                      {dts.slice(0, 3).map((t) => <View key={t.id} style={[styles.dot, { backgroundColor: PRIORITY_COLORS[t.priority] }]} />)}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.agendaHeader, { color: c.muted }]}>{format(selected, "EEEE, MMM d").toUpperCase()}</Text>
            {dayTasks(selected).length === 0 ? <Text style={[styles.empty, { color: c.muted }]}>No tasks. Tap + to add.</Text> : dayTasks(selected).map((t) => <TaskRow key={t.id} t={t} c={c} onToggle={() => cycleStatus(t)} onOpen={() => { setEditor(t); setDraftTitle(t.title); }} onDelete={async () => { await deleteTask(t.id); load(); }} />)}
          </View>
        )}
        {mode !== "month" && (
          <View style={{ padding: 16 }}>
            <Text style={[styles.agendaHeader, { color: c.muted }]}>{mode === "day" ? format(selected, "EEEE, MMM d").toUpperCase() : mode === "week" ? "THIS WEEK" : "ALL UPCOMING"}</Text>
            {agendaTasks.length === 0 ? <Text style={[styles.empty, { color: c.muted }]}>No tasks.</Text> : agendaTasks.map((t) => <TaskRow key={t.id} t={t} c={c} showDate onToggle={() => cycleStatus(t)} onOpen={() => { setEditor(t); setDraftTitle(t.title); }} onDelete={async () => { await deleteTask(t.id); load(); }} />)}
          </View>
        )}
      </ScrollView>

      <BottomSheet visible={!!editor} onClose={() => setEditor(null)} title={editor?.id ? "Edit task" : "New task"} testID="task-editor">
        {editor && (
          <View>
            <TextInput testID="task-title" value={draftTitle} onChangeText={setDraftTitle} placeholder="Task title" placeholderTextColor={c.muted} style={[styles.input, { color: c.onSurface, borderColor: c.border }]} autoFocus />
            <Text style={[styles.fieldLabel, { color: c.muted }]}>DATE</Text>
            <TextInput testID="task-date" value={editor.dueDate ?? ""} onChangeText={(v) => setEditor({ ...editor, dueDate: v })} placeholder="yyyy-mm-dd" placeholderTextColor={c.muted} style={[styles.input, { color: c.onSurface, borderColor: c.border }]} />
            <Text style={[styles.fieldLabel, { color: c.muted }]}>PRIORITY</Text>
            <View style={styles.optionRow}>
              {(["low", "medium", "high", "urgent"] as TaskPriority[]).map((p) => (
                <Pressable key={p} testID={`prio-${p}`} onPress={() => setEditor({ ...editor, priority: p })} style={[styles.opt, { borderColor: editor.priority === p ? PRIORITY_COLORS[p] : c.border, backgroundColor: editor.priority === p ? c.brandTertiary : "transparent" }]}>
                  <Text style={[styles.optText, { color: editor.priority === p ? c.onSurface : c.muted }]}>{p}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.fieldLabel, { color: c.muted }]}>STATUS</Text>
            <View style={styles.optionRow}>
              {(["todo", "inprogress", "done"] as TaskStatus[]).map((s) => (
                <Pressable key={s} testID={`status-${s}`} onPress={() => setEditor({ ...editor, status: s })} style={[styles.opt, { borderColor: editor.status === s ? c.brand : c.border, backgroundColor: editor.status === s ? c.brandTertiary : "transparent" }]}>
                  <Text style={[styles.optText, { color: editor.status === s ? c.onSurface : c.muted }]}>{s}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable testID="task-save" onPress={saveTask} style={[styles.saveBtn, { backgroundColor: c.brand }]}>
              <Text style={[styles.saveText, { color: c.onBrand }]}>Save</Text>
            </Pressable>
          </View>
        )}
      </BottomSheet>
    </View>
  );
}

function TaskRow({ t, c, onToggle, onOpen, onDelete, showDate }: any) {
  const icon = t.status === "done" ? "checkbox-marked-circle" : t.status === "inprogress" ? "progress-clock" : "checkbox-blank-circle-outline";
  return (
    <View style={[styles.taskRow, { borderColor: c.border, backgroundColor: c.surfaceSecondary }]}>
      <Pressable testID={`task-toggle-${t.id}`} onPress={onToggle} hitSlop={8}><MaterialCommunityIcons name={icon} size={22} color={t.status === "done" ? c.success : c.brand} /></Pressable>
      <Pressable testID={`task-open-${t.id}`} onPress={onOpen} style={{ flex: 1 }}>
        <Text style={[styles.taskTitle, { color: c.onSurface }, t.status === "done" && { textDecorationLine: "line-through", color: c.muted }]}>{t.title}</Text>
        <Text style={[styles.taskMeta, { color: c.muted }]}>{[showDate && t.dueDate, t.priority].filter(Boolean).join(" \u00B7 ")}</Text>
      </Pressable>
      <View style={[styles.prioDot, { backgroundColor: PRIORITY_COLORS[t.priority] }]} />
      <Pressable testID={`task-del-${t.id}`} onPress={onDelete} hitSlop={8}><MaterialCommunityIcons name="trash-can-outline" size={18} color={c.muted} /></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 8 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  heading: { flex: 1, fontSize: 22, fontWeight: "800", marginLeft: 4 },
  modeRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  modeBtn: { flex: 1, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  modeText: { fontSize: 13, fontWeight: "700" },
  calWrap: { paddingHorizontal: 12 },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 8 },
  monthLabel: { fontSize: 17, fontWeight: "800" },
  weekHeader: { flexDirection: "row" },
  weekHeaderText: { flex: 1, textAlign: "center", fontSize: 12, fontWeight: "700", paddingVertical: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center", paddingTop: 4 },
  dayNum: { fontSize: 14, fontWeight: "600" },
  dots: { flexDirection: "row", gap: 2, marginTop: 3, height: 6 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  agendaHeader: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, marginTop: 14, marginBottom: 8, paddingHorizontal: 4 },
  empty: { fontSize: 14, paddingHorizontal: 4, paddingVertical: 8 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, marginBottom: 8 },
  taskTitle: { fontSize: 15, fontWeight: "600" },
  taskMeta: { fontSize: 12, marginTop: 2 },
  prioDot: { width: 8, height: 8, borderRadius: 4 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 6 },
  fieldLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginTop: 10, marginBottom: 6 },
  optionRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  opt: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  optText: { fontSize: 13, fontWeight: "600", textTransform: "capitalize" },
  saveBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 18 },
  saveText: { fontSize: 15, fontWeight: "700" },
});
