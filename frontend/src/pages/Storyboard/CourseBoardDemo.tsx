import type { CourseContent } from "@/services/courseDetail";
import { useCourseState } from "@/pages/CoursePage/useCourseState";
import { CourseBoard } from "@/shared/components";

export const CourseBoardDemo = ({ content }: { content: CourseContent }) => {
  const course = useCourseState(content);
  return <CourseBoard course={course} />;
};
