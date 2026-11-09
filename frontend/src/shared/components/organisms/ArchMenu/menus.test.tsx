import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchMenu, type OpenMenu } from "./ArchMenu";
import { addMenuGroups, insertMenuItems, OPEN_LAYER_HINT } from "./menuItems";

afterEach(cleanup);

const labels = (scope: Parameters<typeof addMenuGroups>[0]) =>
  addMenuGroups(scope).map((g) => [g.heading, g.items.map((i) => i.label)] as const);

describe("menuItems", () => {
  it("offers only infrastructure outside the layers", () => {
    const groups = labels(null);
    expect(groups).toHaveLength(1);
    expect(groups[0][0]).toBe("Infrastructure outside the layers");
    expect(groups[0][1]).toContain("Redis cache");
    expect(groups[0][1]).not.toContain("Docker container");
  });

  it("offers client, backend and database items per layer with the right containers", () => {
    expect(labels("client").map((g) => g[0])).toEqual(["Client", "Containers", "Infrastructure"]);
    expect(labels("backend").map((g) => g[0])).toEqual(["Backend", "Containers (put services inside)", "Infrastructure"]);
    expect(labels("db").map((g) => g[0])).toEqual(["Database", "Containers", "Infrastructure"]);
    expect(labels("client")[0][1]).toEqual(["Component", "Function"]);
    expect(labels("backend")[0][1]).toEqual(["Service"]);
    expect(labels("db")[0][1]).toEqual(["SQL database", "NoSQL database"]);
  });

  it("excludes containers from the insert list", () => {
    const names = insertMenuItems().map((i) => i.label);
    expect(names).toContain("Load balancer");
    expect(names).not.toContain("Kubernetes");
  });
});

describe("ArchMenu", () => {
  const open = (kind: OpenMenu["kind"]): OpenMenu => ({ kind, anchorElement: document.body, left: 0, bottom: 0 });
  const handlers = () => ({
    onClose: vi.fn(),
    onAdd: vi.fn(),
    onInsert: vi.fn(),
    onLoadExample: vi.fn(),
    onNewBlank: vi.fn(),
    onOpenIo: vi.fn(),
  });

  it("renders nothing when closed", () => {
    const { container } = render(<ArchMenu menu={null} scope={null} {...handlers()} />);
    expect(container.textContent).toBe("");
  });

  it("routes the file menu actions", () => {
    const h = handlers();
    const { getByText } = render(<ArchMenu menu={open("file")} scope={null} {...h} />);
    fireEvent.click(getByText("Load the user profile example"));
    fireEvent.click(getByText("New blank diagram"));
    fireEvent.click(getByText("Export or import JSON"));
    expect([h.onLoadExample, h.onNewBlank, h.onOpenIo].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("routes the insert menu choice", () => {
    const h = handlers();
    const { getByText } = render(<ArchMenu menu={open("insert")} scope="backend" {...h} />);
    fireEvent.click(getByText("Load balancer"));
    expect(h.onInsert).toHaveBeenCalledWith("lb");
  });

  it("shows a hint to open a layer when adding outside one, and layer items inside one", () => {
    const h = handlers();
    const outside = render(<ArchMenu menu={open("add")} scope={null} {...h} />);
    expect(outside.getByText(OPEN_LAYER_HINT)).toBeTruthy();
    outside.unmount();
    const inside = render(<ArchMenu menu={open("add")} scope="client" {...h} />);
    expect(inside.queryByText(OPEN_LAYER_HINT)).toBeNull();
    fireEvent.click(inside.getByText("Function"));
    expect(h.onAdd).toHaveBeenCalledWith("function");
  });
});
