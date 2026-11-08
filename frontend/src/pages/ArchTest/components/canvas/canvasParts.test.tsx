import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { simulate, starter, type ArchNode } from "../../engine";
import { addNode, byName } from "../../engine/testFixtures";
import { NO_SELECTION } from "../../state/archApi";
import { buildEdgeScene } from "../../view/edgeScene";
import { traceMark } from "../../view/traceHighlight";
import { computeVisibility } from "../../view/visibility";
import { traceViewFor } from "../overlays/testHarness";
import { ContainerBox } from "./ContainerBox";
import { EdgeChips } from "./EdgeChips";
import { EdgeLayer } from "./EdgeLayer";
import { GhostCard } from "./GhostCard";
import { NodeBody } from "./NodeBody";
import { NodeCard } from "./NodeCard";
import { World } from "./World";

afterEach(cleanup);

const model = starter();
const flow = simulate(model);
const trace = traceViewFor(model);
const bodyText = (node: ArchNode, extra: { showFlow?: boolean; t?: typeof trace | null; m?: typeof model } = {}) => {
  const m = extra.m ?? model;
  const view = render(
    <NodeBody node={node} model={m} flow={flow} trace={extra.t ?? null} showFlow={extra.showFlow ?? false} />,
  );
  const text = view.container.textContent ?? "";
  view.unmount();
  return text;
};

describe("NodeBody", () => {
  it("summarises each starter node type", () => {
    expect(bodyText(byName(model, "UserProfile"))).toContain("1 functions");
    expect(bodyText(byName(model, "UserProfile"))).toContain("2 state read");
    expect(bodyText(byName(model, "fetchUser"))).toContain("on mount");
    expect(bodyText(byName(model, "Get user"))).toContain("/users/:id");
    expect(bodyText(byName(model, "Get user"))).toContain("Used by 1 component(s)");
    expect(bodyText(byName(model, "userWithOrders"))).toContain("app_db (SQL)");
    expect(bodyText(byName(model, "userWithOrders"))).toContain("1 join(s)");
    expect(bodyText(byName(model, "app_db"))).toContain("users");
    expect(bodyText(byName(model, "app_db"))).toContain("(pk)");
    expect(bodyText(byName(model, "App state"))).toContain("currentUser");
    expect(bodyText(byName(model, "App state"))).toContain("R1 W1");
  });

  it("describes layer cards with counts and member names, or an empty hint", () => {
    const client = model.lnodes.find((l) => l.lid === "client")!;
    expect(bodyText(client)).toContain("1 component");
    expect(bodyText(client)).toContain("UserProfile");
    const empty = starter();
    empty.nodes = [];
    expect(bodyText(empty.lnodes[0], { m: empty })).toContain("Empty. Click to open");
  });

  it("describes function triggers", () => {
    const fn = byName(model, "fetchUser");
    const cases = [
      ["Polling", "every 5000 ms"],
      ["On Component Change", "deps: none"],
      ["WebSocket", "wss://example.com/stream"],
      ["On Load", "on mount"],
      ["Initial Load", "once at boot"],
    ] as const;
    cases.forEach(([trigger, expected]) => {
      const copy = { ...fn, cfg: { ...fn.cfg, trigger } } as ArchNode;
      expect(bodyText(copy)).toContain(expected);
    });
    const withDeps = { ...fn, cfg: { ...fn.cfg, trigger: "On Component Change", deps: "a,b" } } as ArchNode;
    expect(bodyText(withDeps)).toContain("deps: a,b");
  });

  it("shows placeholders for empty state, connector, SQL and NoSQL nodes", () => {
    const m = starter();
    const state = addNode(m, "state", "empty state", { vars: [] });
    const connector = addNode(m, "connector", "loose", { dbId: "" });
    const sql = addNode(m, "sqldb", "no tables", { tables: [] });
    const nosql = addNode(m, "nosql", "docs");
    expect(bodyText(state, { m })).toContain("No variables yet");
    expect(bodyText(connector, { m })).toContain("No database chosen");
    expect(bodyText(sql, { m })).toContain("No tables");
    const columns = Array.from({ length: 7 }, (_, i) => ({ name: `c${i}`, type: "int", pk: false, fk: "" }));
    if (sql.type === "sqldb") sql.cfg.tables = [{ name: "wide", columns, indexes: [], data: "[]" }];
    expect(bodyText(sql, { m })).toContain("+2");
    expect(bodyText(nosql, { m })).toContain("documents");
    if (nosql.type === "nosql") nosql.cfg.collections = [];
    expect(bodyText(nosql, { m })).toContain("No collections");
  });

  it("shows a NoSQL connector database and infrastructure summaries", () => {
    const m = starter();
    const nosql = addNode(m, "nosql", "docs");
    const connector = byName(m, "userWithOrders");
    if (connector.type === "connector") connector.cfg.dbId = nosql.id;
    expect(bodyText(connector, { m })).toContain("docs (NoSQL)");
    expect(bodyText(addNode(m, "redis", "r"), { m })).toContain("TTL 60s");
    if (connector.type === "connector") connector.cfg.q.joins = [];
    expect(bodyText(connector, { m })).not.toContain("join(s)");
  });

  it("shows traced state values once they are written", () => {
    const state = byName(model, "App state");
    const last = { ...trace, index: trace.result.steps.length - 1 };
    expect(bodyText(state, { t: last })).toContain('{"id":1');
    expect(bodyText(state, { t: { ...trace, index: 0 } })).toContain("R1 W1");
  });

  it("shows payload sizes in flow mode only for nodes with traffic", () => {
    expect(bodyText(byName(model, "Get user"), { showFlow: true })).toContain("in ");
    expect(bodyText(byName(model, "Get user"))).not.toContain("out ");
    expect(bodyText(byName(model, "App state"), { showFlow: true })).not.toContain("out ");
  });
});

