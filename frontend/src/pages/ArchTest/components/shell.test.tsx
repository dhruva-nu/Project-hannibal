import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toast } from "./Toast";
import { TopBar } from "./TopBar";

afterEach(cleanup);

describe("Toast", () => {
  it("renders nothing without a notice", () => {
    expect(render(<Toast notice={null} onDismiss={vi.fn()} />).container.textContent).toBe("");
  });

  it("shows a plain message without an action", () => {
    const { container } = render(<Toast notice={{ message: "Saved" }} onDismiss={vi.fn()} />);
    expect(container.textContent).toBe("Saved");
  });

  it("runs the action and dismisses", () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    const { getByText } = render(<Toast notice={{ message: "Gone", actionLabel: "Undo", onAction }} onDismiss={onDismiss} />);
    fireEvent.click(getByText("Undo"));
    expect(onAction).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });
});

const topBar = (overrides: Partial<Parameters<typeof TopBar>[0]> = {}) => {
  const handlers = {
    onTitleChange: vi.fn(),
    onOpenMenu: vi.fn(),
    onGroup: vi.fn(),
    onToggleFlow: vi.fn(),
    onToggleStateLinks: vi.fn(),
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
    canUndo: true,
    canRedo: false,
    ...overrides,
  };
  return { props: handlers, ...render(<TopBar {...state} {...handlers} />) };
};

describe("TopBar", () => {
  it("wires every control", () => {
    const { props, getByText, getByLabelText, getByRole } = topBar();
    fireEvent.change(getByLabelText("Diagram name"), { target: { value: "Renamed" } });
    expect(props.onTitleChange).toHaveBeenCalledWith("Renamed");
    fireEvent.click(getByText(/^Add/));
    expect(props.onOpenMenu).toHaveBeenCalledWith("add", expect.any(HTMLElement));
    fireEvent.click(getByText(/^File/));
    expect(props.onOpenMenu).toHaveBeenCalledWith("file", expect.any(HTMLElement));
    fireEvent.click(getByText("Group"));
    fireEvent.click(getByText("Data flow"));
    fireEvent.click(getByText("State links"));
    fireEvent.click(getByText("Undo"));
    fireEvent.click(getByLabelText("Zoom in"));
    fireEvent.click(getByLabelText("Zoom out"));
    fireEvent.click(getByText("Fit"));
    fireEvent.click(getByRole("button", { name: "Switch to dark mode" }));
    expect(
      [props.onGroup, props.onToggleFlow, props.onToggleStateLinks, props.onUndo, props.onFit, props.onToggleTheme].every(
        (fn) => fn.mock.calls.length === 1,
      ),
    ).toBe(true);
    expect(props.onZoom.mock.calls).toEqual([["in"], ["out"]]);
    expect(getByText("80%")).toBeTruthy();
  });

  it("reflects toggle state and disables unavailable history actions", () => {
    const { getByText } = topBar();
    expect(getByText("State links").getAttribute("aria-pressed")).toBe("true");
    expect(getByText("Data flow").getAttribute("aria-pressed")).toBe("false");
    expect((getByText("Redo") as HTMLButtonElement).disabled).toBe(true);
    expect((getByText("Undo") as HTMLButtonElement).disabled).toBe(false);
  });
});
