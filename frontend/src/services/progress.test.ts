import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { completeLesson, getCourseProgress, resetProgress, updateProgress } from "./progress";

vi.mock("./api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.delete).mockReset();
});

describe("getCourseProgress", () => {
  it("returns the progress payload", async () => {
    const progress = {
      courseId: 1, completedLessonIds: [1], activeLessonId: 2, placedNodeIds: [], enrolledAt: "now",
    };
    vi.mocked(api.get).mockResolvedValueOnce(progress);
    await expect(getCourseProgress(1)).resolves.toEqual(progress);
  });

  it("maps a 404 to null instead of throwing", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("Request failed (404)"));
    await expect(getCourseProgress(1)).resolves.toBeNull();
  });

  it("rethrows other errors", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("Request failed (500)"));
    await expect(getCourseProgress(1)).rejects.toThrow("Request failed (500)");
  });
});

describe("progress mutations", () => {
  it("patches the active lesson", async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({});
    await updateProgress(1, { activeLessonId: 5 });
    expect(api.patch).toHaveBeenCalledWith("/api/v1/progress/courses/1", { activeLessonId: 5 });
  });

  it("posts lesson completion", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({});
    await completeLesson(1, 5);
    expect(api.post).toHaveBeenCalledWith("/api/v1/progress/courses/1/lessons/5/complete");
  });

  it("deletes progress on reset", async () => {
    vi.mocked(api.delete).mockResolvedValueOnce(undefined);
    await resetProgress(1);
    expect(api.delete).toHaveBeenCalledWith("/api/v1/progress/courses/1");
  });
});
