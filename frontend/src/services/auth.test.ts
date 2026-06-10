import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { getCurrentUser, login, logout, register } from "./auth";

vi.mock("./api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

describe("auth service", () => {
  it("fetches the current user", async () => {
    const user = { id: 1, email: "a@b.c" };
    vi.mocked(api.get).mockResolvedValueOnce(user);
    await expect(getCurrentUser()).resolves.toEqual(user);
    expect(api.get).toHaveBeenCalledWith("/api/v1/auth/me");
  });

  it("logs in with credentials", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: 1 });
    await login("a@b.c", "pw");
    expect(api.post).toHaveBeenCalledWith("/api/v1/auth/login", { email: "a@b.c", password: "pw" });
  });

  it("registers a new account", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(undefined);
    await register("a@b.c", "pw");
    expect(api.post).toHaveBeenCalledWith("/api/v1/auth/register", { email: "a@b.c", password: "pw" });
  });

  it("logs out", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(undefined);
    await logout();
    expect(api.post).toHaveBeenCalledWith("/api/v1/auth/logout");
  });
});
