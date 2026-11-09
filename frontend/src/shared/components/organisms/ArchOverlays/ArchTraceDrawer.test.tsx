import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TraceStep } from "@/pages/ArchTest/engine";
import { starter } from "@/pages/ArchTest/engine";
import { ArchTraceDrawer } from "./ArchTraceDrawer";
import { nodeOfType, renderWithArch, starterWithCache, traceViewFor } from "@/pages/ArchTest/testing/overlayHarness";

const step = (over: Partial<TraceStep> & { node: string }): TraceStep => ({
  i: 0,
  dir: "res",
  edge: null,
  payload: undefined,
  title: "step",
  warns: [],
  meta: { notes: [] },
  ...over,
});

describe("TraceDrawer", () => {
  it("renders nothing without a trace or when the component is gone", () => {
    const model = starter();
    expect(renderWithArch(<ArchTraceDrawer />, model).container.innerHTML).toBe("");
    const trace = traceViewFor(model);
    model.nodes = model.nodes.filter((n) => n.type !== "component");
    expect(renderWithArch(<ArchTraceDrawer />, model, { trace }).container.innerHTML).toBe("");
  });

  it("drives the trace through header controls", () => {
    const model = starter();
    const trace = traceViewFor(model, { index: 2 });
    const { api } = renderWithArch(<ArchTraceDrawer />, model, { trace });
    expect(screen.getByText("Trace: UserProfile")).toBeTruthy();
    expect(screen.getByText(`Step 3 of ${trace.result.steps.length}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Prev" }));
    expect(api.traceGo).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(api.traceGo).toHaveBeenLastCalledWith(3);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(api.traceTogglePlay).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Warm cache" }));
    expect(api.traceSetWarm).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Cold cache" }));
    expect(api.traceSetWarm).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Close trace" }));
    expect(api.closeTrace).toHaveBeenCalled();
    const fn = nodeOfType(model, "function");
    fireEvent.change(screen.getByLabelText("Trigger"), { target: { value: fn.id } });
    expect(api.traceSetOnly).toHaveBeenCalledWith(fn.id);
    expect(screen.getByText(/Functions triggered, in order:/)).toBeTruthy();
    expect(screen.getByText("1. On Load (fetchUser)")).toBeTruthy();
  });

  it("shows Pause while playing and the cold/warm pressed state", () => {
    const model = starter();
    renderWithArch(<ArchTraceDrawer />, model, { trace: traceViewFor(model, { playing: true, warm: true }) });
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Warm cache" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("selects a step from the list and scrolls it into view", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const model = starter();
    const trace = traceViewFor(model, { index: 1 });
    const { api } = renderWithArch(<ArchTraceDrawer />, model, { trace });
    expect(scrollIntoView).toHaveBeenCalled();
    const items = screen.getAllByRole("button").filter((b) => b.className.includes("step") && /^\d/.test(b.textContent ?? ""));
    expect(items[1].getAttribute("aria-current")).toBe("step");
    fireEvent.click(items[3]);
    expect(api.traceGo).toHaveBeenCalledWith(3);
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("tells when no function is attached", () => {
    const model = starter();
    const fn = nodeOfType(model, "function");
    model.edges = model.edges.filter((e) => e.to !== fn.id);
    renderWithArch(<ArchTraceDrawer />, model, { trace: traceViewFor(model) });
    expect(screen.getByText(/No function is attached/)).toBeTruthy();
  });

  it("shows cache MISS when cold and HIT when warm with the explanatory notes", () => {
    const cold = starterWithCache();
    const view = traceViewFor(cold);
    const missIndex = view.result.steps.findIndex((s) => s.meta.cache === "MISS");
    renderWithArch(<ArchTraceDrawer />, cold, { trace: { ...view, index: missIndex } });
    expect(screen.getAllByText("MISS").length).toBeGreaterThan(0);
    expect(screen.getByText(/this request continues downstream/)).toBeTruthy();
  });

  it("shows cache HIT note on a warm run", () => {
    const model = starterWithCache();
    const view = traceViewFor(model, { options: { warm: true } });
    const hitIndex = view.result.steps.findIndex((s) => s.meta.cache === "HIT");
    expect(hitIndex).toBeGreaterThanOrEqual(0);
    renderWithArch(<ArchTraceDrawer />, model, { trace: { ...view, warm: true, index: hitIndex } });
    expect(screen.getByText(/this response came from the cache/)).toBeTruthy();
  });

});

describe("TraceDrawer step inspector", () => {
  it("inspects the SQL, status, mapping, schema warnings and state updates of real steps", () => {
    const model = starter();
    const fn = nodeOfType(model, "function");
    fn.cfg.input = '{"needed": 1}';
    const view = traceViewFor(model);
    const steps = view.result.steps;
    const at = (predicate: (s: TraceStep) => boolean) => steps.findIndex(predicate);

    const { rerender, api } = renderWithArch(<ArchTraceDrawer />, model, { trace: { ...view, index: at((s) => !!s.meta.sql) } });
    expect(screen.getByText("Database query")).toBeTruthy();

    const warnIndex = at((s) => s.warns.length > 0);
    expect(warnIndex).toBeGreaterThanOrEqual(0);
    expect(screen.getAllByText("!").length).toBeGreaterThan(0);
    rerender(<></>);
    const second = renderWithArch(<ArchTraceDrawer />, model, { trace: { ...view, index: warnIndex } });
    expect(screen.getByText("Schema mismatch")).toBeTruthy();
    second.unmount();

    const statusIndex = at((s) => s.meta.status !== undefined);
    renderWithArch(<ArchTraceDrawer />, model, { trace: { ...view, index: statusIndex } });
    expect(screen.getByText(/HTTP status/)).toBeTruthy();
    expect(api).toBeTruthy();
  });

  it("lists state updates, the pre-mapping payload and unknown variables", () => {
    const model = starter();
    const comp = nodeOfType(model, "component");
    const trace = {
      ...traceViewFor(model),
      index: 0,
      result: {
        steps: [
          step({
            node: comp.id,
            dir: "req",
            payload: { a: 1 },
            meta: {
              notes: ["", "a note"],
              pre: { before: true },
              writes: [
                { varId: model.store[0].id, value: { id: 1 }, by: "x" },
                { varId: comp.cfg.state[0].id, value: true, by: "x" },
                { varId: "ghost", value: 2, by: "x" },
              ],
            },
          }),
        ],
        fnOrder: [],
        writes: [],
      },
    };
    renderWithArch(<ArchTraceDrawer />, model, { trace });
    expect(screen.getByText("a note")).toBeTruthy();
    expect(screen.getByText("Before the connection mapping")).toBeTruthy();
    expect(screen.getByText('currentUser = {"id":1}')).toBeTruthy();
    expect(screen.getByText("isLoading = true")).toBeTruthy();
    expect(screen.getByText("? = 2")).toBeTruthy();
    expect(screen.getByText("Request payload")).toBeTruthy();
  });

  it("diffs against the previous step in the same direction", () => {
    const model = starter();
    const comp = nodeOfType(model, "component");
    const base = traceViewFor(model);
    const trace = {
      ...base,
      index: 2,
      result: {
        steps: [
          step({ i: 0, node: comp.id, payload: { a: 1, b: 2 } }),
          step({ i: 1, node: "gone-node", dir: "req", payload: { x: 1 } }),
          step({ i: 2, node: comp.id, payload: { a: 9, c: 3 } }),
        ],
        fnOrder: [],
        writes: [],
      },
    };
    renderWithArch(<ArchTraceDrawer />, model, { trace });
    expect(screen.getByText("Changes since the previous response step")).toBeTruthy();
    expect(screen.getByText("~ a: 1 → 9")).toBeTruthy();
    expect(screen.getByText("− b")).toBeTruthy();
    expect(screen.getByText("+ c: 3")).toBeTruthy();
    const list = screen.queryAllByText("gone-node");
    expect(list).toHaveLength(0);
  });

  it("skips steps without payload when looking for the previous step and handles missing nodes", () => {
    const model = starter();
    const base = traceViewFor(model);
    const trace = {
      ...base,
      index: 1,
      result: {
        steps: [step({ i: 0, node: "ghost", payload: { a: 1 } }), step({ i: 1, node: "ghost", payload: undefined })],
        fnOrder: [],
        writes: [],
      },
    };
    renderWithArch(<ArchTraceDrawer />, model, { trace });
    expect(screen.queryByText(/Changes since/)).toBeNull();
    const heading = screen.getByRole("heading", { level: 5 });
    expect(within(heading).getByText(/Response/)).toBeTruthy();
  });
});
