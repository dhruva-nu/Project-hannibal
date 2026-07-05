import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { searchPackages, verifyPackage } from "./packages";

vi.mock("./api", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(api.get).mockReset();
});

describe("searchPackages", () => {
  it("returns matches and encodes the query", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(["requests", "regex"]);
    await expect(searchPackages("python", "re")).resolves.toEqual([
      "requests",
      "regex",
    ]);
    expect(api.get).toHaveBeenCalledWith(
      "/api/v1/rce/packages/search?language=python&q=re",
    );
  });

  it("short-circuits a blank query without a request", async () => {
    await expect(searchPackages("python", "  ")).resolves.toEqual([]);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("caches repeated identical searches", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(["fastapi"]);
    await searchPackages("python", "fast");
    await searchPackages("python", "fast");
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});

describe("verifyPackage", () => {
  it("returns the verdict", async () => {
    const result = { name: "requests", exists: true, in_cache: true };
    vi.mocked(api.get).mockResolvedValueOnce(result);
    await expect(verifyPackage("python", "requests")).resolves.toEqual(result);
  });

  it("caches a definite verdict", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      name: "django",
      exists: true,
      in_cache: false,
    });
    await verifyPackage("python", "django");
    await verifyPackage("python", "django");
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("does not cache an unreachable (null) verdict", async () => {
    vi.mocked(api.get).mockResolvedValue({
      name: "flaky",
      exists: null,
      in_cache: false,
    });
    await verifyPackage("python", "flaky");
    await verifyPackage("python", "flaky");
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
