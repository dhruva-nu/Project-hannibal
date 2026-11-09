import { fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { starter } from "@/pages/ArchTest/engine";
import { ArchContext, useArch, type TraceView } from "@/pages/ArchTest/state/archApi";
import { renderWithArch, type PanelRender } from "@/pages/ArchTest/testing/panelHarness";
import { ArchStorePanel } from "./ArchStorePanel";

const storeOf = (view: PanelRender) => view.model().store;

const renderStore = (model = starter()) => {
  const onClose = vi.fn();
  const view = renderWithArch(<ArchStorePanel onClose={onClose} />, { model });
  return { view, onClose };
};

const WithTrace = ({ trace, children }: { trace: TraceView; children: ReactNode }) => {
  const api = useArch();
  return <ArchContext.Provider value={{ ...api, trace }}>{children}</ArchContext.Provider>;
};

const traceWritingCurrentUser = (index: number): TraceView => ({
  compId: "",
  only: "",
  warm: false,
  index,
  playing: false,
  result: { steps: [], fnOrder: [], writes: [{ varId: "v_user", value: { id: 7 }, by: "fetchUser", stepI: 2 }] },
});

describe("StorePanel", () => {
  it("adds, edits and removes app-wide variables", () => {
    const { view } = renderStore();
    fireEvent.click(screen.getByText("Add variable"));
    expect(storeOf(view).map((v) => v.name)).toEqual(["currentUser", "orders", "variable3"]);

    fireEvent.change(screen.getAllByLabelText("Variable name")[2], { target: { value: "cart" } });
    fireEvent.change(screen.getAllByLabelText("Variable type")[2], { target: { value: "array" } });
    fireEvent.change(screen.getAllByLabelText("Initial value")[2], { target: { value: "[]" } });
    expect(storeOf(view)[2]).toMatchObject({ name: "cart", type: "array", init: "[]" });

    fireEvent.click(screen.getByLabelText("Remove orders"));
    expect(storeOf(view).map((v) => v.name)).toEqual(["currentUser", "cart"]);
  });

  it("shows who reads and modifies each variable and reveals them", () => {
    const { view } = renderStore();
    fireEvent.click(screen.getAllByText("UserProfile")[0]);
    fireEvent.click(screen.getAllByText("fetchUser")[0]);
    expect(view.stubs.reveal).toHaveBeenCalledTimes(2);
  });

  it("explains the store when it is empty", () => {
    const model = starter();
    model.store = [];
    renderStore(model);
    expect(screen.getByText(/Nothing global yet/)).toBeTruthy();
  });

  it("hides itself and opens the dependency overview", () => {
    const { view, onClose } = renderStore();
    fireEvent.click(screen.getByLabelText("Hide app state"));
    fireEvent.click(screen.getByText("Who reads and writes what"));
    expect(onClose).toHaveBeenCalled();
    expect(view.stubs.openModal).toHaveBeenCalledWith({ kind: "state" });
  });

  it("shows traced values instead of the editor while a trace runs", () => {
    renderWithArch(
      <WithTrace trace={traceWritingCurrentUser(2)}>
        <ArchStorePanel onClose={vi.fn()} />
      </WithTrace>,
    );
    expect(screen.getByText("Values at the current trace step.")).toBeTruthy();
    expect(screen.queryByText("Add variable")).toBeNull();
    expect(screen.getByText('{"id":7}')).toBeTruthy();
    expect(screen.getByText("[]")).toBeTruthy();
  });
});
