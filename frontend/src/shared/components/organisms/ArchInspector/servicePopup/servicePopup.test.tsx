import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { clone, newAppService, newAppStep, starter, type ServiceNode } from "@/pages/ArchTest/engine";
import { changeField, idOf, recordingEditor, renderSelectedNode, renderWithArch } from "@/pages/ArchTest/testing/panelHarness";
import { AppServiceLibrary } from "./AppServiceLibrary";
import { ControllerTab } from "./ControllerTab";

const serviceName = (model: ReturnType<typeof starter>) => (model.nodes.find((n) => n.type === "service") as ServiceNode).name;
const open = (model = starter()) => {
  const view = renderSelectedNode(serviceName(model), model);
  const service = () => view.model().nodes.find((n) => n.type === "service") as ServiceNode;
  return { view, service };
};
const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));

describe("ServicePopup", () => {
  it("opens as a dialog with controller and service layer tabs", () => {
    open();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Controller" }).getAttribute("aria-selected")).toBe("true");
    tab("Service layer");
    expect(screen.getByRole("tab", { name: "Service layer" }).getAttribute("aria-selected")).toBe("true");
  });

  it("closes by deselecting", () => {
    const { view } = open();
    fireEvent.click(screen.getByText("Close"));
    expect(view.selection().type).toBeNull();
  });

  it("edits the service name and framework", () => {
    const { service } = open();
    changeField("Service name", "Billing");
    changeField("Framework", "Express");
    expect(service().name).toBe("Billing");
    expect(service().cfg.framework).toBe("Express");
  });

  it("edits the controller contract of the first endpoint", () => {
    const { service } = open();
    changeField("Path", "/people");
    expect(service().cfg.endpoints[0].path).toBe("/people");
  });

  it("adds, selects and removes endpoints", () => {
    const { service } = open();
    const before = service().cfg.endpoints.length;
    fireEvent.click(screen.getByText("Add endpoint"));
    expect(service().cfg.endpoints).toHaveLength(before + 1);
    const created = service().cfg.endpoints[before];
    expect((screen.getByLabelText("Path") as HTMLInputElement).value).toBe(created.path);
    fireEvent.click(screen.getByLabelText(`Remove ${created.method} ${created.path}`));
    expect(service().cfg.endpoints).toHaveLength(before);
  });

  it("presets a new endpoint's database from the one the service reaches", () => {
    const { view, service } = open();
    fireEvent.click(screen.getByText("Add endpoint"));
    expect(service().cfg.endpoints.at(-1)?.dbId).toBe(idOf(view.model(), "app_db"));
  });

  it("leaves a new endpoint without a database when the service reaches none", () => {
    const model = starter();
    const serviceId = model.nodes.find((n) => n.type === "service")!.id;
    model.edges = model.edges.filter((e) => e.from !== serviceId);
    const { service } = open(model);
    fireEvent.click(screen.getByText("Add endpoint"));
    expect(service().cfg.endpoints.at(-1)?.dbId).toBe("");
  });

  it("focuses another endpoint from the picker", () => {
    open();
    fireEvent.click(screen.getAllByText("/users")[0]);
    expect((screen.getByLabelText("Path") as HTMLInputElement).value).toBe("/users");
  });

  it("links to the nodes it is connected to", () => {
    const { view } = open();
    fireEvent.click(screen.getByText("fetchUser"));
    fireEvent.click(screen.getByText("app_db"));
    expect(view.stubs.closeModal).toHaveBeenCalledTimes(2);
    expect(view.stubs.reveal).toHaveBeenCalledWith(idOf(view.model(), "app_db"));
  });

  it("shows a note when the service has no endpoints", () => {
    const model = starter();
    (model.nodes.find((n) => n.type === "service") as ServiceNode).cfg.endpoints = [];
    open(model);
    expect(screen.getByText(/No endpoints yet/)).toBeTruthy();
    tab("Service layer");
    expect(screen.getByText(/Add an endpoint on the Controller tab/)).toBeTruthy();
  });
});

