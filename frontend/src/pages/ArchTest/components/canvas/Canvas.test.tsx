import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { starter, type LayerId } from "../../engine";
import { byName } from "../../engine/testFixtures";
import { ArchContext, NO_SELECTION, type ArchApi } from "../../state/archApi";
import type { Controller } from "../../state/useArchController";
import { computeVisibility } from "../../view/visibility";
import { createApi } from "../overlays/testHarness";
import { Canvas } from "./Canvas";
import { EdgePopover } from "./EdgePopover";

beforeAll(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
});
afterEach(cleanup);

const model = starter();

const viewStub = (scope: LayerId | null) => ({
  scope,
  view: { x: 0, y: 0, k: 1 },
  overviewView: { x: 0, y: 0, k: 1 },
  setScope: vi.fn(),
  panBy: vi.fn(),
  setView: vi.fn(),
  zoomAtPoint: vi.fn(),
  zoomFromCenter: vi.fn(),
  fit: vi.fn(),
  openScope: vi.fn(),
  closeScope: vi.fn(),
  ensureVisible: vi.fn(),
});

const mount = (scope: LayerId | null = null, apiOverrides: Partial<ArchApi> = {}) => {
  const derived = computeVisibility(model, null).derivedById;
  const api = createApi(model, {
    edgeById: (id) => derived[id] ?? model.edges.find((e) => e.id === id),
    ...apiOverrides,
  });
  const view = viewStub(scope);
  const controller = { view, showFlow: false, showStateLinks: false } as unknown as Controller;
  const onOpenInsertMenu = vi.fn();
  const onConnect = vi.fn();
  const stageRef = { current: null };
  const utils = render(
    <ArchContext.Provider value={api}>
      <Canvas stageRef={stageRef} controller={controller} onOpenInsertMenu={onOpenInsertMenu} onConnect={onConnect} />
    </ArchContext.Provider>,
  );
  const viewport = utils.container.querySelector<HTMLElement>("[class*='viewport']:not([class*='backdrop'])")!;
  const cards = (type: string) => utils.container.querySelector<HTMLElement>(`[data-type='${type}']`)!;
  return { ...utils, api, view, viewport, cards, onOpenInsertMenu, onConnect };
};

