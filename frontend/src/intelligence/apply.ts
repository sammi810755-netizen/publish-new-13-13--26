// Non-destructive write helpers for conversions & suggestions. These create
// NEW notes/tasks/labels so the user's original content is never overwritten.
import { createNote, updateNote, addChecklistItem, listLabels, createLabel, getNoteLabels, setNoteLabels } from "@/src/db/repo";
import { createTask } from "@/src/db/workspace-store";
import type { DetectedTask } from "./relations";
import type { Flashcard } from "./text-ops";

export async function createTextNote(title: string, content: string): Promise<string> {
  const n = await createNote({ type: "text", title: title.slice(0, 120) });
  await updateNote(n.id, { title: title.slice(0, 120), content });
  return n.id;
}

export async function createChecklistNote(title: string, items: string[]): Promise<string> {
  const n = await createNote({ type: "checklist", title: title.slice(0, 120) });
  let pos = 0;
  for (const it of items) {
    const text = it.trim();
    if (text) await addChecklistItem(n.id, text, pos++);
  }
  return n.id;
}

export async function createFlashcardNote(title: string, cards: Flashcard[]): Promise<string> {
  const body = cards.map((c, i) => `Card ${i + 1}\nQ: ${c.front}\nA: ${c.back}`).join("\n\n");
  return createTextNote(`${title} \u2014 Flashcards`, body);
}

export async function createTasksFromDetected(tasks: DetectedTask[]): Promise<number> {
  let created = 0;
  for (const t of tasks) {
    await createTask({
      title: t.task.slice(0, 200),
      priority: t.priority,
      dueDate: t.date?.iso ?? null,
      time: t.time ?? null,
      status: "todo",
    });
    created++;
  }
  return created;
}

// Apply a tag/label to an existing note (merges, never removes existing).
export async function applyTagToNote(noteId: string, tagName: string): Promise<void> {
  const name = tagName.trim();
  if (!name) return;
  const labels = await listLabels();
  let label = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (!label) label = await createLabel(name);
  const current = await getNoteLabels(noteId);
  const ids = Array.from(new Set([...current.map((l) => l.id), label.id]));
  await setNoteLabels(noteId, ids);
}
