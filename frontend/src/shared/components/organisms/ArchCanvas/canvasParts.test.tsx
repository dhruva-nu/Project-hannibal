import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { simulate, starter, type ArchNode } from "@/pages/ArchTest/engine";
import { addNode, byName } from "@/pages/ArchTest/engine/testFixtures";
import { NO_SELECTION } from "@/pages/ArchTest/state/archApi";
import { buildEdgeScene } from "@/pages/ArchTest/view/edgeScene";
import { traceMark } from "@/pages/ArchTest/view/traceHighlight";
import { computeVisibility } from "@/pages/ArchTest/view/visibility";
import { traceViewFor } from "@/pages/ArchTest/testing/overlayHarness";
import { ContainerBox } from "./ContainerBox";
import { EdgeChips } from "./EdgeChips";
import { EdgeLayer } from "./EdgeLayer";
import { GhostCard } from "./GhostCard";
import { ArchStateLine } from "@/shared/components/molecules";
import { FlowIo, NodeBody } from "./NodeBody";
import { NodeCard } from "./NodeCard";
import { World } from "./World";

afterEach(cleanup);

const model = starter();
const flow = simulate(model);
const trace = traceViewFor(model);
const bodyText = (node: ArchNode, extra: { t?: typeof trace | null; m?: typeof model; activeEndpoint?: string | null } = {}) => {
  const view = render(
    <NodeBody node={node} model={extra.m ?? model} trace={extra.t ?? null} activeEndpoint={extra.activeEndpoint ?? null} />,
  );
  const text = view.container.textContent ?? "";
  view.unmount();
  return text;
};

const withCfg = (node: ArchNode, cfg: Record<string, unknown>) => ({ ...node, cfg: { ...node.cfg, ...cfg } }) as ArchNode;

describe("NodeBody", () => {
  it("summarises each starter node type", () => {
    const component = bodyText(byName(model, "UserProfile"));
    expect(component).toContain("Shows a user and their recent orders");
    expect(component).toContain("isLoading");
    expect(component).toContain("currentUser, orders");
    const fn = bodyText(byName(model, "fetchUser"));
    expect(fn).toContain("each time the component mounts");
    expect(fn).toContain("/users/:id");
    expect(fn).toContain("setscurrentUser, orders");
    const service = bodyText(byName(model, "User service"));
    expect(service).toContain("/users/:id");
    expect(service).toContain("app_db");
    const db = bodyText(byName(model, "app_db"));
    expect(db).toContain("id pk");
    expect(db).toContain("user_id fk");
  });

  it("describes layer cards with member names and kinds, an overflow count, or an empty hint", () => {
    const client = model.lnodes.find((l) => l.lid === "client")!;
    expect(bodyText(client)).toContain("UserProfileComponent");
    const crowded = starter();
    Array.from({ length: 9 }, (_, i) => addNode(crowded, "component", `c${i}`)).forEach((n) => (n.layer = "client"));
    expect(bodyText(crowded.lnodes.find((l) => l.lid === "client")!, { m: crowded })).toContain("+3 more");
    const empty = starter();
    empty.nodes = [];
    expect(bodyText(empty.lnodes[0], { m: empty })).toContain("Empty. Click to open");
  });

  it("describes function triggers and a missing endpoint", () => {
    const fn = byName(model, "fetchUser");
    const cases = [
      [{ trigger: "Polling", interval: 5000 }, "every 5000 ms"],
      [{ trigger: "On Component Change", deps: "" }, "when nothing changes"],
      [{ trigger: "On Component Change", deps: "a,b" }, "when a,b changes"],
      [{ trigger: "WebSocket", url: "wss://example.com/stream" }, "wss://example.com/stream"],
      [{ trigger: "On Load" }, "each time the component mounts"],
      [{ trigger: "Initial Load" }, "once when the app boots"],
      [{ endpoint: "" }, "no endpoint yet"],
    ] as const;
    cases.forEach(([cfg, expected]) => expect(bodyText(withCfg(fn, cfg))).toContain(expected));
    expect(bodyText(withCfg(fn, { writes: [] }))).not.toContain("sets");
  });

  it("shows placeholders for empty components, services, SQL and NoSQL nodes", () => {
    const m = starter();
    const component = addNode(m, "component", "bare", { desc: "", reads: [], writes: [{ varId: "v_user", from: "x" }] });
    const service = addNode(m, "service", "no endpoints", { endpoints: [] });
    const sql = addNode(m, "sqldb", "no tables", { tables: [] });
    const nosql = addNode(m, "nosql", "docs");
    expect(bodyText(component, { m })).toContain("No description");
    expect(bodyText(component, { m })).toContain("setscurrentUser");
    expect(bodyText(component, { m })).not.toContain("reads");
    expect(bodyText(service, { m })).toContain("No endpoints yet");
    expect(bodyText(sql, { m })).toContain("No tables");
    const columns = Array.from({ length: 7 }, (_, i) => ({ name: `c${i}`, type: "int", pk: false, fk: "" }));
    if (sql.type === "sqldb") sql.cfg.tables = [{ name: "wide", columns, indexes: [], data: "[]" }];
    expect(bodyText(sql, { m })).toContain("+2");
    expect(bodyText(nosql, { m })).toContain("documents");
    if (nosql.type === "nosql") nosql.cfg.collections = [];
    expect(bodyText(nosql, { m })).toContain("No collections");
    expect(bodyText(addNode(m, "redis", "r"), { m })).toContain("TTL 60s");
  });

  it("falls back to the raw id for variables that no longer exist", () => {
    expect(bodyText(withCfg(byName(model, "UserProfile"), { reads: ["v_gone"] }))).toContain("v_gone");
  });

  it("marks the active endpoint on a service card and names the database each endpoint queries", () => {
    const view = render(<NodeBody node={byName(model, "User service")} model={model} trace={null} activeEndpoint="ep_list_users" />);
    const row = (id: string) => view.container.querySelector<HTMLElement>(`[data-endpoint='${id}']`)!;
    expect(row("ep_list_users").dataset.active).toBe("true");
    expect(row("ep_get_user").dataset.active).toBe("false");
    expect(row("ep_get_user").title).toBe("GET /users/:id queries app_db");
    expect(row("ep_create_user").title).toBe("POST /users");
  });
});

