import { describe, expect, it } from "vitest";
import {
  anchorPoint,
  boundsOf,
  boxesOverlap,
  centerOf,
  centerOnBox,
  clamp,
  computeAnchors,
  containsPoint,
  curveBetween,
  DEFAULT_VIEW,
  fitView,
  intersects,
  rectEdgeToward,
  sideFacing,
  snapToGrid,
  toScreen,
  toWorld,
  zoomAround,
  type Box,
} from "./geometry";

const box = (x: number, y: number, w = 100, h = 50): Box => ({ x, y, w, h });

describe("scalar helpers", () => {
  it("clamps into range", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it("snaps to the 10px grid", () => {
    expect(snapToGrid(14)).toBe(10);
    expect(snapToGrid(16)).toBe(20);
  });
});

describe("sideFacing", () => {
  it.each([
    [box(300, 0), "r"],
    [box(-300, 0), "l"],
    [box(0, 300), "b"],
    [box(0, -300), "t"],
  ] as const)("faces the neighbour at %j via %s", (other, side) => {
    expect(sideFacing(box(0, 0), other)).toBe(side);
  });
});

describe("anchorPoint", () => {
  const b = box(10, 20, 100, 50);
  it("places points on each side", () => {
    expect(anchorPoint(b, "t", 0.5)).toEqual({ x: 60, y: 20, side: "t" });
    expect(anchorPoint(b, "b", 0.5)).toEqual({ x: 60, y: 70, side: "b" });
    expect(anchorPoint(b, "l", 0.5)).toEqual({ x: 10, y: 45, side: "l" });
    expect(anchorPoint(b, "r", 0.5)).toEqual({ x: 110, y: 45, side: "r" });
  });
});

describe("computeAnchors", () => {
  const boxes: Record<string, Box> = { a: box(0, 0), b: box(300, 0), c: box(300, 60) };
  const boxOf = (id: string) => boxes[id];

  it("spreads edges sharing a side evenly and orders by neighbour position", () => {
    const anchors = computeAnchors(
      [
        { id: "e1", from: "a", to: "b" },
        { id: "e2", from: "a", to: "c" },
      ],
      boxOf,
    );
    expect(anchors.e1.a?.side).toBe("r");
    expect(anchors.e2.a?.side).toBe("r");
    expect(anchors.e1.a!.y).toBeLessThan(anchors.e2.a!.y);
    expect(anchors.e1.b?.side).toBe("l");
  });

  it("orders vertically stacked neighbours by x", () => {
    const stacked: Record<string, Box> = { a: box(0, 0), b: box(-200, 300), c: box(200, 300) };
    const anchors = computeAnchors(
      [
        { id: "e1", from: "a", to: "c" },
        { id: "e2", from: "a", to: "b" },
      ],
      (id) => stacked[id],
    );
    expect(anchors.e2.a!.x).toBeLessThan(anchors.e1.a!.x);
  });

  it("skips edges whose endpoints are unknown", () => {
    expect(computeAnchors([{ id: "e", from: "a", to: "missing" }], boxOf)).toEqual({});
  });
});

describe("curveBetween", () => {
  it("builds a cubic path with its midpoint", () => {
    const curve = curveBetween({ x: 0, y: 0, side: "r" }, { x: 200, y: 0, side: "l" });
    expect(curve.path).toBe("M0,0 C80,0 120,0 200,0");
    expect(curve.mid).toEqual({ x: 100, y: 0 });
  });

  it("clamps the control reach to a minimum", () => {
    const curve = curveBetween({ x: 0, y: 0, side: "b" }, { x: 0, y: 10, side: "t" });
    expect(curve.path).toBe("M0,0 C0,30 0,-20 0,10");
  });
});

describe("rectEdgeToward", () => {
  const b = box(0, 0, 100, 50);
  it("returns the centre when the target is the centre", () => {
    expect(rectEdgeToward(b, centerOf(b))).toEqual({ x: 50, y: 25 });
  });
  it("hits the right edge for a horizontal target", () => {
    expect(rectEdgeToward(b, { x: 500, y: 25 })).toEqual({ x: 100, y: 25 });
  });
  it("hits the bottom edge for a vertical target", () => {
    expect(rectEdgeToward(b, { x: 50, y: 500 })).toEqual({ x: 50, y: 50 });
  });
});

describe("bounds and fitting", () => {
  it("returns null bounds for no boxes", () => {
    expect(boundsOf([])).toBeNull();
  });

  it("falls back to the default view when nothing is visible", () => {
    expect(fitView([], 800, 600)).toEqual(DEFAULT_VIEW);
  });

  it("centres content and caps zoom at 1", () => {
    const view = fitView([box(0, 0, 100, 100)], 800, 600);
    expect(view.k).toBe(1);
    expect(view.x).toBeCloseTo(350);
    expect(view.y).toBeCloseTo(250);
  });

  it("zooms out to fit large content", () => {
    const view = fitView([box(0, 0, 4000, 2000)], 800, 600);
    expect(view.k).toBe(0.2);
  });
});

describe("zoom and coordinate transforms", () => {
  it("keeps the anchor point fixed while zooming", () => {
    const start = { x: 0, y: 0, k: 1 };
    const next = zoomAround(start, 100, 100, 2);
    expect(toWorld(next, 100, 100)).toEqual(toWorld(start, 100, 100));
  });

  it("clamps zoom to the allowed range", () => {
    expect(zoomAround({ x: 0, y: 0, k: 2 }, 0, 0, 10).k).toBe(2.5);
    expect(zoomAround({ x: 0, y: 0, k: 0.25 }, 0, 0, 0.1).k).toBe(0.2);
  });

  it("round-trips world and screen coordinates", () => {
    const view = { x: 30, y: 40, k: 2 };
    expect(toScreen(view, toWorld(view, 110, 220))).toEqual({ x: 110, y: 220 });
  });
});

describe("centerOnBox", () => {
  const view = { x: 0, y: 0, k: 1 };
  it("does nothing when the box is comfortably visible", () => {
    expect(centerOnBox(view, box(100, 100), 800, 600)).toBeNull();
  });
  it("recentres when the box is off screen", () => {
    expect(centerOnBox(view, box(2000, 100), 800, 600)).toEqual({ k: 1, x: 400 - 2050, y: 300 - 125 });
  });
});

describe("hit testing", () => {
  it("detects overlap with a gap", () => {
    expect(boxesOverlap(box(0, 0), box(105, 0))).toBe(true);
    expect(boxesOverlap(box(0, 0), box(200, 0))).toBe(false);
  });
  it("detects marquee intersection", () => {
    expect(intersects(box(0, 0), 50, 25, 200, 200)).toBe(true);
    expect(intersects(box(0, 0), 150, 25, 200, 200)).toBe(false);
  });
  it("detects containment", () => {
    expect(containsPoint(box(0, 0), { x: 10, y: 10 })).toBe(true);
    expect(containsPoint(box(0, 0), { x: 500, y: 10 })).toBe(false);
  });
});
