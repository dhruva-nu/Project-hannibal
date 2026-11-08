import { api } from "./api";

export type Port = "l" | "r" | "t" | "b";

export interface CourseModule { id: string; label: string; }
export interface CourseNodeDef {
  kind: "node" | "service";
  x: number; y: number; label: string;
  modules?: CourseModule[];
}
export interface CourseEdgeDef {
  id: string; from: string; to: string;
  fromPort: Port; toPort: Port; fromMod?: string;
}
export interface LessonTheory { tag: string; body: string; }
export interface LessonAdds { nodes: string[]; edges: string[]; modules: string[]; }
export interface Lesson {
  id: string; num: string; title: string; meta: string;
  nosqlId: string;
  theory: LessonTheory; adds: LessonAdds; addsExtra?: { nodes: string[] };
}

export interface CourseContent {
  nodes: Record<string, CourseNodeDef>;
  edges: CourseEdgeDef[];
  lessons: Lesson[];
}

interface BELesson {
  id: number;
  courseId: number;
  name: string;
  learning: string;
  nosqlId: string;
  order: number;
}

function mapLesson(l: BELesson): Lesson {
  return {
    id: String(l.id),
    num: String(l.order).padStart(2, "0"),
    title: l.name,
    meta: `theory · ${l.learning.slice(0, 40)}`,
    nosqlId: l.nosqlId,
    theory: { tag: "theory", body: `<p>${l.learning}</p>` },
    adds: { nodes: [], edges: [], modules: [] },
  };
}

export async function getCourseContent(courseId: number): Promise<CourseContent> {
  const lessons = await api.get<BELesson[]>(`/api/v1/lessons/course/${courseId}`);
  const sorted = [...lessons].sort((a, b) => a.order - b.order);
  return {
    nodes: {},
    edges: [],
    lessons: sorted.map(mapLesson),
  };
}
