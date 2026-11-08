import { describe, expect, it, vi } from "vitest";
import { type ArchModel } from "../../../engine";
import { addNode, byName } from "../../../engine/testFixtures";
import { NO_SELECTION } from "../../../state/archApi";
import { startConnect } from "./connect";
import { startGroupDrag, startNodeDrag } from "./dragNodes";
import { startMarquee, startPan } from "./panMarquee";
import { startResize } from "./resize";
import { committedDraft, down, makeContext, pointer } from "./gestureFixtures";
import { hasMoved } from "./gestureContext";

const fnId = (m: ArchModel) => byName(m, "fetchUser").id;

describe("hasMoved", () => {
  it("needs at least four pixels of travel", () => {
    expect(hasMoved({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 0 })).toBe(false);
    expect(hasMoved({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 3 })).toBe(true);
  });
});

describe("node drag", () => {
  it("ignores unknown nodes", () => {
    const ctx = makeContext();
    startNodeDrag(ctx, down(0, 0), "ghost");
    expect(ctx.select).not.toHaveBeenCalled();
  });

  it("selects the node, previews a snapped move and commits on release with reparenting", () => {
    const ctx = makeContext();
    const id = fnId(ctx.model);
    const origin = byName(ctx.model, "fetchUser");
    const docker = addNode(ctx.model, "docker", "box", {}, { x: origin.x + 500, y: origin.y + 500, w: 400, h: 400 });
    docker.layer = "client";
    startNodeDrag(ctx, down(100, 100), id);
    expect(ctx.select).toHaveBeenCalledWith({ type: "node", ids: [id] });
    pointer("pointermove", 102, 101);
    expect(ctx.setOverrides).not.toHaveBeenCalled();
    pointer("pointermove", 612, 613);
    const overrides = ctx.setOverrides.mock.calls[0][0];
    expect(overrides.positions[id]).toEqual({ x: Math.round((origin.x + 512) / 10) * 10, y: Math.round((origin.y + 513) / 10) * 10 });
    pointer("pointerup", 612, 613);
    expect(ctx.setOverrides).toHaveBeenLastCalledWith(null);
    const draft = committedDraft(ctx);
    expect(draft.nodes.find((n) => n.id === id)!.parent).toBe(docker.id);
  });

  it("drags descendants along with a selected container and keeps an existing multi-selection", () => {
    const ctx = makeContext();
    const docker = addNode(ctx.model, "docker", "box", {}, { x: 0, y: 0, w: 600, h: 600 });
    const child = byName(ctx.model, "fetchUser");
    child.parent = docker.id;
    ctx.selection = { type: "node", ids: [docker.id] };
    startNodeDrag(ctx, down(0, 0), docker.id);
    expect(ctx.select).not.toHaveBeenCalled();
    pointer("pointermove", 50, 50);
    expect(Object.keys(ctx.setOverrides.mock.calls[0][0].positions).sort()).toEqual([child.id, docker.id].sort());
    pointer("pointercancel", 50, 50);
    expect(ctx.commit).toHaveBeenCalled();
  });

  it("skips selected ids that no longer exist when building the drag", () => {
    const ctx = makeContext();
    const id = fnId(ctx.model);
    ctx.selection = { type: "node", ids: [id, "ghost"] };
    startNodeDrag(ctx, down(0, 0), id);
    pointer("pointermove", 20, 20);
    expect(Object.keys(ctx.setOverrides.mock.calls[0][0].positions)).toEqual([id]);
    pointer("pointerup", 20, 20);
  });

  it("toggles nodes in and out of the selection with shift and clears when empty", () => {
    const ctx = makeContext();
    const id = fnId(ctx.model);
    startNodeDrag(ctx, down(0, 0, { shiftKey: true }), id);
    expect(ctx.select).toHaveBeenLastCalledWith({ type: "node", ids: [id] });
    ctx.selection = { type: "node", ids: [id] };
    startNodeDrag(ctx, down(0, 0, { shiftKey: true }), id);
    expect(ctx.select).toHaveBeenLastCalledWith(NO_SELECTION);
    ctx.selection = { type: "edge", ids: ["e"] };
    startNodeDrag(ctx, down(0, 0, { shiftKey: true }), id);
    expect(ctx.select).toHaveBeenLastCalledWith({ type: "node", ids: [id] });
  });

  it("opens details on a quick second click and resets after", () => {
    const ctx = makeContext();
    const id = fnId(ctx.model);
    startNodeDrag(ctx, down(0, 0), id);
    pointer("pointerup", 0, 0);
    expect(ctx.openDetail).not.toHaveBeenCalled();
    startNodeDrag(ctx, down(0, 0), id);
    pointer("pointerup", 0, 0);
    expect(ctx.openDetail).toHaveBeenCalledWith(id);
    expect(ctx.lastClick).toEqual({ id: null, time: 0 });
  });

  it("does not count a slow second click as a double click", () => {
    let clock = 0;
    const ctx = makeContext({ now: () => (clock += 1000) });
    const id = fnId(ctx.model);
    startNodeDrag(ctx, down(0, 0), id);
    pointer("pointerup", 0, 0);
    startNodeDrag(ctx, down(0, 0), id);
    pointer("pointerup", 0, 0);
    expect(ctx.openDetail).not.toHaveBeenCalled();
  });

  it("narrows a multi-selection to the clicked node on a plain click", () => {
    const ctx = makeContext();
    const id = fnId(ctx.model);
    const other = byName(ctx.model, "Get user").id;
    ctx.selection = { type: "node", ids: [id, other] };
    startNodeDrag(ctx, down(0, 0), id);
    pointer("pointerup", 0, 0);
    expect(ctx.select).toHaveBeenCalledWith({ type: "node", ids: [id] });
  });

  it("scales pointer movement by the zoom and offsets by the viewport", () => {
    const ctx = makeContext({ view: { x: 10, y: 10, k: 2 }, viewportRect: () => ({ left: 20, top: 20, width: 1, height: 1 }) });
    const id = fnId(ctx.model);
    const origin = byName(ctx.model, "fetchUser");
    startNodeDrag(ctx, down(120, 120), id);
    pointer("pointermove", 220, 120);
    expect(ctx.setOverrides.mock.calls[0][0].positions[id].x).toBe(Math.round((origin.x + 50) / 10) * 10);
    pointer("pointerup", 220, 120);
  });
});

