import { api } from "./api";

export type CourseLevel = "beginner" | "intermediate" | "advanced" | "next-step";
export type LessonType = "concept" | "project" | "challenge";

export interface CourseLesson {
  title: string;
  type: LessonType;
}

export interface Course {
  id: number;
  code: string;
  title: string;
  description: string;
  level: CourseLevel;
  lessons?: number;
  duration: string;
  buildCount?: number;
  stack?: string[];
  ribbon?: string;
  pin?: string;
  what?: string;
  learns?: string[];
  prerequisites?: string[];
  curriculum?: CourseLesson[];
}

interface BECourse {
  id: number;
  name: string;
  category: string[];
  tagId: number | null;
  enrolNum: number;
  coverImg: string;
  level: "beginner" | "intermediate" | "expert";
  description: string;
  lessonCount: number;
}

function mapCourse(c: BECourse): Course {
  const levelMap: Record<BECourse["level"], CourseLevel> = {
    beginner: "beginner",
    intermediate: "intermediate",
    expert: "advanced",
  };
  return {
    id: c.id,
    code: String(c.id),
    title: c.name,
    description: c.description,
    level: levelMap[c.level],
    lessons: c.lessonCount,
    duration: "",
    buildCount: c.enrolNum,
    stack: c.category,
  };
}

export interface LearningPathStep {
  num: string;
  title: string;
  meta: string;
  status?: "complete" | "current" | "upcoming";
}

const MOCK_PATH: LearningPathStep[] = [
  { num: "STEP 01", title: "Hash a password, properly", meta: "argon2id · 12 min", status: "complete" },
  { num: "STEP 02", title: "Sessions vs. tokens", meta: "concept · 8 min", status: "complete" },
  { num: "STEP 03", title: "Build the OTP system", meta: "project · 45 min", status: "current" },
  { num: "STEP 04", title: "JWT signing & rotation", meta: "concept · 14 min" },
  { num: "STEP 05", title: "Add 3rd-party login (OAuth 2.1)", meta: "project · 60 min" },
  { num: "STEP 06", title: "Ship: rate-limit your auth", meta: "project · 30 min" },
];

export async function getFeaturedCourses(): Promise<Course[]> {
  const courses = await api.get<BECourse[]>("/api/v1/courses/");
  return courses.map(mapCourse);
}

export async function getRecommendedCourses(): Promise<Course[]> {
  return [];
}

export async function getLearningPath(): Promise<LearningPathStep[]> {
  return MOCK_PATH;
}
