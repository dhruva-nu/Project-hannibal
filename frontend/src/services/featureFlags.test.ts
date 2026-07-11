import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { getFeatureFlags } from "./featureFlags";

vi.mock("./api", () => ({
  api: { get: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(api.get).mockReset();
});

describe("featureFlags service", () => {
  it("returns the resolved flag map", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ flags: { "new-lesson-sidebar": true } });
    await expect(getFeatureFlags()).resolves.toEqual({ "new-lesson-sidebar": true });
    expect(api.get).toHaveBeenCalledWith("/api/v1/feature-flags/");
  });

  it("returns an empty map when no flags are set", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ flags: {} });
    await expect(getFeatureFlags()).resolves.toEqual({});
  });
});
