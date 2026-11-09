import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "./engine";
import { ArchTest } from "./ArchTest";
import { installLocalStorage } from "./state/testStorage";

let stored: Map<string, string>;

beforeAll(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
});
beforeEach(() => {
  stored = installLocalStorage();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const mount = () => {
  const view = render(<ArchTest />);
  const cards = (type: string) => Array.from(view.container.querySelectorAll<HTMLElement>(`[data-type='${type}']`));
  const clickLayer = (name: string) => {
    const card = cards("layer").find((c) => c.textContent?.includes(name))!;
    fireEvent.pointerDown(card, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 0, clientY: 0 });
  };
  const dialog = (name: string) => within(document.body).getByRole("dialog", { name });
  const pressKey = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document, { key, ...init });
  const toolbarButton = (name: string | RegExp) => view.getByRole("button", { name });
  const openAddMenu = () => fireEvent.click(toolbarButton(/^\+ Add/));
  const dragConnect = (from: HTMLElement, to: HTMLElement, port: string) => {
    const original = document.elementFromPoint;
    document.elementFromPoint = () => to;
    fireEvent.pointerDown(from.querySelector(`[data-port='${port}']`)!, { button: 0 });
    fireEvent.pointerUp(window, { clientX: 1, clientY: 1 });
    document.elementFromPoint = original;
  };
  return { ...view, cards, clickLayer, dialog, pressKey, toolbarButton, openAddMenu, dragConnect };
};

