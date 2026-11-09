import { describe, expect, it } from "vitest";
import { STORAGE_KEY, applySnapshot, loadSaved, save, snapshotOf } from "./persistence";
import { starterModel } from "./testFixtures";
import { blank } from "./starter";

class FakeStorage implements Storage {
  private items = new Map<string, string>();
  failReads = false;
  failWrites = false;
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    if (this.failReads) throw new Error("denied");
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("quota");
    this.items.set(key, value);
  }
}

describe("saving and loading", () => {
  it("round trips a model", () => {
    const storage = new FakeStorage();
    const model = starterModel();
    expect(save(storage, model)).toBe(true);
    const loaded = loadSaved(storage);
    expect(loaded?.name).toBe(model.name);
    expect(loaded?.nodes).toEqual(model.nodes);
    expect(loaded?.store).toEqual(model.store);
    expect(loaded?.view).toBe(loaded?.views.overview);
  });

  it("refuses saves containing node types this version no longer understands", () => {
    const storage = new FakeStorage();
    const legacy = { nodes: [{ id: "n1", type: "api", name: "Get user", cfg: {} }] };
    storage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    expect(loadSaved(storage)).toBeNull();
  });

  it("returns null when nothing usable is stored", () => {
    const storage = new FakeStorage();
    expect(loadSaved(storage)).toBeNull();
    storage.setItem(STORAGE_KEY, "{broken");
    expect(loadSaved(storage)).toBeNull();
    storage.setItem(STORAGE_KEY, "null");
    expect(loadSaved(storage)).toBeNull();
    storage.setItem(STORAGE_KEY, JSON.stringify({ nodes: [] }));
    expect(loadSaved(storage)).toBeNull();
    storage.setItem(STORAGE_KEY, JSON.stringify({ nodes: "no" }));
    expect(loadSaved(storage)).toBeNull();
    storage.failReads = true;
    expect(loadSaved(storage)).toBeNull();
  });

  it("fills in defaults for older saved shapes", () => {
    const storage = new FakeStorage();
    const { nodes } = starterModel();
    storage.setItem(STORAGE_KEY, JSON.stringify({ nodes }));
    const bare = loadSaved(storage);
    expect(bare).toMatchObject({ name: "Untitled architecture", store: [], edges: [], groups: [] });
    expect(bare?.lnodes).toHaveLength(3);
    expect(bare?.view).toEqual({ x: 60, y: 40, k: 0.8 });
    storage.setItem(STORAGE_KEY, JSON.stringify({ nodes, view: { x: 1, y: 2, k: 3 }, views: { db: { x: 0, y: 0, k: 1 } } }));
    const withView = loadSaved(storage);
    expect(withView?.view).toEqual({ x: 1, y: 2, k: 3 });
    expect(withView?.views.db).toEqual({ x: 0, y: 0, k: 1 });
    storage.setItem(STORAGE_KEY, JSON.stringify({ nodes, views: { overview: { x: 9, y: 9, k: 1 } } }));
    expect(loadSaved(storage)?.view).toEqual({ x: 9, y: 9, k: 1 });
  });

  it("reports write failures", () => {
    const storage = new FakeStorage();
    storage.failWrites = true;
    expect(save(storage, starterModel())).toBe(false);
  });
});

describe("snapshots", () => {
  it("captures and restores diagram content", () => {
    const model = starterModel();
    const snapshot = snapshotOf(model);
    model.name = "changed";
    model.nodes = [];
    model.edges = [];
    applySnapshot(model, snapshot);
    expect(model.name).toBe("User profile example");
    expect(model.nodes).toHaveLength(4);
    expect(model.edges).toHaveLength(3);
  });

  it("restores the app-wide store, defaulting to empty for snapshots without one", () => {
    const model = starterModel();
    const snapshot = snapshotOf(model);
    model.store = [];
    applySnapshot(model, snapshot);
    expect(model.store.map((v) => v.id)).toEqual(["v_user", "v_orders"]);
    const withoutStore = JSON.parse(snapshot);
    delete withoutStore.store;
    applySnapshot(model, JSON.stringify(withoutStore));
    expect(model.store).toEqual([]);
  });

  it("keeps existing layer nodes when the snapshot has none", () => {
    const model = blank();
    const layers = model.lnodes;
    const bare = JSON.stringify({ name: "x", nodes: model.nodes, edges: [], groups: [] });
    applySnapshot(model, bare);
    expect(model.lnodes).toBe(layers);
    expect(model.name).toBe("x");
  });
});
