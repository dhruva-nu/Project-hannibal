import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchTopBar } from "./ArchTopBar";

afterEach(cleanup);

const topBar = (overrides: Partial<Parameters<typeof ArchTopBar>[0]> = {}) => {
  const handlers = {
    onTitleChange: vi.fn(),
    onOpenMenu: vi.fn(),
    onGroup: vi.fn(),
    onToggleFlow: vi.fn(),
    onToggleStateLinks: vi.fn(),
    onToggleStore: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onZoom: vi.fn(),
    onFit: vi.fn(),
    onToggleTheme: vi.fn(),
  };
  const state = {
    title: "My diagram",
    zoomPercent: 80,
    theme: "light" as const,
    showFlow: false,
    showStateLinks: true,
    showStore: false,
    canUndo: true,
    canRedo: false,
    ...overrides,
  };
  return { props: handlers, ...render(<ArchTopBar {...state} {...handlers} />) };
};

describe("TopBar", () => {
  it("wires every control", () => {
    const { props, getByText, getByLabelText, getByRole } = topBar();
    const button = (name: string | RegExp) => getByRole("button", { name });
    fireEvent.change(getByLabelText("Diagram name"), { target: { value: "Renamed" } });
    expect(props.onTitleChange).toHaveBeenCalledWith("Renamed");
    fireEvent.click(button(/Add/));
    expect(props.onOpenMenu).toHaveBeenCalledWith("add", expect.any(HTMLElement));
    fireEvent.click(button(/File/));
    expect(props.onOpenMenu).toHaveBeenCalledWith("file", expect.any(HTMLElement));
    fireEvent.click(getByText("Group"));
    fireEvent.click(getByText("Data flow"));
    fireEvent.click(getByText("State links"));
    fireEvent.click(getByText("App state"));
    fireEvent.click(button("Undo"));
    fireEvent.click(button("Redo"));
    fireEvent.click(getByLabelText("Zoom in"));
    fireEvent.click(getByLabelText("Zoom out"));
    fireEvent.click(getByText("Fit"));
    fireEvent.click(getByRole("button", { name: "Switch to dark mode" }));
    expect(
      [props.onGroup, props.onToggleFlow, props.onToggleStateLinks, props.onToggleStore, props.onUndo, props.onFit, props.onToggleTheme].every(
        (fn) => fn.mock.calls.length === 1,
      ),
    ).toBe(true);
    expect(props.onRedo).not.toHaveBeenCalled();
    expect(props.onZoom.mock.calls).toEqual([["in"], ["out"]]);
    expect(getByText("80%")).toBeTruthy();
  });

  it("reflects toggle state and disables unavailable history actions", () => {
    const { getByText, getByRole } = topBar({ showStore: true });
    expect(getByText("State links").getAttribute("aria-pressed")).toBe("true");
    expect(getByText("App state").getAttribute("aria-pressed")).toBe("true");
    expect(getByText("Data flow").getAttribute("aria-pressed")).toBe("false");
    expect((getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(true);
    expect((getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