describe("ArchTest page", () => {
  it("shows the starter diagram as three layer cards", () => {
    const { cards, getByLabelText } = mount();
    expect(cards("layer")).toHaveLength(3);
    expect((getByLabelText("Diagram name") as HTMLInputElement).value).toBe("User profile example");
  });

  it("opens a layer on click and leaves it with Escape", () => {
    const { clickLayer, getByText, queryByText, pressKey } = mount();
    clickLayer("Client layer");
    expect(getByText("Back to overview")).toBeTruthy();
    pressKey("Escape");
    expect(queryByText("Back to overview")).toBeNull();
  });

  it("adds a component from the Add menu inside a layer and undoes it with Ctrl+Z", () => {
    const { clickLayer, openAddMenu, getByRole, cards, pressKey } = mount();
    clickLayer("Client layer");
    expect(cards("component")).toHaveLength(1);
    openAddMenu();
    fireEvent.click(getByRole("menuitem", { name: "Component" }));
    expect(cards("component")).toHaveLength(2);
    pressKey("z", { ctrlKey: true });
    expect(cards("component")).toHaveLength(1);
    pressKey("z", { ctrlKey: true, shiftKey: true });
    expect(cards("component")).toHaveLength(2);
    pressKey("z", { metaKey: true });
    pressKey("y", { ctrlKey: true });
    expect(cards("component")).toHaveLength(2);
  });

  it("shows only infrastructure in the Add menu on the overview and closes the menu on Escape", () => {
    const { getByText, queryByRole, pressKey, openAddMenu } = mount();
    openAddMenu();
    expect(getByText("Open a layer to add its components")).toBeTruthy();
    openAddMenu();
    expect(queryByRole("menu")).toBeNull();
    openAddMenu();
    pressKey("Escape");
    expect(queryByRole("menu")).toBeNull();
  });

  it("closes an open menu when the page is pressed elsewhere", () => {
    const { getByText, queryByRole } = mount();
    fireEvent.click(getByText(/^File/));
    fireEvent.pointerDown(document.body);
    expect(queryByRole("menu")).toBeNull();
  });

  it("toggles connection payload chips with Data flow", () => {
    const { getByText, container } = mount();
    expect(container.querySelectorAll("[data-chip]")).toHaveLength(0);
    fireEvent.click(getByText("Data flow"));
    expect(container.querySelectorAll("[data-chip]").length).toBeGreaterThan(0);
    expect(getByText("Data flow").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(getByText("State links"));
    expect(getByText("State links").getAttribute("aria-pressed")).toBe("true");
  });

  it("renames the diagram and persists it to storage", () => {
    vi.useFakeTimers();
    const { getByLabelText } = mount();
    fireEvent.change(getByLabelText("Diagram name"), { target: { value: "Shop" } });
    expect((getByLabelText("Diagram name") as HTMLInputElement).value).toBe("Shop");
    act(() => void vi.advanceTimersByTime(300));
    expect(stored.get(STORAGE_KEY)).toContain("Shop");
  });

  it("loads the example only after confirming, and a blank diagram likewise", () => {
    const { getByText, dialog, getByLabelText, toolbarButton } = mount();
    fireEvent.change(getByLabelText("Diagram name"), { target: { value: "Mine" } });
    fireEvent.click(getByText(/^File/));
    fireEvent.click(getByText("Load the user profile example"));
    fireEvent.click(within(dialog("Please confirm")).getByText("Cancel"));
    expect((getByLabelText("Diagram name") as HTMLInputElement).value).toBe("Mine");
    fireEvent.click(getByText(/^File/));
    fireEvent.click(getByText("Load the user profile example"));
    fireEvent.click(within(dialog("Please confirm")).getByText("Load example"));
    expect((getByLabelText("Diagram name") as HTMLInputElement).value).toBe("User profile example");
    fireEvent.click(getByText(/^File/));
    fireEvent.click(getByText("New blank diagram"));
    fireEvent.click(within(dialog("Please confirm")).getByText("Start blank"));
    expect((getByLabelText("Diagram name") as HTMLInputElement).value).toBe("Untitled architecture");
    fireEvent.click(toolbarButton("Undo"));
    expect((getByLabelText("Diagram name") as HTMLInputElement).value).toBe("User profile example");
    fireEvent.click(toolbarButton("Redo"));
    expect((getByLabelText("Diagram name") as HTMLInputElement).value).toBe("Untitled architecture");
  });

  it("imports a diagram from the JSON dialog", () => {
    const { getByText, dialog, getByLabelText } = mount();
    fireEvent.click(getByText(/^File/));
    fireEvent.click(getByText("Export or import JSON"));
    const box = within(dialog("Export or import JSON")).getByLabelText("Diagram JSON");
    fireEvent.change(box, { target: { value: JSON.stringify({ name: "Imported", nodes: [] }) } });
    fireEvent.click(within(dialog("Export or import JSON")).getByText("Load from text"));
    expect((getByLabelText("Diagram name") as HTMLInputElement).value).toBe("Imported");
  });

});

describe("ArchTest page view, selection and connections", () => {
  it("zooms and fits from the toolbar", () => {
    const { getByLabelText, getByText } = mount();
    const before = getByText(/\d+%/).textContent;
    fireEvent.click(getByLabelText("Zoom in"));
    expect(getByText(/\d+%/).textContent).not.toBe(before);
    fireEvent.click(getByLabelText("Zoom out"));
    fireEvent.click(getByText("Fit"));
    expect(getByText(/\d+%/)).toBeTruthy();
  });

  it("toggles the theme", () => {
    const { getByRole } = mount();
    fireEvent.click(getByRole("button", { name: "Switch to dark mode" }));
    expect(getByRole("button", { name: "Switch to light mode" })).toBeTruthy();
  });

  it("selects a component, opens its inspector and traces a request", () => {
    const { clickLayer, cards, getByRole, getByText, queryByRole } = mount();
    clickLayer("Client layer");
    fireEvent.pointerDown(cards("component")[0], { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 0, clientY: 0 });
    expect(getByRole("complementary", { name: "Inspector" })).toBeTruthy();
    fireEvent.click(getByText("Trace request"));
    expect(getByRole("region", { name: "Request trace" })).toBeTruthy();
    fireEvent.click(getByText("Close trace"));
    expect(queryByRole("region", { name: "Request trace" })).toBeNull();
  });

  it("deletes the selection with the Delete key after confirmation and ignores typing in fields", () => {
    const { clickLayer, cards, getByLabelText, dialog, pressKey } = mount();
    clickLayer("Backend layer");
    fireEvent.pointerDown(cards("service")[0], { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 0, clientY: 0 });
    fireEvent.keyDown(getByLabelText("Diagram name"), { key: "Delete" });
    expect(() => dialog("Please confirm")).toThrow();
    pressKey("Delete");
    fireEvent.click(within(dialog("Please confirm")).getByText("Delete"));
    expect(cards("service")).toHaveLength(0);
    pressKey("Delete");
    pressKey("q");
  });

  it("shows the app-wide state panel by default, opens the state dependency graph from it and hides it", () => {
    const { toolbarButton, getByRole, queryByRole, dialog } = mount();
    expect(toolbarButton("App state").getAttribute("aria-pressed")).toBe("true");
    const panel = within(getByRole("complementary", { name: "App state" }));
    expect(panel.getByDisplayValue("currentUser")).toBeTruthy();
    fireEvent.click(panel.getByRole("button", { name: "Who reads and writes what" }));
    expect(dialog("State dependencies")).toBeTruthy();
    fireEvent.click(within(dialog("State dependencies")).getByRole("button", { name: "Close" }));
    fireEvent.click(panel.getByRole("button", { name: "Hide app state" }));
    expect(queryByRole("complementary", { name: "App state" })).toBeNull();
    fireEvent.click(toolbarButton("App state"));
    expect(getByRole("complementary", { name: "App state" })).toBeTruthy();
  });

  it("closes a dialog with Escape", () => {
    const { getByText, dialog, queryByRole, pressKey } = mount();
    fireEvent.click(getByText(/^File/));
    fireEvent.click(getByText("Export or import JSON"));
    expect(dialog("Export or import JSON")).toBeTruthy();
    pressKey("Escape");
    expect(queryByRole("dialog")).toBeNull();
  });

  it("selects an overview edge and inserts infrastructure into it", () => {
    const { container, getByText, getByRole, cards } = mount();
    fireEvent.pointerDown(container.querySelector("[data-edge-id]")!, { button: 0 });
    fireEvent.click(getByText(/Insert infrastructure/, { selector: "button" }));
    fireEvent.click(getByRole("menuitem", { name: "Load balancer" }));
    expect(cards("lb")).toHaveLength(1);
  });

  it("opens the connection picker when a layer card is connected to another", () => {
    const { cards, dialog, dragConnect } = mount();
    const [client, backend] = cards("layer");
    dragConnect(client, backend, "r");
    expect(dialog("Connect Client layer to Backend layer")).toBeTruthy();
  });

  it("connects two boxes directly and selects the new connection", () => {
    const { clickLayer, cards, getByRole, dragConnect } = mount();
    clickLayer("Client layer");
    const [component] = cards("component");
    const [fn] = cards("function");
    dragConnect(fn, component, "t");
    expect(getByRole("complementary", { name: "Inspector" }).textContent).toContain("Connection");
  });

  it("closes the insert menu without inserting when its connection was undone meanwhile", () => {
    const { clickLayer, cards, getByText, getByRole, queryByRole, pressKey, dragConnect } = mount();
    clickLayer("Client layer");
    const [component] = cards("component");
    const [fn] = cards("function");
    dragConnect(fn, component, "t");
    fireEvent.click(getByText(/Insert infrastructure/, { selector: "button" }));
    pressKey("z", { ctrlKey: true });
    fireEvent.click(getByRole("menuitem", { name: "Load balancer" }));
    expect(queryByRole("menu")).toBeNull();
    expect(cards("lb")).toHaveLength(0);
  });
});
