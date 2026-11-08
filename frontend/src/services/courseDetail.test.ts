import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { getCourseContent } from "./courseDetail";

vi.mock("./api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(api.get).mockReset();
});

function beLesson(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    courseId: 1,
    name: "Hashing",
    learning: "Hash the OTP",
    nosqlId: "n1",
    order: 1,
    ...overrides,
  };
}

describe("getCourseContent", () => {
  it("sorts lessons by order and maps backend fields", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([
      beLesson({ id: 2, order: 2, name: "Second" }),
      beLesson({ id: 1, order: 1 }),
    ]);

    const content = await getCourseContent(1);

    expect(api.get).toHaveBeenCalledWith("/api/v1/lessons/course/1");
    expect(content.lessons.map(l => l.id)).toEqual(["1", "2"]);

    const [first, second] = content.lessons;
    expect(first).toMatchObject({ num: "01", title: "Hashing", nosqlId: "n1" });
    expect(first.theory.body).toBe("<p>Hash the OTP</p>");
    expect(second).toMatchObject({ num: "02", title: "Second" });
  });
});
