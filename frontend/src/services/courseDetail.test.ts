import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { getCourseContent, translateBuildBlock } from "./courseDetail";

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
    lessonType: "learn",
    order: 1,
    ...overrides,
  };
}

describe("getCourseContent", () => {
  it("sorts lessons by order and maps backend fields", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([
      beLesson({ id: 2, order: 2, lessonType: "build", name: "Build it" }),
      beLesson({ id: 1, order: 1 }),
    ]);

    const content = await getCourseContent(1);

    expect(api.get).toHaveBeenCalledWith("/api/v1/lessons/course/1");
    expect(content.lessons.map(l => l.id)).toEqual(["1", "2"]);

    const [theory, build] = content.lessons;
    expect(theory).toMatchObject({ num: "01", kind: "theory", title: "Hashing", nosqlId: "n1" });
    expect(theory.theory?.body).toBe("<p>Hash the OTP</p>");
    expect(build).toMatchObject({ num: "02", kind: "build", title: "Build it" });
    expect(build.theory).toBeUndefined();
  });
});

describe("translateBuildBlock", () => {
  it("encodes the language and unwraps the code", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ code: "print(1)" });
    await expect(translateBuildBlock("n1", "python 3")).resolves.toBe("print(1)");
    expect(api.get).toHaveBeenCalledWith("/api/v1/build-blocks/n1/translate?language=python%203");
  });
});