describe("layer card drag", () => {
  it("opens the layer on a click", () => {
    const ctx = makeContext();
    const card = ctx.model.lnodes[1];
    startNodeDrag(ctx, down(0, 0), card.id);
    pointer("pointerup", 0, 0);
    expect(ctx.openScope).toHaveBeenCalledWith("backend");
  });

  it("moves the card instead when dragged", () => {
    const ctx = makeContext();
    const card = ctx.model.lnodes[0];
    startNodeDrag(ctx, down(0, 0), card.id);
    pointer("pointermove", 100, 0);
    pointer("pointerup", 100, 0);
    expect(ctx.openScope).not.toHaveBeenCalled();
    expect(committedDraft(ctx).lnodes[0].x).toBe(card.x + 100);
  });
});

describe("group drag", () => {
  it("selects the group and moves its members", () => {
    const ctx = makeContext();
    const fn = byName(ctx.model, "fetchUser");
    fn.group = "g";
    ctx.model.groups.push({ id: "g", name: "G" });
    startGroupDrag(ctx, down(0, 0), "g");
    expect(ctx.select).toHaveBeenCalledWith({ type: "group", ids: ["g"] });
    pointer("pointermove", 40, 0);
    pointer("pointerup", 40, 0);
    expect(committedDraft(ctx).nodes.find((n) => n.id === fn.id)!.x).toBe(Math.round((fn.x + 40) / 10) * 10);
  });

  it("does nothing on a plain click", () => {
    const ctx = makeContext();
    startGroupDrag(ctx, down(0, 0), "g");
    pointer("pointerup", 0, 0);
    expect(ctx.commit).not.toHaveBeenCalled();
  });
});

describe("resize", () => {
  it("ignores unknown nodes and clicks without movement", () => {
    const ctx = makeContext();
    startResize(ctx, down(0, 0), "ghost");
    startResize(ctx, down(0, 0), fnId(ctx.model));
    pointer("pointerup", 0, 0);
    expect(ctx.commit).not.toHaveBeenCalled();
  });

  it("previews and commits a snapped size with a minimum, then reparents siblings", () => {
    const ctx = makeContext();
    const fn = byName(ctx.model, "fetchUser");
    const docker = addNode(ctx.model, "docker", "box", {}, { x: fn.x - 50, y: fn.y - 50, w: 200, h: 200 });
    docker.layer = "client";
    startResize(ctx, down(0, 0), docker.id);
    pointer("pointermove", -500, -500);
    expect(ctx.setOverrides.mock.calls[0][0].sizes[docker.id]).toEqual({ w: 150, h: 70 });
    pointer("pointermove", 800, 800);
    pointer("pointerup", 800, 800);
    const draft = committedDraft(ctx);
    const resized = draft.nodes.find((n) => n.id === docker.id)!;
    expect(resized).toMatchObject({ w: 1000, h: 1000 });
    expect(draft.nodes.find((n) => n.id === fn.id)!.parent).toBe(docker.id);
  });

  it("resizes layer cards without reparenting and survives a node deleted mid-drag", () => {
    const ctx = makeContext();
    const card = ctx.model.lnodes[0];
    startResize(ctx, down(0, 0), card.id);
    pointer("pointermove", 100, 100);
    pointer("pointerup", 100, 100);
    expect(committedDraft(ctx).lnodes[0].w).toBeGreaterThan(card.w);
    const vanishing = makeContext();
    startResize(vanishing, down(0, 0), fnId(vanishing.model));
    pointer("pointermove", 50, 50);
    pointer("pointerup", 50, 50);
    const mutator = vanishing.commit.mock.calls[0][0] as (d: ArchModel) => void;
    expect(() => mutator({ ...vanishing.model, nodes: [], lnodes: [] })).not.toThrow();
  });
});