describe("NodeCard", () => {
  const card = (node: ArchNode, extra: Partial<Parameters<typeof NodeCard>[0]> = {}) =>
    render(
      <NodeCard
        node={node}
        model={model}
        flow={flow}
        trace={null}
        mark="none"
        selected={false}
        showFlow={false}
        hasMismatch={false}
        {...extra}
      />,
    );

  it("labels cards by node kind", () => {
    expect(card(model.lnodes[0]).container.textContent).toContain("open");
    cleanup();
    expect(card(byName(model, "fetchUser")).container.textContent).toContain("On Load");
    cleanup();
    expect(card(byName(model, "Get user")).container.textContent).toContain("GET");
    cleanup();
    expect(card(byName(model, "app_db")).container.textContent).toContain("SQL database");
  });

  it("exposes selection, trace mark, category and the mismatch warning", () => {
    const { container, getByTitle } = card(byName(model, "Get user"), { selected: true, mark: "active", hasMismatch: true });
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset).toMatchObject({ selected: "true", trace: "active", cat: "backend", kind: "node", type: "api" });
    expect(getByTitle("Response does not match what this component expects")).toBeTruthy();
    expect(root.querySelectorAll("[data-port]")).toHaveLength(4);
    expect(root.querySelector("[data-resize]")).toBeTruthy();
  });

  it("uses the layer id as the category of layer cards", () => {
    const root = card(model.lnodes[2]).container.firstElementChild as HTMLElement;
    expect(root.dataset.cat).toBe("db");
  });
});

describe("ContainerBox and GhostCard", () => {
  it("renders a container with its kind label and handles", () => {
    const m = starter();
    const docker = addNode(m, "docker", "box");
    const { container } = render(<ContainerBox node={docker} selected mark="visited" />);
    expect(container.textContent).toContain("Docker container");
    expect((container.firstElementChild as HTMLElement).dataset).toMatchObject({ kind: "container", selected: "true", trace: "visited" });
  });

  it("renders ghosts with direction arrows and the owning layer name", () => {
    const up = render(<GhostCard node={byName(model, "fetchUser")} box={{ x: 0, y: 0, w: 200, h: 40, up: true }} mark="dim" />);
    expect(up.container.textContent).toBe("↑ fetchUserClient layer");
    cleanup();
    const m = starter();
    const infra = addNode(m, "redis", "cache");
    infra.layer = null;
    const down = render(<GhostCard node={infra} box={{ x: 0, y: 0, w: 200, h: 40, up: false }} mark="none" />);
    expect(down.container.textContent).toBe("↓ cacheInfrastructure");
  });
});

