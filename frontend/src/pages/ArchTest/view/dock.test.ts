import { describe, expect, it } from "vitest";
import { starter } from "../engine";
import { CHIP_SIZE, clipInsetFrom, collapsedBoxIn, dockModel, dockedScreenBoxes, growOrigin, transformBetween, windowBox, WINDOW_INSET } from "./dock";

const STAGE = { width: 1100, height: 700 };
const IDENTITY = { x: 0, y: 0, k: 1 };

const modelWithLayers = () => {
  const model = starter();
  model.lnodes[0] = { ...model.lnodes[0], x: 270, y: 65, w: 262, h: 138 };
  model.lnodes[1] = { ...model.lnodes[1], x: 636, y: 128, w: 304, h: 110 };
  model.lnodes[2] = { ...model.lnodes[2], x: 140, y: 377, w: 303, h: 109 };
  return model;
};

describe("windowBox", () => {
  it("leaves the inset margins around the stage", () => {
    expect(windowBox(STAGE)).toEqual({ x: WINDOW_INSET.x, y: WINDOW_INSET.y, w: 1052, h: 540 });
  });
});

describe("dockedScreenBoxes", () => {
  it("docks upper cards on the top row and lower cards on the bottom row, keeping their horizontal order", () => {
    const boxes = dockedScreenBoxes(modelWithLayers(), IDENTITY, STAGE, "backend");
    expect(boxes.L_backend).toBeUndefined();
    expect(boxes.L_client).toEqual({ x: 270, y: CHIP_SIZE.margin, w: CHIP_SIZE.w, h: CHIP_SIZE.h });
    expect(boxes.L_db).toEqual({ x: 140, y: STAGE.height - CHIP_SIZE.margin - CHIP_SIZE.h, w: CHIP_SIZE.w, h: CHIP_SIZE.h });
  });

  it("includes infrastructure cards that belong to no layer, but not containers", () => {
    const model = modelWithLayers();
    const bus = { ...model.nodes[0], id: "bus", type: "queue", layer: null, parent: null, x: 671, y: 333, w: 131, h: 62 };
    const box = { ...model.nodes[0], id: "box", type: "docker", layer: null, parent: null, x: 0, y: 0, w: 600, h: 400 };
    model.nodes.push(bus as never, box as never);
    const boxes = dockedScreenBoxes(model, IDENTITY, STAGE, "client");
    expect(boxes.bus).toBeDefined();
    expect(boxes.box).toBeUndefined();
  });

  it("pushes overlapping chips apart and pulls an overflowing row back inside the stage", () => {
    const model = modelWithLayers();
    model.lnodes[0] = { ...model.lnodes[0], x: 900, y: 10 };
    model.lnodes[1] = { ...model.lnodes[1], x: 905, y: 10 };
    const boxes = dockedScreenBoxes(model, IDENTITY, STAGE, "db");
    expect(boxes.L_backend.x).toBeGreaterThanOrEqual(boxes.L_client.x + CHIP_SIZE.w + CHIP_SIZE.gap);
    expect(boxes.L_backend.x + CHIP_SIZE.w).toBeLessThanOrEqual(STAGE.width - CHIP_SIZE.margin);
  });

  it("accounts for pan and zoom of the overview", () => {
    const boxes = dockedScreenBoxes(modelWithLayers(), { x: 100, y: 0, k: 2 }, STAGE, "backend");
    expect(boxes.L_client.x).toBe(270 * 2 + 100);
  });
});

describe("dockModel", () => {
  it("stretches the open layer to the window and shrinks the rest to chips, in world units", () => {
    const view = { x: 50, y: 20, k: 2 };
    const { model, chips } = dockModel(modelWithLayers(), view, STAGE, "backend");
    const open = model.lnodes.find((n) => n.id === "L_backend")!;
    expect(open.x * view.k + view.x).toBeCloseTo(WINDOW_INSET.x);
    expect(open.w * view.k).toBeCloseTo(STAGE.width - WINDOW_INSET.x * 2);
    const client = model.lnodes.find((n) => n.id === "L_client")!;
    expect(client.w * view.k).toBeCloseTo(CHIP_SIZE.w);
    expect(Object.keys(chips)).toContain("L_client");
  });

  it("leaves nodes that are neither the open layer nor dockable untouched", () => {
    const model = modelWithLayers();
    const docked = dockModel(model, IDENTITY, STAGE, "backend").model;
    expect(docked.nodes).toEqual(model.nodes);
  });
});

describe("growOrigin", () => {
  it("starts from the overview card when nothing was open", () => {
    expect(growOrigin(modelWithLayers(), IDENTITY, STAGE, null, "client")).toEqual({ x: 270, y: 65, w: 262, h: 138 });
  });

  it("starts from the docked chip when switching layers", () => {
    expect(growOrigin(modelWithLayers(), IDENTITY, STAGE, "backend", "client")).toEqual({
      x: 270,
      y: CHIP_SIZE.margin,
      w: CHIP_SIZE.w,
      h: CHIP_SIZE.h,
    });
  });

  it("returns null when the target has no card or chip", () => {
    const model = modelWithLayers();
    model.lnodes = [];
    expect(growOrigin(model, IDENTITY, STAGE, null, "client")).toBeNull();
    expect(growOrigin(modelWithLayers(), IDENTITY, STAGE, "client", "client")).toBeNull();
  });
});

describe("clipInsetFrom", () => {
  const window = { x: 24, y: 80, w: 1052, h: 540 };

  it("reveals only the origin box inside the window", () => {
    expect(clipInsetFrom({ x: 270, y: 100, w: 262, h: 138 }, window, 12)).toBe("inset(20px 544px 382px 246px round 12px)");
  });

  it("never produces negative insets when the origin pokes outside the window", () => {
    expect(clipInsetFrom({ x: 0, y: 0, w: 2000, h: 2000 }, window, 4)).toBe("inset(0px 0px 0px 0px round 4px)");
  });
});

describe("transformBetween", () => {
  it("moves and scales an element laid out at `to` onto `from`, undoing the parent zoom", () => {
    const to = { x: 100, y: 50, w: 200, h: 100 };
    expect(transformBetween({ x: 300, y: 90, w: 50, h: 20 }, to, 2)).toBe("translate(100px, 20px) scale(0.25, 0.2)");
  });
});

describe("collapsedBoxIn", () => {
  it("is a small box centred in the given box", () => {
    expect(collapsedBoxIn({ x: 0, y: 0, w: 200, h: 100 })).toEqual({ x: 60, y: 40, w: 80, h: 20 });
  });
});
