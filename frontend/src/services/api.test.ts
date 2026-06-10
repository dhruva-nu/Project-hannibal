import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "location", {
    value: { href: "http://localhost/courses", pathname: "/courses" },
    writable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("api", () => {
  it("returns parsed JSON on success", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1 }));
    await expect(api.get<{ id: number }>("/api/v1/courses")).resolves.toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/courses",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("sends a JSON body on post", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await api.post("/api/v1/things", { a: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/things",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ a: 1 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("refreshes the session on 401 and retries the request", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ id: 7 }));

    await expect(api.get("/api/v1/courses")).resolves.toEqual({ id: 7 });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/auth/refresh",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("redirects to /login and throws when the refresh fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({}, 401));

    await expect(api.get("/api/v1/courses")).rejects.toThrow("Session expired");
    expect(window.location.href).toBe("/login");
  });

  it("does not redirect again when already on /login", async () => {
    Object.defineProperty(window, "location", {
      value: { href: "http://localhost/login", pathname: "/login" },
      writable: true,
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({}, 401));

    await expect(api.get("/api/v1/auth/me")).rejects.toThrow("Session expired");
    expect(window.location.href).toBe("http://localhost/login");
  });

  it("does not try to refresh login or register requests", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "bad credentials" }, 401));
    await expect(api.post("/api/v1/auth/login", {})).rejects.toThrow("bad credentials");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces the backend error detail", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "course not found" }, 404));
    await expect(api.get("/api/v1/courses/99")).rejects.toThrow("course not found");
  });

  it("falls back to the status code when the error body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(api.get("/api/v1/courses")).rejects.toThrow("Request failed (502)");
  });

  it("returns undefined for 204 responses", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.delete("/api/v1/things/1")).resolves.toBeUndefined();
  });
});
