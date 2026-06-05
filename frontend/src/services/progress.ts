import { api } from "./api";

export interface CourseProgress {
  courseId: number;
  completedLessonIds: number[];
  activeLessonId: number | null;
  placedNodeIds: string[];
  enrolledAt: string;
}

export interface ProgressPatch {
  activeLessonId?: number | null;
  placedNodeIds?: string[];
}

export async function getCourseProgress(courseId: number): Promise<CourseProgress | null> {
  try {
    return await api.get<CourseProgress>(`/api/v1/progress/courses/${courseId}`);
  } catch (err) {
    if (err instanceof Error && /\(404\)|No progress/i.test(err.message)) return null;
    throw err;
  }
}

export async function enrollInCourse(courseId: number): Promise<CourseProgress> {
  return api.post<CourseProgress>(`/api/v1/progress/courses/${courseId}/enroll`);
}

export async function updateProgress(
  courseId: number,
  patch: ProgressPatch,
): Promise<CourseProgress> {
  return api.patch<CourseProgress>(`/api/v1/progress/courses/${courseId}`, patch);
}

export async function completeLesson(
  courseId: number,
  lessonId: number,
): Promise<CourseProgress> {
  return api.post<CourseProgress>(
    `/api/v1/progress/courses/${courseId}/lessons/${lessonId}/complete`,
  );
}

export async function resetProgress(courseId: number): Promise<void> {
  await api.delete<void>(`/api/v1/progress/courses/${courseId}`);
}
