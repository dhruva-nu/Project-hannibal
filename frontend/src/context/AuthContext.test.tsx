import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getCurrentUser } from "@/services/auth";
import type { User } from "@/shared/types";
import { AuthProvider, useAuth } from "./AuthContext";

vi.mock("@/services/auth", () => ({
  getCurrentUser: vi.fn(),
  logout: vi.fn(),
}));

const USER: User = { id: 1, email: "a@b.c", provider: "local", oauth_id: null };

const Probe = () => {
  const { user, loading } = useAuth();
  if (loading) return <span>loading</span>;
  return <span>{user ? user.email : "logged out"}</span>;
};

function renderProbe() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset();
});

describe("AuthProvider", () => {
  it("exposes the signed-in user once the session check resolves", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(USER);
    renderProbe();
    expect(screen.getByText("loading")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("a@b.c")).toBeTruthy());
  });

  it("stays logged out when the session check fails", async () => {
    vi.mocked(getCurrentUser).mockRejectedValueOnce(new Error("network down"));
    renderProbe();
    await waitFor(() => expect(screen.getByText("logged out")).toBeTruthy());
  });

  it("throws when useAuth is used outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow("useAuth must be used inside AuthProvider");
    spy.mockRestore();
  });
});
