import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { getFeatureFlags } from "@/services/featureFlags";
import { useAuth } from "@/context/AuthContext";
import { FeatureGate } from "@/shared/components/molecules";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FeatureFlagProvider } from "./FeatureFlagContext";

vi.mock("@/services/featureFlags", () => ({ getFeatureFlags: vi.fn() }));
vi.mock("@/context/AuthContext", () => ({ useAuth: vi.fn() }));

const SIGNED_IN = { user: { id: 1, email: "a@b.c" } };
const SIGNED_OUT = { user: null };

const Probe = () => {
  const on = useFeatureFlag("new-lesson-sidebar");
  return <span>{on ? "on" : "off"}</span>;
};

function renderWith(children: React.ReactNode) {
  return render(<FeatureFlagProvider>{children}</FeatureFlagProvider>);
}

beforeEach(() => {
  vi.mocked(getFeatureFlags).mockReset();
  vi.mocked(useAuth).mockReset();
});

afterEach(() => {
  cleanup();
});

describe("FeatureFlagProvider", () => {
  it("resolves flags for a signed-in user", async () => {
    vi.mocked(useAuth).mockReturnValue(SIGNED_IN as ReturnType<typeof useAuth>);
    vi.mocked(getFeatureFlags).mockResolvedValueOnce({ "new-lesson-sidebar": true });
    renderWith(<Probe />);
    await waitFor(() => expect(screen.getByText("on")).toBeTruthy());
  });

  it("fails closed when the fetch errors", async () => {
    vi.mocked(useAuth).mockReturnValue(SIGNED_IN as ReturnType<typeof useAuth>);
    vi.mocked(getFeatureFlags).mockRejectedValueOnce(new Error("network"));
    renderWith(<Probe />);
    await waitFor(() => expect(screen.getByText("off")).toBeTruthy());
    expect(getFeatureFlags).toHaveBeenCalled();
  });

  it("does not fetch and reads false when logged out", async () => {
    vi.mocked(useAuth).mockReturnValue(SIGNED_OUT as ReturnType<typeof useAuth>);
    renderWith(<Probe />);
    await waitFor(() => expect(screen.getByText("off")).toBeTruthy());
    expect(getFeatureFlags).not.toHaveBeenCalled();
  });
});

describe("FeatureGate", () => {
  it("renders children when the flag is on and fallback otherwise", async () => {
    vi.mocked(useAuth).mockReturnValue(SIGNED_IN as ReturnType<typeof useAuth>);
    vi.mocked(getFeatureFlags).mockResolvedValueOnce({ "new-lesson-sidebar": true });
    renderWith(
      <FeatureGate flag="new-lesson-sidebar" fallback={<span>old</span>}>
        <span>new</span>
      </FeatureGate>,
    );
    await waitFor(() => expect(screen.getByText("new")).toBeTruthy());
  });

  it("renders fallback while the flag is off", () => {
    vi.mocked(useAuth).mockReturnValue(SIGNED_OUT as ReturnType<typeof useAuth>);
    renderWith(
      <FeatureGate flag="new-lesson-sidebar" fallback={<span>old</span>}>
        <span>new</span>
      </FeatureGate>,
    );
    expect(screen.getByText("old")).toBeTruthy();
  });
});
