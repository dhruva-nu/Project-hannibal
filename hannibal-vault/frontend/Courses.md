# Courses

**File:** `frontend/src/pages/Courses/Courses.tsx`  
**Route:** `/courses`

Course catalogue. Fetches featured courses, recommended courses, and learning path on mount. Shows a filter bar, AI prompt bar, and opens a `CourseModal` on card click.

## Functions

| Function | Lines | Notes |
|----------|-------|-------|
| `Courses` (component) | 185–399 | Page shell — mounts data fetches, manages filter + modal state |
| `toCardProps` | 160–164 | Attaches inline SVG illustration to a course object |
| `openCourse` | 213–215 | Captures click origin rect → passes to modal for expand animation |
| `handleAiSubmit` | 203–206 | Local mock — no API call yet |

## Calls

→ [[courses-service]] (`getFeaturedCourses`, `getRecommendedCourses`, `getLearningPath`)  
→ [[AuthContext]] (`useAuth` → `logout`)