describe("Canvas", () => {
  it("shows the overview with its hint and no backdrop or scope bar", () => {
    const { container, getByText, queryByText } = mount();
    expect(container.querySelectorAll("[data-type='layer']")).toHaveLength(3);
    expect(getByText(/Click a layer to open it/)).toBeTruthy();
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
    expect(queryByText("Back to overview")).toBeNull();
  });

  it("shows the scope bar and a dimmed overview backdrop inside a layer", () => {
    const { container, getByText, queryByText, view } = mount("backend");
    expect(container.querySelector("[aria-hidden='true']")).toBeTruthy();
    expect(queryByText(/Click a layer to open it/)).toBeNull();
    fireEvent.click(getByText("Fit"));
    fireEvent.click(getByText("Back to overview"));
    expect(view.fit).toHaveBeenCalled();
    expect(view.closeScope).toHaveBeenCalled();
  });

  it("closes the layer when the empty area around the window is pressed", () => {
    const { container, view } = mount("backend");
    const stage = container.firstElementChild as HTMLElement;
    fireEvent.pointerDown(stage);
    expect(view.closeScope).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(container.querySelector("[data-type='api']")!);
    expect(view.closeScope).toHaveBeenCalledTimes(1);
  });

  it("does not close the overview when its stage is pressed", () => {
    const { container, view } = mount();
    fireEvent.pointerDown(container.firstElementChild as HTMLElement);
    expect(view.closeScope).not.toHaveBeenCalled();
  });

  it("zooms around the pointer with ctrl+wheel and pans with a plain wheel", () => {
    const { viewport, view } = mount();
    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -100, clientX: 50, clientY: 60 });
    expect(view.zoomAtPoint).toHaveBeenCalledWith(50, 60, Math.exp(1));
    fireEvent.wheel(viewport, { deltaX: 3, deltaY: 4 });
    expect(view.panBy).toHaveBeenCalledWith(3, 4);
    fireEvent.wheel(viewport, { metaKey: true, deltaY: 100000 });
    expect(view.zoomAtPoint).toHaveBeenLastCalledWith(0, 0, Math.exp(-2));
  });

  it("deselects when the empty canvas is clicked", () => {
    const { viewport, api } = mount();
    fireEvent.pointerDown(viewport, { button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(window);
    expect(api.select).toHaveBeenCalledWith(NO_SELECTION);
  });

  it("draws a selection rectangle while shift-dragging", () => {
    const { viewport, container } = mount();
    fireEvent.pointerDown(viewport, { button: 0, shiftKey: true, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 70 });
    const marquee = container.querySelector<HTMLElement>("[class*='marquee']")!;
    expect(marquee.style.width).toBe("50px");
    expect(marquee.style.height).toBe("60px");
    fireEvent.pointerUp(window, { clientX: 60, clientY: 70 });
    expect(container.querySelector("[class*='marquee']")).toBeNull();
  });

  it("moves a dragged node live and commits on release", () => {
    const { cards, api } = mount("backend");
    const card = cards("api");
    const left = parseFloat(card.style.left);
    fireEvent.pointerDown(card, { button: 0, clientX: 0, clientY: 0 });
    act(() => void fireEvent.pointerMove(window, { clientX: 100, clientY: 0 }));
    expect(parseFloat(cards("api").style.left)).toBe(Math.round((left + 100) / 10) * 10);
    fireEvent.pointerUp(window, { clientX: 100, clientY: 0 });
    expect(api.commit).toHaveBeenCalled();
  });

  it("forwards connection drags to the page handler", () => {
    const { cards, onConnect } = mount("backend");
    const api = cards("api");
    const connector = cards("connector");
    const original = document.elementFromPoint;
    document.elementFromPoint = () => connector;
    fireEvent.pointerDown(api.querySelector("[data-port='b']")!, { button: 0 });
    fireEvent.pointerUp(window, { clientX: 5, clientY: 5 });
    document.elementFromPoint = original;
    expect(onConnect).toHaveBeenCalledWith(byName(model, "Get user").id, byName(model, "userWithOrders").id);
  });

  it("shows edge actions for a selected stored edge and routes them", () => {
    const edge = model.edges.find((e) => e.from === byName(model, "fetchUser").id)!;
    const { getByText, api, onOpenInsertMenu } = mount("backend", { selection: { type: "edge", ids: [edge.id] } });
    fireEvent.click(getByText(/Insert infrastructure/));
    expect(onOpenInsertMenu).toHaveBeenCalled();
    fireEvent.click(getByText("Payload"));
    fireEvent.click(getByText("Flip"));
    fireEvent.click(getByText("Delete"));
    expect(api.openFlow).toHaveBeenCalledWith(edge.id);
    expect(api.flipEdge).toHaveBeenCalledWith(edge.id);
    expect(api.askDeleteEdge).toHaveBeenCalledWith(edge.id);
  });

  it("shows connection actions without flip for an overview edge", () => {
    const { getByText, queryByText, api } = mount(null, { selection: { type: "edge", ids: ["ov|L_client|L_backend"] } });
    expect(queryByText("Flip")).toBeNull();
    fireEvent.click(getByText("Connections"));
    expect(api.openFlow).toHaveBeenCalledWith("ov|L_client|L_backend");
  });

  it("renders no popover when the selected edge no longer exists", () => {
    const { queryByText } = mount(null, { selection: { type: "edge", ids: ["gone"] }, edgeById: () => undefined });
    expect(queryByText("Payload")).toBeNull();
  });
});

describe("EdgePopover", () => {
  it("renders nothing for an edge that does not exist", () => {
    const api = createApi(model, { edgeById: () => undefined });
    const { container } = render(
      <ArchContext.Provider value={api}>
        <EdgePopover edgeId="gone" anchor={{ x: 0, y: 0 }} onOpenInsertMenu={vi.fn()} />
      </ArchContext.Provider>,
    );
    expect(container.textContent).toBe("");
  });
});
