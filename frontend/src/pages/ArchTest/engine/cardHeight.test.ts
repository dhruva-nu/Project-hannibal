import { describe, expect, it } from "vitest";
import { CARD_HEAD, CARD_LINE, CARD_PAD, MAX_TABLE_LINES, contentLines, fittedHeight } from "./cardHeight";
import { newCollection, newTable } from "./registry";
import { addNode, byName, starterModel, starterService } from "./testFixtures";
import type { ComponentNode, FunctionNode, NosqlNode, SqlNode } from "./types";

const heightFor = (lines: number) => CARD_HEAD + CARD_PAD + lines * CARD_LINE;

describe("contentLines", () => {
  it("counts one line per service endpoint", () => {
    expect(contentLines(starterService(starterModel()))).toBe(3);
  });

  it("counts a component's description, state and read/write summaries", () => {
    const model = starterModel();
    const component = byName<ComponentNode>(model, "UserProfile");
    expect(contentLines(component)).toBe(3);
    component.cfg.writes = [{ varId: "v_loading", from: "" }];
    expect(contentLines(component)).toBe(4);
    expect(contentLines(addNode(model, "component", "Empty"))).toBe(1);
  });

  it("adds a line to functions that write state", () => {
    const model = starterModel();
    expect(contentLines(byName<FunctionNode>(model, "fetchUser"))).toBe(3);
    expect(contentLines(addNode(model, "function", "pure"))).toBe(2);
  });

  it("caps database lines at the table limit", () => {
    const model = starterModel();
    const sql = byName<SqlNode>(model, "app_db");
    const nosql = addNode<NosqlNode>(model, "nosql", "docs");
    expect(contentLines(sql)).toBe(2);
    expect(contentLines(nosql)).toBe(1);
    sql.cfg.tables = Array.from({ length: 10 }, (_, i) => newTable("t" + i));
    nosql.cfg.collections = Array.from({ length: 10 }, (_, i) => newCollection("c" + i));
    expect(contentLines(sql)).toBe(MAX_TABLE_LINES);
    expect(contentLines(nosql)).toBe(MAX_TABLE_LINES);
  });

  it("gives infrastructure a single line", () => {
    expect(contentLines(addNode(starterModel(), "redis", "cache"))).toBe(1);
  });
});

describe("fittedHeight", () => {
  it("fits cards to their content with at least one line", () => {
    const model = starterModel();
    const service = starterService(model);
    expect(fittedHeight(service)).toBe(heightFor(3));
    service.cfg.endpoints = [];
    expect(fittedHeight(service)).toBe(heightFor(1));
  });

  it("leaves containers and layer cards to the user", () => {
    const model = starterModel();
    expect(fittedHeight(addNode(model, "docker", "box"))).toBeNull();
    expect(fittedHeight(model.lnodes[0])).toBeNull();
  });
});