describe("EdgeLayer and EdgeChips", () => {
  const sceneFor = () =>
    buildEdgeScene({
      model,
      flow,
      visibility: computeVisibility(model, "client"),
      scope: "client",
      selection: NO_SELECTION,
      trace: { ...trace, index: trace.result.steps.findIndex((s) => s.dir === "res" && s.edge) },
      showFlow: true,
      showStateLinks: true,
    });

  it("draws edges, hit areas, state links, the response animation and a connect preview", () => {
    const scene = sceneFor();
    const { container } = render(
      <EdgeLayer scene={scene} idPrefix="t" preview={{ from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }} />,
    );
    expect(container.querySelectorAll("[data-edge-id]")).toHaveLength(scene.shapes.length);
    expect(container.querySelectorAll("marker")).toHaveLength(4);
    expect(container.innerHTML).toContain("M0,0 L5,5");
    expect(container.innerHTML).toContain("url(#t-arrow-default)");
  });

  it("uses the response arrow for response overlays and none for requests", () => {
    const scene = sceneFor();
    scene.overlays = [
      { key: "a", path: "M0,0", direction: "response" },
      { key: "b", path: "M1,1", direction: "request" },
    ];
    const { container } = render(<EdgeLayer scene={scene} idPrefix="x" preview={null} />);
    expect(container.innerHTML).toContain("url(#x-arrow-response)");
    expect(container.innerHTML).not.toContain("M0,0 L5,5");
  });

  it("opens the payload from flow chips by click or Enter and leaves other chips inert", () => {
    const onOpenFlow = vi.fn();
    const { container } = render(
      <EdgeChips
        onOpenFlow={onOpenFlow}
        chips={[
          { key: "1", x: 0, y: 0, text: "flow", kind: "flow", edgeId: "e1", warn: false, dimmed: false },
          { key: "2", x: 0, y: 0, text: "label", kind: "label", warn: false, dimmed: false },
          { key: "3", x: 0, y: 0, text: "orphan", kind: "flow", warn: true, dimmed: true },
        ]}
      />,
    );
    const [flowChip, labelChip, orphan] = Array.from(container.querySelectorAll<HTMLElement>("[data-chip]"));
    fireEvent.click(flowChip);
    fireEvent.keyDown(flowChip, { key: "Enter" });
    fireEvent.keyDown(flowChip, { key: "a" });
    fireEvent.click(labelChip);
    fireEvent.click(orphan);
    fireEvent.keyDown(orphan, { key: "Enter" });
    expect(onOpenFlow).toHaveBeenCalledTimes(2);
    expect(onOpenFlow).toHaveBeenCalledWith("e1");
    expect(labelChip.getAttribute("role")).toBeNull();
  });
});

describe("World", () => {
  it("renders containers, groups, cards, ghosts and chips for a scope", () => {
    const m = starter();
    const docker = addNode(m, "docker", "box");
    docker.layer = "backend";
    byName(m, "Get user").group = "g";
    m.groups.push({ id: "g", name: "API group" });
    const visibility = computeVisibility(m, "backend");
    visibility.ghosts["not-a-node"] = { x: 0, y: 0, w: 1, h: 1, up: true };
    const scene = buildEdgeScene({
      model: m,
      flow,
      visibility,
      scope: "backend",
      selection: { type: "group", ids: ["g"] },
      trace: null,
      showFlow: true,
      showStateLinks: false,
    });
    const { container } = render(
      <World
        model={m}
        flow={flow}
        visibility={visibility}
        scene={scene}
        scope="backend"
        selection={{ type: "group", ids: ["g"] }}
        trace={null}
        showFlow
        view={{ x: 10, y: 20, k: 2 }}
        preview={null}
        idPrefix="w"
        onOpenFlow={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-kind='container']")).toBeTruthy();
    expect(container.querySelector("[data-group-head='g']")).toBeTruthy();
    expect(container.querySelectorAll("[data-ghost]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-kind='node']").length).toBeGreaterThan(1);
    expect((container.firstElementChild as HTMLElement).style.transform).toBe("translate(10px,20px) scale(2)");
    expect(traceMark(m, null, docker.id)).toBe("none");
  });
});
