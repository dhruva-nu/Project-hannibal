import type { Lesson } from "@/services/courseDetail";

export function isLessonUnlocked(lessons: Lesson[], idx: number, completed: Set<string>): boolean {
  if (idx === 0) return true;
  return completed.has(lessons[idx - 1].id);
}

export interface RevealedBoard {
  nodes: Set<string>;
  edges: Set<string>;
  mods: Set<string>;
}

export function computeRevealed(lessons: Lesson[], completed: Set<string>): RevealedBoard {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  const mods = new Set<string>();
  lessons.forEach(l => {
    if (!completed.has(l.id)) return;
    (l.adds.nodes || []).forEach(n => nodes.add(n));
    (l.adds.edges || []).forEach(e => edges.add(e));
    (l.adds.modules || []).forEach(m => mods.add(m));
    if (l.addsExtra) (l.addsExtra.nodes || []).forEach(n => nodes.add(n));
  });
  return { nodes, edges, mods };
}
