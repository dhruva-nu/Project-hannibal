import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createNode, starter, type InfraNode } from "@/pages/ArchTest/engine";
import { USER_SERVICE, changeField, endpointOf, renderSelectedNode, serviceIn, type PanelRender } from "@/pages/ArchTest/testing/panelHarness";

const GET_USER = "ep_get_user";
const getUser = (view: PanelRender) => endpointOf(view, GET_USER);
const openController = (model = starter()) => renderSelectedNode(USER_SERVICE, model);

describe("EndpointPanel on the controller tab", () => {
  it("edits the method, path and single-object flag", () => {
    const view = openController();
    changeField("HTTP method", "POST");
    changeField("Path", "/users");
    fireEvent.click(screen.getByLabelText("Return a single object (first row, 404 if empty)"));
    expect(getUser(view)).toMatchObject({ method: "POST", path: "/users", single: false });
  });

  it("adds, edits and removes headers", () => {
    const view = openController();
    fireEvent.click(screen.getAllByText("Add")[0]);
    expect(getUser(view).headers).toHaveLength(2);
    fireEvent.change(screen.getAllByLabelText("Header name")[1], { target: { value: "X-Id" } });
    fireEvent.change(screen.getAllByLabelText("Header value")[1], { target: { value: "7" } });
    expect(getUser(view).headers[1]).toEqual({ k: "X-Id", v: "7" });
    fireEvent.click(screen.getAllByLabelText("Remove")[0]);
    expect(getUser(view).headers).toEqual([{ k: "X-Id", v: "7" }]);
  });

  it("shows the empty notes for lists with no rows", () => {
    const model = starter();
    const endpoint = serviceIn(model).cfg.endpoints[0];
    endpoint.headers = [];
    endpoint.pathParams = [];
    endpoint.query = [];
    openController(model);
    expect(screen.getByText("No headers.")).toBeTruthy();
    expect(screen.getAllByText("None.")).toHaveLength(2);
  });

  it("syncs path parameters from the path and edits them", () => {
    const view = openController();
    changeField("Path", "/users/:id/orders/{orderId}");
    fireEvent.click(screen.getByText("Sync from path"));
    expect(getUser(view).pathParams.map((p) => p.k)).toEqual(["id", "orderId"]);
    fireEvent.click(screen.getAllByText("Add")[1]);
    expect(getUser(view).pathParams).toHaveLength(3);
    fireEvent.change(screen.getAllByLabelText("Path parameter name")[2], { target: { value: "extra" } });
    fireEvent.change(screen.getAllByLabelText("Path parameter type")[2], { target: { value: "number" } });
    expect(getUser(view).pathParams[2]).toEqual({ k: "extra", type: "number" });
    fireEvent.click(screen.getAllByLabelText("Remove")[2]);
    expect(getUser(view).pathParams.map((p) => p.k)).toEqual(["id", "extra"]);
  });

  it("edits query parameters", () => {
    const view = openController();
    fireEvent.click(screen.getAllByText("Add")[2]);
    expect(getUser(view).query).toHaveLength(2);
    fireEvent.change(screen.getAllByLabelText("Query parameter name")[1], { target: { value: "page" } });
    fireEvent.change(screen.getAllByLabelText("Query parameter type")[1], { target: { value: "number" } });
    fireEvent.click(screen.getAllByLabelText("required")[1]);
    expect(getUser(view).query[1]).toEqual({ k: "page", type: "number", required: true });
    fireEvent.click(screen.getAllByLabelText("Remove")[3]);
    expect(getUser(view).query).toHaveLength(1);
  });

  it("edits bodies and responses", () => {
    const view = openController();
    changeField("Request body", '{"x":1}');
    changeField("Response shape", '{"y":2}');
    fireEvent.click(screen.getAllByText("Add")[3]);
    expect(getUser(view).responses).toHaveLength(3);
    fireEvent.change(screen.getAllByLabelText("Response status")[2], { target: { value: "500" } });
    fireEvent.change(screen.getAllByLabelText("Response description")[2], { target: { value: "Boom" } });
    fireEvent.change(screen.getAllByLabelText("Response body")[2], { target: { value: "{}" } });
    expect(getUser(view)).toMatchObject({ body: '{"x":1}', responseMap: '{"y":2}' });
    expect(getUser(view).responses[2]).toEqual({ status: 500, desc: "Boom", body: "{}" });
    fireEvent.change(screen.getAllByLabelText("Response status")[2], { target: { value: "" } });
    expect(getUser(view).responses[2].status).toBe("");
    fireEvent.click(screen.getAllByLabelText("Remove").at(-1)!);
    expect(getUser(view).responses).toHaveLength(2);
  });
});

describe("InfraPanel", () => {
  const withInfra = () => {
    const model = starter();
    const redis = createNode("redis", 0, 0, { name: "cache" });
    const docker = createNode("docker", 0, 0, { name: "box" });
    const other = createNode("other", 0, 0, { name: "svc" });
    serviceIn(model).parent = docker.id;
    model.nodes.push(redis, docker, other);
    return model;
  };

  it("edits number, select and text configuration", () => {
    const view = renderSelectedNode("cache", withInfra());
    changeField("TTL (seconds)", "120");
    changeField("Simulated cache behavior", "always hit");
    changeField("Key pattern", "k:{id}");
    expect((view.nodeNamed("cache") as InfraNode).cfg).toMatchObject({ ttl: 120, behavior: "always hit", keyPattern: "k:{id}" });
    expect(screen.getByText(/watch a miss become a hit/)).toBeTruthy();
    expect(screen.queryByText("Contains")).toBeNull();
  });

  it("lists what a container holds", () => {
    renderSelectedNode("box", withInfra());
    expect(screen.getByText("Contains")).toBeTruthy();
    expect(screen.getByText(USER_SERVICE)).toBeTruthy();
  });

  it("shows connections and none-yet for isolated infrastructure", () => {
    renderSelectedNode("svc", withInfra());
    expect(screen.getAllByText("none yet")).toHaveLength(2);
  });
});
