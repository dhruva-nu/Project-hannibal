import { describe, expect, it } from "vitest";
import {
  INFRA_KEYS,
  NODE_REGISTRY,
  behaviourOf,
  emptyQuery,
  isContainer,
  newCollection,
  newEndpoint,
  newTable,
  newVariable,
} from "./registry";
import { addNode, starterModel } from "./testFixtures";
import type { ArchNode, InfraCfg, InfraType, NodeType } from "./types";

describe("registry", () => {
  it("creates default config for every node type", () => {
    (Object.keys(NODE_REGISTRY) as NodeType[]).forEach((type) => {
      expect(NODE_REGISTRY[type].def()).toBeTypeOf("object");
    });
  });

  it("summarises every infrastructure type from its defaults", () => {
    INFRA_KEYS.forEach((type: InfraType) => {
      const entry = NODE_REGISTRY[type];
      const summary = (entry.sum as (cfg: InfraCfg) => string)(entry.def() as InfraCfg);
      expect(summary).toBeTypeOf("string");
      expect(summary).not.toContain("undefined");
    });
  });

  it("lists infrastructure keys including containers", () => {
    expect(INFRA_KEYS).toContain("docker");
    expect(INFRA_KEYS).toContain("redis");
    expect(INFRA_KEYS).not.toContain("service");
  });

  it("uses custom size for containers and default size otherwise", () => {
    expect(NODE_REGISTRY.docker.w).toBe(460);
    expect(NODE_REGISTRY.redis.w).toBe(190);
    expect(NODE_REGISTRY.redis.container).toBe(false);
  });

  it("builds new tables and collections", () => {
    expect(newTable("t").columns.map((c) => c.name)).toEqual(["id", "name"]);
    expect(newCollection("c").fields.map((f) => f.name)).toEqual(["_id", "name"]);
  });

  it("maps behaviours", () => {
    const model = starterModel();
    const types = new Map(model.nodes.map((n) => [n.type, n]));
    expect(behaviourOf(types.get("sqldb") as ArchNode)).toBe("db");
    expect(behaviourOf(types.get("service") as ArchNode)).toBe("service");
    expect(behaviourOf(types.get("function") as ArchNode)).toBe("function");
    expect(behaviourOf(addNode(model, "redis", "r"))).toBe("cache");
    expect(behaviourOf(addNode(model, "nosql", "m"))).toBe("db");
  });

  it("detects containers", () => {
    const model = starterModel();
    expect(isContainer(undefined)).toBe(false);
    expect(isContainer(null)).toBe(false);
    expect(isContainer(addNode(model, "docker", "d"))).toBe(true);
    expect(isContainer(addNode(model, "service", "a"))).toBe(false);
    expect(isContainer({ type: "bogus" } as unknown as ArchNode)).toBe(false);
  });

  it("builds endpoints with defaults and overrides", () => {
    const plain = newEndpoint();
    expect(plain).toMatchObject({ method: "GET", path: "/resource/:id", dbId: "", single: false, q: emptyQuery() });
    expect(plain.id).toMatch(/^ep/);
    expect(newEndpoint().id).not.toBe(plain.id);
    expect(newEndpoint({ id: "ep_x", method: "POST" })).toMatchObject({ id: "ep_x", method: "POST" });
  });

  it("gives service defaults one endpoint and no in-app services", () => {
    expect(NODE_REGISTRY.service.def()).toMatchObject({ framework: "FastAPI", appServices: [] });
  });

  it("names new variables after how many already exist", () => {
    const first = newVariable([]);
    expect(first).toMatchObject({ name: "variable1", type: "string", init: '""' });
    expect(newVariable([first]).name).toBe("variable2");
  });
});