describe("Service layer tab", () => {
  const withLibrary = () => {
    const model = starter();
    const service = model.nodes.find((n) => n.type === "service") as ServiceNode;
    const fetchAvatar = newAppService("fetchAvatar");
    fetchAvatar.steps = [{ ...newAppStep("s3-get"), target: "avatars/1.png" }, newAppStep("redis-set")];
    service.cfg.appServices = [fetchAvatar];
    return { model, fetchAvatar };
  };

  it("creates in-app services and edits their steps", () => {
    const { service } = open();
    tab("Service layer");
    fireEvent.click(screen.getByText("New in-app service"));
    expect(service().cfg.appServices).toHaveLength(1);
    changeField("In-app service name", "cacheUser");
    fireEvent.click(screen.getByText("Add step"));
    changeField("Step kind", "redis-set");
    changeField("Cache key", "user:{id}");
    changeField("Step notes", "ttl 60s");
    expect(service().cfg.appServices[0]).toMatchObject({
      name: "cacheUser",
      steps: [{ kind: "redis-set", target: "user:{id}", detail: "ttl 60s" }],
    });
    fireEvent.click(within(screen.getByLabelText("Step kind").parentElement as HTMLElement).getByLabelText("Remove"));
    expect(service().cfg.appServices[0].steps).toEqual([]);
    fireEvent.click(screen.getByLabelText("Delete cacheUser"));
    expect(service().cfg.appServices).toEqual([]);
  });

  it("adds in-app services to the call chain, reorders and removes them", () => {
    const { model, fetchAvatar } = withLibrary();
    const { service } = open(model);
    tab("Service layer");
    changeField("Add a call", fetchAvatar.id);
    expect(screen.getByText("Fetch from S3: avatars/1.png → Write to Redis")).toBeTruthy();
    expect(service().cfg.endpoints[0].calls.map((c) => c.kind)).toEqual(["query", "appService"]);
    fireEvent.click(screen.getByLabelText("Move fetchAvatar up"));
    expect(service().cfg.endpoints[0].calls.map((c) => c.kind)).toEqual(["appService", "query"]);
    fireEvent.click(screen.getByLabelText("Move fetchAvatar down"));
    expect(service().cfg.endpoints[0].calls.map((c) => c.kind)).toEqual(["query", "appService"]);
    fireEvent.click(screen.getByLabelText("Remove call fetchAvatar"));
    fireEvent.click(screen.getByLabelText("Remove call Database query"));
    expect(service().cfg.endpoints[0].calls).toEqual([]);
    expect(screen.getByText(/calls nothing yet/)).toBeTruthy();
  });

  it("summarises an in-app service without steps in the call chain", () => {
    const model = starter();
    const service = model.nodes.find((n) => n.type === "service") as ServiceNode;
    const empty = newAppService("noop");
    service.cfg.appServices = [empty];
    open(model);
    tab("Service layer");
    changeField("Add a call", empty.id);
    expect(screen.getByText("No steps yet")).toBeTruthy();
  });

  it("fails loudly when an in-app service is edited after it was removed", () => {
    const { model, fetchAvatar } = withLibrary();
    const service = model.nodes.find((n) => n.type === "service") as ServiceNode;
    const { editor, lastMutation } = recordingEditor();
    renderWithArch(<AppServiceLibrary node={service} editor={editor} />, { model });
    fireEvent.click(screen.getByText("Add step"));
    const stale = clone(service);
    stale.cfg.appServices = [];
    expect(() => lastMutation<ServiceNode>()(stale, model)).toThrow(`In-app service "${fetchAvatar.id}" no longer exists`);
  });

  it("fails loudly when the focused endpoint is edited after it was removed", () => {
    const model = starter();
    const service = model.nodes.find((n) => n.type === "service") as ServiceNode;
    const { editor, lastMutation } = recordingEditor();
    renderWithArch(<ControllerTab node={service} editor={editor} />, { model });
    changeField("Path", "/people");
    const stale = clone(service);
    stale.cfg.endpoints = [];
    expect(() => lastMutation<ServiceNode>()(stale, model)).toThrow(`Endpoint "${service.cfg.endpoints[0].id}" no longer exists`);
  });

  it("offers the database query only when the endpoint lacks one, and ignores the empty choice", () => {
    const { service } = open();
    tab("Service layer");
    changeField("Add a call", "");
    expect(service().cfg.endpoints[0].calls).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("Remove call Database query"));
    changeField("Add a call", "query");
    expect(service().cfg.endpoints[0].calls.map((c) => c.kind)).toEqual(["query"]);
  });

  it("fails loudly when a call points at a missing in-app service", () => {
    const { model } = withLibrary();
    const service = model.nodes.find((n) => n.type === "service") as ServiceNode;
    service.cfg.endpoints[0].calls = [{ id: "c1", kind: "appService", appServiceId: "ghost" }];
    const silenceReactErrorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderSelectedNode(service.name, model);
    expect(() => tab("Service layer")).toThrow('Call "c1" points at a missing in-app service');
    silenceReactErrorLog.mockRestore();
  });
});