describe("StateLine and FlowIo", () => {
  const currentUser = model.store.find((v) => v.name === "currentUser")!;
  const stateLine = (t: typeof trace | null) => render(<ArchStateLine variable={currentUser} trace={t} />).container.firstElementChild as HTMLElement;

  it("shows the traced value once written, otherwise the initial value", () => {
    const written = stateLine({ ...trace, index: trace.result.steps.length - 1 });
    expect(written.textContent).toContain('{"id":1');
    expect(written.dataset.changed).toBe("true");
    cleanup();
    expect(stateLine({ ...trace, index: -1 }).textContent).toBe("currentUserobjectnull");
    cleanup();
    expect(stateLine(null).dataset.changed).toBe("false");
    cleanup();
    const unnumbered = { ...trace, index: 0, result: { ...trace.result, writes: [{ varId: currentUser.id, value: 5, by: "x" }] } };
    expect(stateLine(unnumbered).textContent).toContain("5");
  });

  it("shows payload sizes only for nodes with traffic", () => {
    const service = byName(model, "User service");
    expect(render(<FlowIo flow={flow} nodeId={service.id} />).container.textContent).toMatch(/^in .+ · out /);
    cleanup();
    expect(render(<FlowIo flow={flow} nodeId="nothing" />).container.textContent).toBe("");
    cleanup();
    const partial = { ...flow, nodes: { only: { out: { a: 1 } }, inbound: { in: { a: 1 } }, silent: {} } };
    expect(render(<FlowIo flow={partial} nodeId="inbound" />).container.textContent).toMatch(/ · out -$/);
    cleanup();
    expect(render(<FlowIo flow={partial} nodeId="silent" />).container.textContent).toBe("");
    cleanup();
    expect(render(<FlowIo flow={partial} nodeId="only" />).container.textContent).toMatch(/^in - · out /);
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
        activeEndpoint={null}
        {...extra}
      />,
    );

  it("labels cards by node kind, trigger or framework", () => {
    expect(card(model.lnodes[0]).container.textContent).not.toContain("Layer");
    cleanup();
    expect(card(byName(model, "fetchUser")).container.textContent).toContain("On Load");
    cleanup();
    expect(card(byName(model, "User service")).container.textContent).toContain("FastAPI");
    cleanup();
    expect(card(byName(model, "app_db")).container.textContent).toContain("SQL database");
  });

  it("exposes selection, trace mark, category, docking and the mismatch warning", () => {
    const { container, getByTitle } = card(byName(model, "User service"), {
      selected: true,
      mark: "active",
      hasMismatch: true,
      docked: true,
    });
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset).toMatchObject({ selected: "true", trace: "active", cat: "backend", kind: "node", type: "service", docked: "true" });
    expect(getByTitle("Response does not match what this component expects")).toBeTruthy();
    expect(root.querySelectorAll("[data-port]")).toHaveLength(4);
    expect(root.querySelector("[data-resize]")).toBeTruthy();
  });

  it("shows payload sizes in flow mode only", () => {
    const service = byName(model, "User service");
    expect(card(service).container.textContent).not.toContain(" · out ");
    cleanup();
    expect(card(service, { showFlow: true }).container.textContent).toContain(" · out ");
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
    expect(up.container.textContent).toBe("↑ fetchUserClient");
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
  type WorldOptions = {
    selection?: Parameters<typeof World>[0]["selection"];
    trace?: typeof trace | null;
    endpointFocus?: string | null;
    docked?: ReadonlySet<string>;
    adjustVisibility?: (visibility: ReturnType<typeof computeVisibility>) => void;
  };
  const renderWorld = (m: typeof model, scope: "backend" | "client", options: WorldOptions = {}) => {
    const visibility = computeVisibility(m, scope);
    options.adjustVisibility?.(visibility);
    const selection = options.selection ?? NO_SELECTION;
    const scene = buildEdgeScene({ model: m, flow, visibility, scope, selection, trace: null, showFlow: true, showStateLinks: false });
    return render(
      <World
        model={m}
        endpointFocus={options.endpointFocus ?? null}
        flow={flow}
        visibility={visibility}
        scene={scene}
        scope={scope}
        selection={selection}
        trace={options.trace ?? null}
        showFlow
        view={{ x: 10, y: 20, k: 2 }}
        preview={null}
        idPrefix="w"
        docked={options.docked}
        onOpenFlow={vi.fn()}
      />,
    );
  };
  const activeEndpoints = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>("[data-endpoint][data-active='true']")).map((e) => e.dataset.endpoint);

  it("renders containers, groups, cards, ghosts and chips for a scope", () => {
    const m = starter();
    const docker = addNode(m, "docker", "box");
    docker.layer = "backend";
    addNode(m, "k8s", "cluster", {}, { w: 900, h: 600 }).layer = "backend";
    byName(m, "User service").group = "g";
    m.groups.push({ id: "g", name: "Service group" });
    const { container } = renderWorld(m, "backend", { selection: { type: "group", ids: ["g"] } });
    const containerNames = Array.from(container.querySelectorAll("[data-kind='container']")).map((c) => c.textContent);
    expect(containerNames.map((name) => name?.startsWith("cluster"))).toEqual([true, false]);
    expect(container.querySelector("[data-group-head='g']")).toBeTruthy();
    expect(container.querySelectorAll("[data-ghost]").length).toBeGreaterThan(0);
    expect(container.querySelector(`[data-kind='node'][data-id='${byName(m, "User service").id}']`)).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).style.transform).toBe("translate(10px,20px) scale(2)");
    expect(traceMark(m, null, docker.id)).toBe("none");
  });

  it("skips ghosts of unknown nodes and marks docked cards", () => {
    const m = starter();
    const service = byName(m, "User service");
    const ghostCount = Object.keys(computeVisibility(m, "backend").ghosts).length;
    const { container } = renderWorld(m, "backend", {
      docked: new Set([service.id]),
      adjustVisibility: (visibility) => (visibility.ghosts["not-a-node"] = { x: 0, y: 0, w: 1, h: 1, up: true }),
    });
    expect(container.querySelectorAll("[data-ghost]")).toHaveLength(ghostCount);
    expect(container.querySelector<HTMLElement>(`[data-id='${service.id}']`)!.dataset.docked).toBe("true");
  });

  it("highlights the focused endpoint of the selected service", () => {
    const m = starter();
    const service = byName(m, "User service");
    const selected = renderWorld(m, "backend", { selection: { type: "node", ids: [service.id] }, endpointFocus: "ep_list_users" });
    expect(activeEndpoints(selected.container)).toEqual(["ep_list_users"]);
    cleanup();
    const unselected = renderWorld(m, "backend", { endpointFocus: "ep_list_users" });
    expect(activeEndpoints(unselected.container)).toEqual([]);
  });

  it("highlights the endpoint the trace is on, ignoring the inspector focus", () => {
    const m = starter();
    const service = byName(m, "User service");
    const traced = traceViewFor(m);
    const onService = traced.result.steps.findIndex((s) => s.node === service.id && s.meta.endpoint);
    const selection = { type: "node" as const, ids: [service.id] };
    const atService = renderWorld(m, "backend", { trace: { ...traced, index: onService }, selection, endpointFocus: "ep_list_users" });
    expect(activeEndpoints(atService.container)).toEqual(["ep_get_user"]);
    cleanup();
    const elsewhere = renderWorld(m, "backend", { trace: { ...traced, index: 0 }, selection, endpointFocus: "ep_list_users" });
    expect(activeEndpoints(elsewhere.container)).toEqual([]);
  });
});