describe("connect", () => {
  it("ignores unknown sources", () => {
    const ctx = makeContext();
    startConnect(ctx, "ghost", "r");
    pointer("pointermove", 1, 1);
    expect(ctx.setPreview).not.toHaveBeenCalled();
  });

  it("previews from the port and connects to the node under the pointer", () => {
    const ctx = makeContext();
    const from = byName(ctx.model, "fetchUser");
    const target = document.createElement("div");
    target.dataset.kind = "node";
    target.dataset.id = "target";
    ctx.elementAt.mockReturnValue(target);
    startConnect(ctx, from.id, "r");
    pointer("pointermove", 300, 200);
    expect(ctx.setPreview).toHaveBeenCalledWith({ from: { x: from.x + from.w, y: from.y + from.h / 2, side: "r" }, to: { x: 300, y: 200 } });
    pointer("pointerup", 300, 200);
    expect(ctx.setPreview).toHaveBeenLastCalledWith(null);
    expect(ctx.connect).toHaveBeenCalledWith(from.id, "target");
  });

  it("does not connect to itself or to empty space", () => {
    const ctx = makeContext();
    const from = byName(ctx.model, "fetchUser");
    startConnect(ctx, from.id, "b");
    pointer("pointerup", 1, 1);
    const self = document.createElement("div");
    self.dataset.kind = "node";
    self.dataset.id = from.id;
    ctx.elementAt.mockReturnValue(self);
    startConnect(ctx, from.id, "b");
    pointer("pointerup", 1, 1);
    expect(ctx.connect).not.toHaveBeenCalled();
  });
});

describe("pan and marquee", () => {
  it("deselects on a click without movement", () => {
    const ctx = makeContext();
    startPan(ctx, down(0, 0));
    expect(ctx.setPanning).toHaveBeenCalledWith(true);
    pointer("pointermove", 1, 1);
    pointer("pointerup", 1, 1);
    expect(ctx.setView).not.toHaveBeenCalled();
    expect(ctx.setPanning).toHaveBeenLastCalledWith(false);
    expect(ctx.select).toHaveBeenCalledWith(NO_SELECTION);
  });

  it("pans the view while dragging and keeps the selection", () => {
    const ctx = makeContext({ view: { x: 5, y: 6, k: 1 } });
    startPan(ctx, down(0, 0));
    pointer("pointermove", 30, 40);
    expect(ctx.setView).toHaveBeenCalledWith({ x: 35, y: 46, k: 1 });
    pointer("pointermove", 31, 41);
    pointer("pointerup", 31, 41);
    expect(ctx.select).not.toHaveBeenCalled();
  });

  it("selects the nodes inside the dragged rectangle", () => {
    const ctx = makeContext({ scope: "client", viewportRect: () => ({ left: 10, top: 10, width: 1, height: 1 }) });
    startMarquee(ctx, down(10, 10));
    expect(ctx.setMarquee).toHaveBeenCalledWith({ x: 0, y: 0, width: 0, height: 0 });
    pointer("pointermove", 1000, 1000);
    expect(ctx.setMarquee).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 990, height: 990 });
    pointer("pointerup", 1000, 1000);
    expect(ctx.setMarquee).toHaveBeenLastCalledWith(null);
    const selection = ctx.select.mock.calls[0][0];
    expect(selection.type).toBe("node");
    expect(selection.ids).toContain(fnId(ctx.model));
    expect(selection.ids).not.toContain(byName(ctx.model, "Get user").id);
  });

  it("clears the selection when the rectangle covers nothing and drags right-to-left", () => {
    const ctx = makeContext({ scope: "client" });
    startMarquee(ctx, down(5000, 5000));
    pointer("pointerup", 4000, 4000);
    expect(ctx.select).toHaveBeenCalledWith(NO_SELECTION);
    expect(vi.isMockFunction(ctx.select)).toBe(true);
  });
});
