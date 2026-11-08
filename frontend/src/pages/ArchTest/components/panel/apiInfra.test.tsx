import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mkNode, starter, type ApiNode, type InfraNode } from "../../engine";
import { renderSelectedNode } from "./testHarness";

const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("ApiPanel", () => {
  const api = (view: ReturnType<typeof renderSelectedNode>) => view.nodeNamed("Get user") as ApiNode;

  it("edits the endpoint", () => {
    const view = renderSelectedNode("Get user");
    change("HTTP method", "POST");
    change("Path", "/users");
    fireEvent.click(screen.getByLabelText("Return a single object (first connector row, 404 if empty)"));
    expect(api(view).cfg).toMatchObject({ method: "POST", path: "/users", single: false });
  });

  it("adds, edits and removes headers", () => {
    const view = renderSelectedNode("Get user");
    fireEvent.click(screen.getAllByText("Add")[0]);
    expect(api(view).cfg.headers).toHaveLength(2);
    fireEvent.change(screen.getAllByLabelText("Header name")[1], { target: { value: "X-Id" } });
    fireEvent.change(screen.getAllByLabelText("Header value")[1], { target: { value: "7" } });
    expect(api(view).cfg.headers[1]).toEqual({ k: "X-Id", v: "7" });
    fireEvent.click(screen.getAllByLabelText("Remove")[0]);
    expect(api(view).cfg.headers).toEqual([{ k: "X-Id", v: "7" }]);
  });

  it("shows the empty notes for lists with no rows", () => {
    const model = starter();
    const node = model.nodes.find((n) => n.type === "api") as ApiNode;
    node.cfg.headers = [];
    node.cfg.pathParams = [];
    node.cfg.query = [];
    renderSelectedNode("Get user", model);
    expect(screen.getByText("No headers.")).toBeTruthy();
    expect(screen.getAllByText("None.")).toHaveLength(2);
  });

  it("syncs path parameters from the path and edits them", () => {
    const view = renderSelectedNode("Get user");
    change("Path", "/users/:id/orders/{orderId}");
    fireEvent.click(screen.getByText("Sync from path"));
    expect(api(view).cfg.pathParams.map((p) => p.k)).toEqual(["id", "orderId"]);
    fireEvent.click(screen.getAllByText("Add")[1]);
    expect(api(view).cfg.pathParams).toHaveLength(3);
    fireEvent.change(screen.getAllByLabelText("Path parameter name")[2], { target: { value: "extra" } });
    fireEvent.change(screen.getAllByLabelText("Path parameter type")[2], { target: { value: "number" } });
    expect(api(view).cfg.pathParams[2]).toEqual({ k: "extra", type: "number" });
    fireEvent.click(screen.getAllByLabelText("Remove")[2]);
    expect(api(view).cfg.pathParams).toHaveLength(2);
  });

  it("edits query parameters", () => {
    const view = renderSelectedNode("Get user");
    fireEvent.click(screen.getAllByText("Add")[2]);
    expect(api(view).cfg.query).toHaveLength(2);
    fireEvent.change(screen.getAllByLabelText("Query parameter name")[1], { target: { value: "page" } });
    fireEvent.change(screen.getAllByLabelText("Query parameter type")[1], { target: { value: "number" } });
    fireEvent.click(screen.getAllByLabelText("required")[1]);
    expect(api(view).cfg.query[1]).toEqual({ k: "page", type: "number", required: true });
    fireEvent.click(screen.getAllByLabelText("Remove")[3]);
    expect(api(view).cfg.query).toHaveLength(1);
  });

  it("edits bodies and responses", () => {
    const view = renderSelectedNode("Get user");
    change("Request body", '{"x":1}');
    change("Response shape", '{"y":2}');
    fireEvent.click(screen.getAllByText("Add")[3]);
    expect(api(view).cfg.responses).toHaveLength(3);
    fireEvent.change(screen.getAllByLabelText("Response status")[2], { target: { value: "500" } });
    fireEvent.change(screen.getAllByLabelText("Response description")[2], { target: { value: "Boom" } });
    fireEvent.change(screen.getAllByLabelText("Response body")[2], { target: { value: "{}" } });
    expect(api(view).cfg).toMatchObject({ body: '{"x":1}', responseMap: '{"y":2}' });
    expect(api(view).cfg.responses[2]).toEqual({ status: 500, desc: "Boom", body: "{}" });
    fireEvent.change(screen.getAllByLabelText("Response status")[2], { target: { value: "" } });
    expect(api(view).cfg.responses[2].status).toBe("");
    fireEvent.click(screen.getAllByLabelText("Remove")[screen.getAllByLabelText("Remove").length - 1]);
    expect(api(view).cfg.responses).toHaveLength(2);
  });

  it("links to relationships", () => {
    const view = renderSelectedNode("Get user");
    fireEvent.click(screen.getByText("UserProfile"));
    fireEvent.click(screen.getAllByText("userWithOrders")[0]);
    expect(view.stubs.reveal).toHaveBeenCalledTimes(2);
  });
});

describe("InfraPanel", () => {
  const withInfra = () => {
    const model = starter();
    const redis = mkNode("redis", 0, 0, { name: "cache" });
    const docker = mkNode("docker", 0, 0, { name: "box" });
    const other = mkNode("other", 0, 0, { name: "svc" });
    const child = model.nodes.find((n) => n.name === "Get user")!;
    child.parent = docker.id;
    model.nodes.push(redis, docker, other);
    return model;
  };

  it("edits number, select and text configuration", () => {
    const view = renderSelectedNode("cache", withInfra());
    change("TTL (seconds)", "120");
    change("Simulated cache behavior", "always hit");
    change("Key pattern", "k:{id}");
    expect((view.nodeNamed("cache") as InfraNode).cfg).toMatchObject({ ttl: 120, behavior: "always hit", keyPattern: "k:{id}" });
    expect(screen.getByText(/watch a miss become a hit/)).toBeTruthy();
    expect(screen.queryByText("Contains")).toBeNull();
  });

  it("lists what a container holds", () => {
    renderSelectedNode("box", withInfra());
    expect(screen.getByText("Contains")).toBeTruthy();
    expect(screen.getAllByText("Get user").length).toBeGreaterThan(0);
  });

  it("shows connections and none-yet for isolated infrastructure", () => {
    renderSelectedNode("svc", withInfra());
    expect(screen.getAllByText("none yet")).toHaveLength(2);
  });
});
