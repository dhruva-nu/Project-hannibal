import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { findNode, findPlacedNode, starter } from "../engine";
import { byName } from "../engine/testFixtures";
import { ArchContext, useArch, type ArchApi } from "./archApi";

describe("useArch", () => {
  it("fails loudly outside the provider", () => {
    expect(() => renderHook(() => useArch())).toThrow("useArch must be used inside <ArchContext.Provider>");
  });

  it("returns the provided api", () => {
    const api = { model: starter() } as ArchApi;
    const wrapper = ({ children }: { children: ReactNode }) => <ArchContext.Provider value={api}>{children}</ArchContext.Provider>;
    expect(renderHook(() => useArch(), { wrapper }).result.current).toBe(api);
  });
});

describe("node lookup", () => {
  const model = starter();
  const layerCard = model.lnodes[0];
  const service = byName(model, "User service");

  it("finds layer cards and placed nodes", () => {
    expect(findNode(model, layerCard.id)).toBe(layerCard);
    expect(findNode(model, service.id)).toBe(service);
    expect(findNode(model, "missing")).toBeUndefined();
  });

  it("finds only placed nodes when asked for one", () => {
    expect(findPlacedNode(model, service.id)).toBe(service);
    expect(findPlacedNode(model, layerCard.id)).toBeUndefined();
  });
});
