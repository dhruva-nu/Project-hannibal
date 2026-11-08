import { describe, expect, it } from "vitest";
import { INFRA_KEYS, REG, behOf, isContainer, newCollection, newTable } from "./registry";
import { addNode, starterModel } from "./testFixtures";
import type { ArchNode, InfraCfg, InfraType, NodeType } from "./types";

describe("registry", () => {
  it("creates default config for every node type", () => {
    (Object.keys(REG) as NodeType[]).forEach((type) => {
      expect(REG[type].def()).toBeTypeOf("object");
    });
  });

  it("summarises every infrastructure type from its defaults", () => {
    INFRA_KEYS.forEach((type: InfraType) => {
      const entry = REG[type];
      const summary = (entry.sum as (cfg: InfraCfg) => string)(entry.def() as InfraCfg);
      expect(summary).toBeTypeOf("string");
      expect(summary).not.toContain("undefined");
    });
  });

  it("lists infrastructure keys including containers", () => {
    expect(INFRA_KEYS).toContain("docker");
    expect(INFRA_KEYS).toContain("redis");
    expect(INFRA_KEYS).not.toContain("api");
  });

  it("uses custom size for containers and default size otherwise", () => {
    expect(REG.docker.w).toBe(460);
    expect(REG.redis.w).toBe(190);
    expect(REG.redis.container).toBe(false);
  });

  it("builds new tables and collections", () => {
    expect(newTable("t").columns.map((c) => c.name)).toEqual(["id", "name"]);
    expect(newCollection("c").fields.map((f) => f.name)).toEqual(["_id", "name"]);
  });

  it("maps behaviours", () => {
    const model = starterModel();
    const types = new Map(model.nodes.map((n) => [n.type, n]));
    expect(behOf(types.get("sqldb") as ArchNode)).toBe("db");
    expect(behOf(types.get("api") as ArchNode)).toBe("api");
    expect(behOf(addNode(model, "redis", "r"))).toBe("cache");
    expect(behOf(addNode(model, "nosql", "m"))).toBe("db");
  });

  it("detects containers", () => {
    const model = starterModel();
    expect(isContainer(undefined)).toBe(false);
    expect(isContainer(null)).toBe(false);
    expect(isContainer(addNode(model, "docker", "d"))).toBe(true);
    expect(isContainer(addNode(model, "api", "a"))).toBe(false);
    expect(isContainer({ type: "bogus" } as unknown as ArchNode)).toBe(false);
  });
});
