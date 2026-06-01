import { test, expect, describe } from "bun:test";
import { withPlacement, applyPlacementNodes } from "./placement";
import type { NodeRecord } from "../../services/nodes";

const component: NodeRecord = {
  id: "cmp-1",
  type: "component",
  label: "Client",
  parentId: null,
  linkedNodeIds: [],
  defaultX: 10,
  defaultY: 20,
  defaultW: null,
};

const service: NodeRecord = {
  id: "svc-1",
  type: "service",
  label: "Backend",
  parentId: null,
  linkedNodeIds: [],
  defaultX: 100,
  defaultY: 120,
  defaultW: 240,
};

const moduleNode: NodeRecord = {
  id: "mod-1",
  type: "module",
  label: "Auth Module",
  parentId: "svc-1",
  linkedNodeIds: [],
  defaultX: null,
  defaultY: null,
  defaultW: null,
};

describe("withPlacement", () => {
  test("places a component using its defaults", () => {
    const next = withPlacement({}, component, null);
    expect(next["cmp-1"]).toEqual({
      id: "cmp-1",
      type: "component",
      label: "Client",
      x: 10,
      y: 20,
      w: undefined,
      modules: undefined,
    });
  });

  test("places a service with empty modules", () => {
    const next = withPlacement({}, service, null);
    expect(next["svc-1"].type).toBe("service");
    expect(next["svc-1"].modules).toEqual([]);
    expect(next["svc-1"].w).toBe(240);
  });

  test("places a module and auto-creates its parent service", () => {
    const next = withPlacement({}, moduleNode, service);
    expect(next["svc-1"]).toBeDefined();
    expect(next["svc-1"].type).toBe("service");
    expect(next["svc-1"].modules).toEqual([{ id: "mod-1", label: "Auth Module" }]);
  });

  test("appends a module to an existing parent service", () => {
    const seeded = withPlacement({}, service, null);
    const next = withPlacement(seeded, moduleNode, service);
    expect(next["svc-1"].modules).toEqual([{ id: "mod-1", label: "Auth Module" }]);
  });

  test("does not double-add the same module on repeat placement", () => {
    const first = withPlacement({}, moduleNode, service);
    const second = withPlacement(first, moduleNode, service);
    expect(second["svc-1"].modules).toEqual([{ id: "mod-1", label: "Auth Module" }]);
  });

  test("returns prev unchanged when a module has no parent record", () => {
    const prev = {};
    const next = withPlacement(prev, moduleNode, null);
    expect(next).toBe(prev);
  });

  test("does not overwrite an existing placed component on repeat placement", () => {
    const seeded = withPlacement({}, component, null);
    seeded["cmp-1"] = { ...seeded["cmp-1"], x: 999, y: 888 };
    const next = withPlacement(seeded, component, null);
    expect(next["cmp-1"].x).toBe(999);
    expect(next["cmp-1"].y).toBe(888);
  });
});

describe("applyPlacementNodes", () => {
  test("places service + its module + a linked component from a flat list", () => {
    const next = applyPlacementNodes({}, [service, moduleNode, component]);
    expect(Object.keys(next).sort()).toEqual(["cmp-1", "svc-1"]);
    expect(next["svc-1"].modules).toEqual([{ id: "mod-1", label: "Auth Module" }]);
    expect(next["cmp-1"].type).toBe("component");
  });

  test("module in list with parent absent is skipped", () => {
    const next = applyPlacementNodes({}, [moduleNode]);
    expect(next).toEqual({});
  });

  test("order of input does not matter — services are placed before modules", () => {
    const next = applyPlacementNodes({}, [moduleNode, service]);
    expect(next["svc-1"].modules).toEqual([{ id: "mod-1", label: "Auth Module" }]);
  });
});
