import { api } from "./api";

export type LessonKind = "theory" | "build";
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
export interface TestCase { name: string; check: (code: string) => boolean; }
export interface LessonCode { file: string; starter: string; tests: TestCase[]; }
export interface LessonTheory { tag: string; body: string; }
export interface LessonDrag { kind: "node" | "module"; id: string; parent?: string; label: string; scribble: string; }
export interface LessonTarget { type: "empty" | "service"; serviceId?: string; }
export interface LessonAdds { nodes: string[]; edges: string[]; modules: string[]; }
export interface Lesson {
  id: string; num: string; kind: LessonKind; title: string; meta: string;
  nosqlId: string;
  theory?: LessonTheory; drag?: LessonDrag; target?: LessonTarget;
  code?: LessonCode; adds: LessonAdds; addsExtra?: { nodes: string[] };
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
  lessonType: "learn" | "build";
  order: number;
}

function mapLesson(l: BELesson): Lesson {
  const kind: LessonKind = l.lessonType === "learn" ? "theory" : "build";
  return {
    id: String(l.id),
    num: String(l.order).padStart(2, "0"),
    kind,
    title: l.name,
    meta: kind === "theory" ? `theory · ${l.learning.slice(0, 40)}` : `build`,
    nosqlId: l.nosqlId,
    theory: kind === "theory" ? { tag: "theory", body: `<p>${l.learning}</p>` } : undefined,
    adds: { nodes: [], edges: [], modules: [] },
  };
}

export interface BuildBlockInfo {
  id: string;
  tests: { name: string; description: string }[];
}

export async function getBuildBlock(blockId: string): Promise<BuildBlockInfo> {
  return api.get<BuildBlockInfo>(`/api/v1/build-blocks/${blockId}`);
}

export async function translateBuildBlock(blockId: string, language: string): Promise<string> {
  const result = await api.get<{ code: string }>(
    `/api/v1/build-blocks/${blockId}/translate?language=${encodeURIComponent(language)}`,
  );
  return result.code;
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
